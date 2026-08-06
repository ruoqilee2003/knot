import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_GEMINI_MODEL = "gemini-3-flash";
const FALLBACK_GEMINI_MODELS = [
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
const HIGH_DEMAND_ERROR_MESSAGE = "系統忙碌中，請再試一次";
const MAX_CARDS_PER_CALL = 15;

type CardInput = {
  id?: string;
  front?: string;
  back?: string;
};

type GenerateBody = {
  subject?: string;
  cards?: CardInput[];
};

const QUIZ_SCHEMA_PROMPT = `你是台灣國家考試（申論題）的專業命題助教，專長在以下考科：資通網路、資訊安全實務、資料庫應用、系統程式。
你會拿到一批「字卡」（正面是名詞或關鍵問句，背面是該題重點答案），請針對「每一張」字卡各出一題四選一的選擇題，幫助考生快速複習該字卡的概念。
請輸出 **純 JSON**（不要 markdown、不要註解），格式固定如下：
{
  "questions": [
    {
      "cardId": "對應輸入的字卡 id，原樣照抄",
      "question": "題幹（可直接沿用或改寫字卡正面的問題，須清楚明確）",
      "options": ["選項A", "選項B", "選項C", "選項D"],
      "correctIndex": 0,
      "explanation": "詳解：說明正確選項為何正確、其餘選項為何錯誤或不夠精確"
    }
  ]
}
規則：
1) 每張輸入字卡都必須產生恰好一題，cardId 要與輸入的字卡 id 完全對應，不可遺漏或新增。
2) 正確答案內容須忠實依據該字卡背面的重點，不要偏離或加入背面未提及的定義當作正解。
3) 錯誤選項（干擾項）須與正解主題相關、具有一定的混淆性（例如相似概念、常見誤解、相近但不同的專有名詞），不要出現明顯無關或荒謬的選項。
4) correctIndex 為正確選項在 options 陣列中的索引（0~3），且務必打亂正確答案的位置，不要每題都放在同一個索引。
5) explanation 需完整說明為什麼正解對、其他三個選項分別錯在哪裡，讓考生讀完就能理解整個概念，繁體中文，語句通順。
6) 全部使用繁體中文，不要產生示範文或多餘說明文字。`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "伺服器未設定 GEMINI_API_KEY" },
      { status: 500 }
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "無效的 JSON 本文" }, { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const cards = (Array.isArray(body.cards) ? body.cards : [])
    .map((c) => ({
      id: typeof c.id === "string" ? c.id.trim() : "",
      front: typeof c.front === "string" ? c.front.trim() : "",
      back: typeof c.back === "string" ? c.back.trim() : "",
    }))
    .filter((c) => c.id && c.front && c.back)
    .slice(0, MAX_CARDS_PER_CALL);

  if (cards.length === 0) {
    return NextResponse.json({ error: "缺少可用的字卡（cards）" }, { status: 400 });
  }

  const modelName = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const genAI = new GoogleGenerativeAI(apiKey);

  const cardsListText = cards
    .map((c, i) => `${i + 1}. id="${c.id}"\n正面：${c.front}\n背面：${c.back}`)
    .join("\n\n");

  const promptText = `${QUIZ_SCHEMA_PROMPT}

${subject ? `科目：${subject}\n\n` : ""}【字卡清單】（共 ${cards.length} 張，請每張各出一題）
${cardsListText}`;

  const callModel = async (targetModel: string) => {
    const model = genAI.getGenerativeModel({
      model: targetModel,
      generationConfig: {
        temperature: 0.5,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
    });
    return result.response.text();
  };

  const candidateModels = Array.from(
    new Set([modelName, ...FALLBACK_GEMINI_MODELS])
  );

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
        new Error(
          `No available Gemini models. Tried: ${candidateModels.join(", ")}`
        )
      );
    }

    const parsed = JSON.parse(text) as { questions?: unknown };
    const validCardIds = new Set(cards.map((c) => c.id));

    const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .map((item) => {
        if (typeof item !== "object" || item == null) return null;
        const obj = item as Record<string, unknown>;
        const cardId = typeof obj.cardId === "string" ? obj.cardId.trim() : "";
        const question =
          typeof obj.question === "string" ? obj.question.trim() : "";
        const options = Array.isArray(obj.options)
          ? obj.options
              .map((o) => (typeof o === "string" ? o.trim() : ""))
              .filter(Boolean)
          : [];
        const correctIndex =
          typeof obj.correctIndex === "number" ? obj.correctIndex : -1;
        const explanation =
          typeof obj.explanation === "string" ? obj.explanation.trim() : "";
        if (
          !validCardIds.has(cardId) ||
          !question ||
          options.length !== 4 ||
          correctIndex < 0 ||
          correctIndex > 3 ||
          !explanation
        ) {
          return null;
        }
        return { cardId, question, options, correctIndex, explanation };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "模型回傳缺少有效的選擇題", raw: text },
        { status: 502 }
      );
    }

    return NextResponse.json({ questions });
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
