import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeywords,
} from "@/lib/keywords";
import { sanitizeBlocks, validateBlocks } from "@/lib/skeleton-cards";
import { isPresetSubject, normalizeSubject } from "@/lib/subjects";
import { findArchaeologyQuestionIdsByKeywords } from "@/lib/archaeology-link";
import { deriveKeywordFromTopic } from "@/lib/skeleton-batch-spec";

export const runtime = "nodejs";
export const maxDuration = 120;

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const DEFAULT_WORD_COUNT = 200;

const SKELETON_GEN_PROMPT = `你是台灣國考申論題「骨架卡」內容產生器。骨架卡資料結構分三層：
1. 定義（definition）：純文字，說明主題是什麼。
2. 分類架構（blocks）：可以有多組，每組有 label（分類名稱）、可省略的 note、count（正整數，這組要展開幾點）、points（陣列，每點有 key 與可省略的 hint）。points 的數量必須等於 count，不可短少也不可超過。
3. 結論／實務（conclusion）：純文字，收斂重點、比較、實務應用。

請根據使用者提供的主題與「內容重點需求」清單，判斷每個需求要放進 definition、某一組 blocks、還是 conclusion，並生成完整且正確的內容。若使用者未指定內容重點需求，請自行規劃一份涵蓋考試常考重點的完整內容（定義、至少一組分類架構、結論）。

規則：
- 若某項需求提到具體數量（例如「七種分類」「四個步驟」），建立一組 block，count 為該數字，points 剛好展開該數量的細項，每項 key 是名稱、hint 是一句話說明。
- 「定義」「目的」等需求通常寫進 definition。
- 「優缺點」「比較」「實務應用」等收斂性需求通常寫進 conclusion。
- 內容必須專業正確、精簡到可直接默寫，不要客套語、不要重複廢話。
- 敘述不要過於艱深，避免堆砌生僻學術用語，盡量用清楚易懂的說法解釋。
- 全部使用繁體中文；英文專有名詞第一次出現時附上全名。
- definition、所有 blocks 的 note/points、conclusion 三者字數加總，需大約落在使用者指定的目標字數（容許 ±15%）。
- 只能輸出「純 JSON」，不要 markdown code fence、不要任何說明文字，鍵名固定如下：
{
  "definition": "string",
  "blocks": [
    { "label": "string", "note": "string(可省略)", "count": number, "points": [{ "key": "string", "hint": "string(可省略)" }] }
  ],
  "conclusion": "string"
}`;

type BatchGenerateItemInput = {
  topicZh?: string;
  topicEn?: string;
  keyword?: string;
  aspects?: string[];
  wordCount?: number | null;
};

type BatchGenerateBody = {
  subject?: string;
  items?: BatchGenerateItemInput[];
};

type GeneratedShape = {
  definition: string;
  blocks: Array<{
    label: string;
    note?: string;
    count: number;
    points: Array<{ key: string; hint?: string }>;
  }>;
  conclusion: string;
};

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

async function generateContent(
  anthropic: Anthropic,
  params: {
    subject: string;
    topicZh: string;
    topicEn: string;
    keyword: string;
    aspects: string[];
    wordCount: number | null;
  }
): Promise<GeneratedShape> {
  const userMessage = [
    `科目：${params.subject}`,
    `主題：${params.topicZh}${params.topicEn ? ` / ${params.topicEn}` : ""}`,
    `關鍵字：${params.keyword}`,
    `內容重點需求：${
      params.aspects.length > 0
        ? params.aspects.join("、")
        : "（未指定，請自行規劃一份完整、涵蓋常考重點的定義／分類架構／結論）"
    }`,
    `目標總字數：約 ${params.wordCount ?? "不限"} 字`,
  ].join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium" },
    system: SKELETON_GEN_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (!text.trim()) {
    throw new Error("模型沒有回傳內容");
  }

  const parsed = extractJson(text) as Partial<GeneratedShape>;
  return {
    definition:
      typeof parsed.definition === "string" ? parsed.definition.trim() : "",
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    conclusion:
      typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : "",
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "伺服器未設定 ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  let body: BatchGenerateBody;
  try {
    body = (await request.json()) as BatchGenerateBody;
  } catch {
    return NextResponse.json({ error: "無效的 JSON 本文" }, { status: 400 });
  }

  const subject =
    typeof body.subject === "string" ? normalizeSubject(body.subject) : "";
  if (!subject || !isPresetSubject(subject)) {
    return NextResponse.json(
      { error: "科目必須是：資通網路、資通安全、資料庫應用、作業系統" },
      { status: 400 }
    );
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "缺少要產生的項目" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });

  const results: Array<{
    index: number;
    topic: string;
    success: boolean;
    id?: string;
    isStub?: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const topicZh = typeof item.topicZh === "string" ? item.topicZh.trim() : "";
    const topicEn = typeof item.topicEn === "string" ? item.topicEn.trim() : "";
    const keywordInput =
      typeof item.keyword === "string" ? item.keyword.trim() : "";
    // 關鍵字沒填時，用英文主題（空格改連字號）衍生；英文也沒有就退回中文主題
    const keyword = keywordInput || deriveKeywordFromTopic(topicEn, topicZh);
    const aspects = Array.isArray(item.aspects)
      ? item.aspects.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      : [];
    const wordCount =
      typeof item.wordCount === "number" && Number.isFinite(item.wordCount)
        ? item.wordCount
        : DEFAULT_WORD_COUNT;

    if (!topicZh || !keyword) {
      results.push({
        index: i,
        topic: topicZh || `第 ${i + 1} 項`,
        success: false,
        error: "缺少主題名稱或關鍵字",
      });
      continue;
    }

    try {
      const generated = await generateContent(anthropic, {
        subject,
        topicZh,
        topicEn,
        keyword,
        aspects,
        wordCount,
      });

      const blocks = sanitizeBlocks(generated.blocks);
      const blockError = validateBlocks(blocks);
      if (blockError) {
        results.push({ index: i, topic: topicZh, success: false, error: blockError });
        continue;
      }

      const keywordDisplay = dedupeKeywordsCaseInsensitive([keyword]);
      const keywords = normalizeKeywords(keywordDisplay);
      const archaeologyQuestionIds = await findArchaeologyQuestionIdsByKeywords(
        subject,
        keywords
      );

      const definition = generated.definition;
      const conclusion = generated.conclusion;
      // 批量生成一律直接視為完整骨架卡，不落回卡樁
      const isStub = false;

      const payload = {
        subject,
        topic: topicZh,
        topicEn,
        keywords,
        keywordDisplay,
        archaeologyQuestionIds,
        relatedCardIds: [] as string[],
        prompts: [] as string[],
        heat: 0,
        isStub,
        definition,
        blocks,
        conclusion,
        confidence: 0,
        lastReviewedAt: null,
        buildDurationSec: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const ref = await adminDb.collection("skeletonCards").add(payload);
      results.push({ index: i, topic: topicZh, success: true, id: ref.id, isStub });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "產生骨架卡內容失敗";
      results.push({ index: i, topic: topicZh, success: false, error: message });
    }
  }

  return NextResponse.json({ results });
}
