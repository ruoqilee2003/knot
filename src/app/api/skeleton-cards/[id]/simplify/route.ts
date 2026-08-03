import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { SkeletonBlock } from "@/lib/skeleton-cards";

export const runtime = "nodejs";
export const maxDuration = 60;

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const EXPLAIN_PROMPT = `你是一個很會用簡單比喻講解硬知識的老師。請把使用者提供的「骨架卡」內容，改寫成一段連小朋友都能聽懂的白話說明。

規則：
- 100 字以內（繁體中文，含標點）。
- 只能用生活化的比喻和簡單詞彙，不要出現艱深術語或縮寫；若必須提到專有名詞，要順便用大白話解釋它是什麼。
- 只要把最核心的概念講清楚就好，不用涵蓋所有細節。
- 只輸出說明文字本身，不要加標題、不要加引號、不要有多餘說明。`;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "伺服器未設定 ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  const ref = adminDb.collection("skeletonCards").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "找不到骨架卡" }, { status: 404 });
  }

  const data = snap.data() as {
    topic?: string;
    definition?: string;
    blocks?: SkeletonBlock[];
    conclusion?: string;
  };

  const blocksText = (data.blocks ?? [])
    .map((block) => {
      const points = block.points
        .map((point) => (point.hint ? `${point.key}（${point.hint}）` : point.key))
        .join("、");
      return `${block.label}${block.note ? `（${block.note}）` : ""}：${points}`;
    })
    .join("\n");

  const userMessage = [
    `主題：${data.topic ?? ""}`,
    `定義：${data.definition ?? ""}`,
    blocksText ? `分類架構：\n${blocksText}` : "",
    `結論：${data.conclusion ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      output_config: { effort: "low" },
      system: EXPLAIN_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("模型沒有回傳內容");
    }

    await ref.set(
      { simpleExplanation: text, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return NextResponse.json({ simpleExplanation: text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "生成白話說明失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
