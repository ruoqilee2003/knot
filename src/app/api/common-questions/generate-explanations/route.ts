import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_GEMINI_MODEL = "gemini-3-flash";
const FALLBACK_GEMINI_MODELS = [
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
const HIGH_DEMAND_ERROR_MESSAGE = "系統忙碌中，請再試一次";
const MAX_IDS_PER_CALL = 15;

type GenerateBody = {
  ids?: string[];
};

const SCHEMA_PROMPT = `你是台灣國家考試（共同科目：憲法、法學緒論、國文、英文等）的專業命題助教。
你會拿到一批四選一選擇題，每題都已標明正確答案（考生無法質疑或更改），請針對「每一題」撰寫詳解。
請輸出 **純 JSON**（不要 markdown、不要註解），格式固定如下：
{
  "explanations": [
    { "id": "對應輸入的題目 id，原樣照抄", "explanation": "詳解內容" }
  ]
}
規則：
1) 每一題輸入都必須產生恰好一筆輸出，id 要與輸入完全對應，不可遺漏或新增。
2) explanation 需說明正確選項為何正確，並逐一簡述其餘選項為何錯誤或不夠精確；若題目附有閱讀篇章或克漏字語境，請結合語境說明。
3) 不可質疑或更改題目給定的正確答案，一律以輸入的答案為準。
4) 全部使用繁體中文（英文詞彙、原文引用可保留原文），語句通順、簡潔扼要，避免贅字。
5) 不要產生示範文或多餘說明文字。`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "伺服器未設定 GEMINI_API_KEY" }, { status: 500 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "無效的 JSON 本文" }, { status: 400 });
  }

  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_IDS_PER_CALL);

  if (ids.length === 0) {
    return NextResponse.json({ error: "缺少要生成詳解的題目 id（ids）" }, { status: 400 });
  }

  type QuestionDoc = {
    id: string;
    stem: string;
    options: string[];
    answerIndex: number;
    passage: string | null;
  };

  let questions: QuestionDoc[];
  try {
    const refs = ids.map((id) => adminDb.collection("commonQuestions").doc(id));
    const snapshots = await adminDb.getAll(...refs);
    questions = snapshots
      .filter((snap) => snap.exists)
      .map((snap) => {
        const data = snap.data() as Record<string, unknown>;
        return {
          id: snap.id,
          stem: String(data.stem ?? ""),
          options: Array.isArray(data.options)
            ? (data.options as unknown[]).map((o) => String(o))
            : [],
          answerIndex: typeof data.answerIndex === "number" ? data.answerIndex : -1,
          passage: typeof data.passage === "string" ? data.passage : null,
        };
      })
      .filter((q) => q.stem && q.options.length === 4 && q.answerIndex >= 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "讀取題目失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (questions.length === 0) {
    return NextResponse.json({ error: "找不到可用的題目" }, { status: 400 });
  }

  const modelName = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const genAI = new GoogleGenerativeAI(apiKey);
  const optionLabels = ["A", "B", "C", "D"];

  const questionsListText = questions
    .map((q, i) => {
      const optionsText = q.options
        .map((opt, oi) => `(${optionLabels[oi]}) ${opt}`)
        .join("\n");
      return `${i + 1}. id="${q.id}"
${q.passage ? `【閱讀語境】\n${q.passage}\n` : ""}題幹：${q.stem}
選項：
${optionsText}
正確答案：(${optionLabels[q.answerIndex]})`;
    })
    .join("\n\n");

  const promptText = `${SCHEMA_PROMPT}

【題目清單】（共 ${questions.length} 題，請每題各出一筆詳解）
${questionsListText}`;

  const callModel = async (targetModel: string) => {
    const model = genAI.getGenerativeModel({
      model: targetModel,
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
    });
    return result.response.text();
  };

  const candidateModels = Array.from(new Set([modelName, ...FALLBACK_GEMINI_MODELS]));

  try {
    let text = "";
    let lastError: unknown = null;

    for (const candidate of candidateModels) {
      try {
        text = await callModel(candidate);
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const shouldTryNext =
          message.includes("404") ||
          message.toLowerCase().includes("not found") ||
          message.toLowerCase().includes("not supported") ||
          message.toLowerCase().includes("no longer available");
        if (!shouldTryNext) {
          throw error;
        }
      }
    }

    if (!text) {
      throw (
        lastError ??
        new Error(`No available Gemini models. Tried: ${candidateModels.join(", ")}`)
      );
    }

    const parsed = JSON.parse(text) as { explanations?: unknown };
    const validIds = new Set(questions.map((q) => q.id));

    const explanations = (
      Array.isArray(parsed.explanations) ? parsed.explanations : []
    )
      .map((item) => {
        if (typeof item !== "object" || item == null) return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === "string" ? obj.id.trim() : "";
        const explanation =
          typeof obj.explanation === "string" ? obj.explanation.trim() : "";
        if (!validIds.has(id) || !explanation) return null;
        return { id, explanation };
      })
      .filter((item): item is { id: string; explanation: string } => item !== null);

    if (explanations.length === 0) {
      return NextResponse.json(
        { error: "模型回傳缺少有效的詳解", raw: text },
        { status: 502 }
      );
    }

    const batch = adminDb.batch();
    for (const { id, explanation } of explanations) {
      batch.set(
        adminDb.collection("commonQuestions").doc(id),
        { explanation },
        { merge: true }
      );
    }
    await batch.commit();

    return NextResponse.json({ explanations });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini 呼叫失敗";
    const highDemand =
      message.toLowerCase().includes("high demand") ||
      message.toLowerCase().includes("overloaded") ||
      message.toLowerCase().includes("unavailable") ||
      message.toLowerCase().includes("resource exhausted");
    if (highDemand) {
      return NextResponse.json({ error: HIGH_DEMAND_ERROR_MESSAGE }, { status: 503 });
    }
    const quotaExceeded =
      message.includes("429") ||
      message.toLowerCase().includes("quota exceeded") ||
      message.toLowerCase().includes("too many requests");
    if (quotaExceeded) {
      return NextResponse.json(
        {
          error:
            "目前 Gemini API 配額不足（429）。請到 Google AI Studio 啟用/升級計費或更換有配額的 API Key 後再試。",
        },
        { status: 429 }
      );
    }
    const unavailableModel =
      message.includes("404") ||
      message.toLowerCase().includes("not found") ||
      message.toLowerCase().includes("not supported") ||
      message.toLowerCase().includes("no longer available");
    if (unavailableModel) {
      return NextResponse.json(
        {
          error:
            "目前設定的 Gemini 模型不可用。請改用較新模型（建議 gemini-2.5-flash）或更換 API Key 後重試。",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
