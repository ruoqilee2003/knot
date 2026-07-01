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

type DraftBody = {
  text?: string;
  imageUrl?: string | null;
  status?:
    | "draft"
    | "completed"
    | "analyzed"
    | "analyze_failed"
    | "flashcards_ready";
  errorMessage?: string | null;
  analysis?: AnalysisResult | null;
  keywords?: string[];
  keywordDisplay?: string[];
};

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
    const snap = await adminDb.collection("questions").doc(questionId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    const data = snap.data() as {
      latestDraft?: {
        text?: string;
        imageUrl?: string | null;
        status?: string;
        errorMessage?: string | null;
        keywords?: string[];
        keywordDisplay?: string[];
      };
      latestAnalysis?: DraftBody["analysis"];
    };
    if (!data.latestDraft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: questionId,
      ...data.latestDraft,
      analysis: data.latestAnalysis ?? null,
      keywords: normalizeKeywords(data.latestDraft.keywords),
      keywordDisplay: dedupeKeywordsCaseInsensitive(
        Array.isArray(data.latestDraft.keywordDisplay)
          ? data.latestDraft.keywordDisplay
          : data.latestDraft.keywords ?? []
      ),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { questionId } = await context.params;
  if (!questionId) {
    return NextResponse.json({ error: "Missing question id" }, { status: 400 });
  }

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0
      ? body.imageUrl.trim()
      : null;
  const status = body.status ?? "draft";
  const errorMessage =
    typeof body.errorMessage === "string" && body.errorMessage.trim().length > 0
      ? body.errorMessage.trim()
      : null;
  const analysis = body.analysis ?? null;
  const keywordDisplay = dedupeKeywordsCaseInsensitive(
    Array.isArray(body.keywordDisplay) ? body.keywordDisplay : body.keywords ?? []
  );
  const keywords = normalizeKeywords(keywordDisplay);

  const questionMirrorPayload: Record<string, unknown> = {
    latestDraft: {
      text,
      imageUrl,
      status,
      errorMessage,
      keywords,
      keywordDisplay,
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
  if (analysis) {
    questionMirrorPayload.latestAnalysis = analysis;
    questionMirrorPayload.latestAnalyzedAt = FieldValue.serverTimestamp();
  }

  try {
    const questionRef = adminDb.collection("questions").doc(questionId);
    const questionSnap = await questionRef.get();
    const questionData = questionSnap.data() as { subject?: string } | undefined;
    const subject =
      typeof questionData?.subject === "string" ? questionData.subject.trim() : "";
    await questionRef.set(questionMirrorPayload, { merge: true });
    await adminDb
      .collection("attempts")
      .doc(questionId)
      .set(
        {
          questionId,
          subject,
          text,
          imageUrl,
          status,
          errorMessage,
          analysis,
          keywords,
          keywordDisplay,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    await upsertKeywordCollection(keywordDisplay);
    await questionRef.set(
      {
        latestAttemptStatus: status,
        latestAttemptUpdatedAt: FieldValue.serverTimestamp(),
        latestAttemptKeywords: keywords,
        latestAttemptKeywordDisplay: keywordDisplay,
      },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
