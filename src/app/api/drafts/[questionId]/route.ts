import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    questionId: string;
  }>;
};

type DraftBody = {
  text?: string;
  imageUrl?: string | null;
  status?: "draft" | "analyzed" | "analyze_failed";
  errorMessage?: string | null;
  analysis?: {
    examKeyPoints: string[];
    answerFeedback: string;
    improvementSuggestions: string;
    flashcards: Array<{
      front: string;
      back: string;
    }>;
  } | null;
};

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

  const questionMirrorPayload: Record<string, unknown> = {
    latestDraft: {
      text,
      imageUrl,
      status,
      errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
  if (analysis) {
    questionMirrorPayload.latestAnalysis = analysis;
    questionMirrorPayload.latestAnalyzedAt = FieldValue.serverTimestamp();
  }

  try {
    await adminDb
      .collection("questions")
      .doc(questionId)
      .set(questionMirrorPayload, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
