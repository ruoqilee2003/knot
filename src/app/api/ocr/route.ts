import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";

export const maxDuration = 60;

// OCR 用最便宜的模型即可，辨識文字不需要推理能力
const DEFAULT_OCR_MODEL = "gemini-2.5-flash-lite";
const FALLBACK_OCR_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];

type OcrBody = {
  imageBase64?: string;
  mimeType?: string;
};

const OCR_PROMPT = `你是文字辨識助手。請把圖片中的考題文字完整辨識出來，規則：
1) 只輸出辨識出的文字本身，不要任何說明、前言或 markdown。
2) 保留題目原本的分段與編號（例如（一）（二）、1. 2.）。
3) 使用繁體中文輸出；英文與數字照原樣保留。
4) 中文語句中的標點使用全形（，；。：（））。
5) 若圖片中有與題目無關的頁眉、頁碼、浮水印，請忽略。
6) 若完全無法辨識出文字，輸出空字串。`;

const CJK_RE =
  /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

const HALF_TO_FULL_PUNCT: Record<string, string> = {
  ",": "，",
  ";": "；",
  ".": "。",
  ":": "：",
};

/**
 * 半形標點正規化為全形：括號一律轉換；逗號/分號/句號/冒號只在接於中日韓字元
 * 之後時轉換，避免破壞小數（3.14）、時間（10:30）、英文句子等。
 */
function normalizeOcrPunctuation(input: string): string {
  return input
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/([\s\S])([,;.:])/g, (match, prev: string, punct: string) =>
      CJK_RE.test(prev) ? `${prev}${HALF_TO_FULL_PUNCT[punct]}` : match
    );
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "伺服器未設定 GEMINI_API_KEY" },
      { status: 500 }
    );
  }

  let body: OcrBody;
  try {
    body = (await request.json()) as OcrBody;
  } catch {
    return NextResponse.json({ error: "無效的 JSON 本文" }, { status: 400 });
  }

  const imageBase64 =
    typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  if (!imageBase64 || !mimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "請提供圖片（imageBase64 與 mimeType）" },
      { status: 400 }
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const parts: Part[] = [
    { text: OCR_PROMPT },
    { inlineData: { mimeType, data: imageBase64 } },
  ];

  const candidateModels = Array.from(
    new Set([
      process.env.GEMINI_OCR_MODEL || DEFAULT_OCR_MODEL,
      ...FALLBACK_OCR_MODELS,
    ])
  );

  try {
    let text = "";
    let lastError: unknown = null;

    for (const candidate of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: candidate,
          generationConfig: { temperature: 0 },
        });
        const result = await model.generateContent({
          contents: [{ role: "user", parts }],
        });
        text = result.response.text().trim();
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

    if (!text && lastError) {
      throw lastError;
    }

    if (!text) {
      return NextResponse.json(
        { error: "無法從圖片辨識出文字，請換一張更清晰的圖片" },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: normalizeOcrPunctuation(text) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "OCR 辨識失敗";
    const busy =
      message.toLowerCase().includes("overloaded") ||
      message.toLowerCase().includes("unavailable") ||
      message.toLowerCase().includes("high demand");
    if (busy) {
      return NextResponse.json(
        { error: "系統忙碌中，請再試一次" },
        { status: 503 }
      );
    }
    if (
      message.includes("429") ||
      message.toLowerCase().includes("quota exceeded") ||
      message.toLowerCase().includes("too many requests")
    ) {
      return NextResponse.json(
        { error: "Gemini API 配額不足（429），請稍後再試" },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
