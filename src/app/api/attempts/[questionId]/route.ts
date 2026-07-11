import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { AnalysisResult } from "@/types/analysis";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  normalizeKeywords,
  sanitizeKeyword,
} from "@/lib/keywords";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    questionId: string;
  }>;
};

type AttemptStatus =
  | "draft"
  | "completed"
  | "analyzed"
  | "analyze_failed"
  | "flashcards_ready";

type AttemptBody = {
  text?: string;
  imageUrl?: string | null;
  status?: AttemptStatus;
  errorMessage?: string | null;
  analysis?: AnalysisResult | null;
  keywords?: string[];
  keywordDisplay?: string[];
  /** true 時刪除已儲存的批改結果（analysis 欄位） */
  clearAnalysis?: boolean;
};

function normalizeStatus(input: unknown): AttemptStatus {
  if (
    input === "draft" ||
    input === "completed" ||
    input === "analyzed" ||
    input === "analyze_failed" ||
    input === "flashcards_ready"
  ) {
    return input;
  }
  return "draft";
}

async function upsertKeywordCollection(keywordDisplay: string[]) {
  if (keywordDisplay.length === 0) return;
  const batch = adminDb.batch();
  for (const item of keywordDisplay) {
    const keyword = normalizeKeyword(item);
    if (!keyword) continue;
    const ref = adminDb.collection("keywords").doc(keyword);
    batch.set(
      ref,
      {
        keyword,
        displayKeyword: sanitizeKeyword(item),
        usageCount: FieldValue.increment(1),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
}

export async function GET(_request: Request, context: RouteContext) {
  const { questionId } = await context.params;
  if (!questionId) {
    return NextResponse.json({ error: "Missing question id" }, { status: 400 });
  }

  try {
    const attemptSnap = await adminDb.collection("attempts").doc(questionId).get();
    if (attemptSnap.exists) {
      const data = attemptSnap.data() as {
        text?: string;
        imageUrl?: string | null;
        status?: AttemptStatus;
        errorMessage?: string | null;
        analysis?: AnalysisResult | null;
        keywords?: string[];
        keywordDisplay?: string[];
      };

      return NextResponse.json({
        id: questionId,
        text: typeof data.text === "string" ? data.text : "",
        imageUrl:
          typeof data.imageUrl === "string" && data.imageUrl.trim()
            ? data.imageUrl
            : null,
        status: normalizeStatus(data.status),
        errorMessage:
          typeof data.errorMessage === "string" && data.errorMessage.trim()
            ? data.errorMessage
            : null,
        analysis: data.analysis ?? null,
        keywords: normalizeKeywords(data.keywords),
        keywordDisplay: dedupeKeywordsCaseInsensitive(
          Array.isArray(data.keywordDisplay) ? data.keywordDisplay : data.keywords ?? []
        ),
      });
    }

    // Backward compatibility: fallback to legacy mirrored draft fields in questions.
    const questionSnap = await adminDb.collection("questions").doc(questionId).get();
    if (!questionSnap.exists) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const q = questionSnap.data() as {
      latestDraft?: {
        text?: string;
        imageUrl?: string | null;
        status?: AttemptStatus;
        errorMessage?: string | null;
        keywords?: string[];
      };
      latestAnalysis?: AnalysisResult | null;
    };

    if (!q.latestDraft) {
      return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: questionId,
      text: typeof q.latestDraft.text === "string" ? q.latestDraft.text : "",
      imageUrl:
        typeof q.latestDraft.imageUrl === "string" && q.latestDraft.imageUrl.trim()
          ? q.latestDraft.imageUrl
          : null,
      status: normalizeStatus(q.latestDraft.status),
      errorMessage:
        typeof q.latestDraft.errorMessage === "string" &&
        q.latestDraft.errorMessage.trim()
          ? q.latestDraft.errorMessage
          : null,
      analysis: q.latestAnalysis ?? null,
      keywords: normalizeKeywords(q.latestDraft.keywords),
      keywordDisplay: dedupeKeywordsCaseInsensitive(q.latestDraft.keywords ?? []),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch attempt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { questionId } = await context.params;
  if (!questionId) {
    return NextResponse.json({ error: "Missing question id" }, { status: 400 });
  }

  let body: AttemptBody;
  try {
    body = (await request.json()) as AttemptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0
      ? body.imageUrl.trim()
      : null;
  const status = normalizeStatus(body.status);
  const errorMessage =
    typeof body.errorMessage === "string" && body.errorMessage.trim().length > 0
      ? body.errorMessage.trim()
      : null;
  const analysis = body.analysis ?? null;
  const keywordDisplay = dedupeKeywordsCaseInsensitive(
    Array.isArray(body.keywordDisplay) ? body.keywordDisplay : body.keywords ?? []
  );
  const keywords = normalizeKeywords(keywordDisplay);

  const attemptPayload: Record<string, unknown> = {
    questionId,
    text,
    imageUrl,
    status,
    errorMessage,
    keywords,
    keywordDisplay,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (analysis) {
    attemptPayload.analysis = analysis;
    attemptPayload.analyzedAt = FieldValue.serverTimestamp();
  } else if (body.clearAnalysis === true) {
    attemptPayload.analysis = FieldValue.delete();
    attemptPayload.analyzedAt = FieldValue.delete();
  }

  if (status === "completed") {
    attemptPayload.completedAt = FieldValue.serverTimestamp();
  }

  if (status === "flashcards_ready") {
    attemptPayload.flashcardsGeneratedAt = FieldValue.serverTimestamp();
  }

  try {
    const questionRef = adminDb.collection("questions").doc(questionId);
    const questionSnap = await questionRef.get();
    if (!questionSnap.exists) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    const questionData = questionSnap.data() as { subject?: string } | undefined;
    const subject =
      typeof questionData?.subject === "string" ? questionData.subject.trim() : "";

    const attemptRef = adminDb.collection("attempts").doc(questionId);
    const previousAttemptSnap = await attemptRef.get();
    const previousKeywords = new Set(
      normalizeKeywords(
        (previousAttemptSnap.data() as { keywords?: string[] } | undefined)
          ?.keywords
      )
    );

    await attemptRef.set(
      {
        ...attemptPayload,
        subject,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    // 只對這次新加入的關鍵字遞增 usageCount，避免每次儲存草稿都灌水
    const newKeywordDisplay = keywordDisplay.filter(
      (item) => !previousKeywords.has(normalizeKeyword(item))
    );
    await upsertKeywordCollection(newKeywordDisplay);

    await questionRef.set(
      {
        latestAttemptStatus: status,
        latestAttemptUpdatedAt: FieldValue.serverTimestamp(),
        latestAttemptKeywords: keywords,
        latestAttemptKeywordDisplay: keywordDisplay,
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      id: questionId,
      status,
      keywords,
      keywordDisplay,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save attempt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
