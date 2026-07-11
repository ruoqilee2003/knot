import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";

export const maxDuration = 120;
// 批改用最新世代的 Flash（性價比檔）；名稱不可用時依序退回較舊的模型
const DEFAULT_GEMINI_MODEL = "gemini-3-flash";
const FALLBACK_GEMINI_MODELS = [
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
const HIGH_DEMAND_ERROR_MESSAGE = "系統忙碌中，請再試一次";

type AnalyzeBody = {
  questionText?: string;
  answerText?: string;
  answerImageBase64?: string;
  answerImageMimeType?: string;
  subject?: string;
  year?: number;
};

const ANALYSIS_SCHEMA_PROMPT = `你是台灣國家考試（申論題）的專業批改助教，專長在以下考科：資通網路、資訊安全實務、資料庫應用、系統程式。
請依「題目」與「考生答案」（可能來自圖片 OCR）分析，並輸出 **純 JSON**（不要 markdown、不要註解），鍵名固定如下：
{
  "examKeyPoints": ["重點1", "重點2", "..."],
  "flashcards": [
    { "front": "題目概念或關鍵問句", "back": "精簡答案重點（繁體中文）" }
  ]
}
規則：
1) 嚴格根據題目與考科判斷，不要離題。
2) examKeyPoints 為「考題重點」：3~6 點，依題目實際份量決定數量。每點要具體可用於答題，說明這題考的核心觀念、答題必須涵蓋的架構或關鍵詞，而不是空泛的方向；若考生答案有明顯遺漏或錯誤，直接在對應重點中指出應補上什麼。
3) flashcards 數量彈性（2~8 張），依這題實際考到的內容決定：每個重要名詞、協定、機制或流程各出一張，不要為了湊數而重複，也不要遺漏題目核心概念。每張卡正面是名詞或關鍵問句，背面是精簡但完整的答案重點。
4) 全部使用繁體中文。不要產生示範文。`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "伺服器未設定 GEMINI_API_KEY" },
      { status: 500 }
    );
  }

  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "無效的 JSON 本文" }, { status: 400 });
  }

  const {
    questionText,
    answerText,
    answerImageBase64,
    answerImageMimeType,
    subject,
    year,
  } = body;

  if (!questionText || typeof questionText !== "string") {
    return NextResponse.json({ error: "缺少 questionText" }, { status: 400 });
  }

  const normalizedAnswerText =
    typeof answerText === "string" ? answerText.trim() : "";
  const normalizedAnswerImageBase64 =
    typeof answerImageBase64 === "string" ? answerImageBase64 : "";
  const normalizedAnswerImageMimeType =
    typeof answerImageMimeType === "string" ? answerImageMimeType : "";

  const hasText = normalizedAnswerText.length > 0;
  const hasImage =
    normalizedAnswerImageBase64.length > 0 &&
    normalizedAnswerImageMimeType.length > 0;

  if (!hasText && !hasImage) {
    return NextResponse.json(
      { error: "請提供文字答案或手寫圖片（其一或兩者皆可）" },
      { status: 400 }
    );
  }

  const modelName = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const genAI = new GoogleGenerativeAI(apiKey);

  const meta: string[] = [];
  if (subject) meta.push(`科目：${subject}`);
  if (year != null) meta.push(`年份：${year}`);

  const userParts: Part[] = [];

  userParts.push({
    text: `${ANALYSIS_SCHEMA_PROMPT}

${meta.length ? meta.join("\n") + "\n\n" : ""}【題目】
${questionText}

【作答說明】
若附有手寫圖片，請先完整 OCR 辨識手寫內容，再與文字欄併讀（文字與圖片可能互補）。若僅有圖片，以 OCR 結果為考生答案。`,
  });

  if (hasText) {
    userParts.push({
      text: `【考生文字答案】\n${normalizedAnswerText}`,
    });
  }

  if (hasImage) {
    userParts.push({
      inlineData: {
        mimeType: normalizedAnswerImageMimeType,
        data: normalizedAnswerImageBase64,
      },
    });
    userParts.push({
      text: "上圖為考生手寫答案，請先 OCR 再一併批改。",
    });
  }

  const callModel = async (targetModel: string) => {
    const model = genAI.getGenerativeModel({
      model: targetModel,
      generationConfig: {
        temperature: 0.35,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: userParts }],
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

    const parsed = JSON.parse(text) as {
      examKeyPoints?: unknown;
      flashcards?: unknown;
    };

    // 數量彈性：只要求至少 1 點/1 張，超出上限的部分截斷，避免模型多給就整次失敗
    const examKeyPoints = (Array.isArray(parsed.examKeyPoints)
      ? parsed.examKeyPoints
      : []
    )
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 8);

    const flashcards = (Array.isArray(parsed.flashcards) ? parsed.flashcards : [])
      .map((item) => {
        if (typeof item !== "object" || item == null) return null;
        const front =
          typeof (item as { front?: string }).front === "string"
            ? (item as { front: string }).front.trim()
            : "";
        const back =
          typeof (item as { back?: string }).back === "string"
            ? (item as { back: string }).back.trim()
            : "";
        if (!front || !back) return null;
        return { front, back };
      })
      .filter((item): item is { front: string; back: string } => item !== null)
      .slice(0, 10);

    if (examKeyPoints.length === 0) {
      return NextResponse.json(
        { error: "模型回傳缺少 examKeyPoints", raw: text },
        { status: 502 }
      );
    }
    if (flashcards.length === 0) {
      return NextResponse.json(
        { error: "模型回傳缺少有效的 flashcards", raw: text },
        { status: 502 }
      );
    }

    return NextResponse.json({ examKeyPoints, flashcards });
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
