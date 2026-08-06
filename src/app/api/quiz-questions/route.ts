import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type QuizQuestionInput = {
  cardId?: string;
  questionId?: string | null;
  subject?: string;
  keywords?: string[];
  question?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
};

type SaveBody = {
  questions?: QuizQuestionInput[];
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject")?.trim() ?? "";

    const snapshot = await adminDb
      .collection("quizQuestions")
      .orderBy("createdAt", "desc")
      .limit(5000)
      .get();

    let items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));

    if (subject) {
      items = items.filter(
        (item) => (item as { subject?: string }).subject === subject
      );
    }

    return NextResponse.json(items);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch quiz questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 刪除某張字卡對應的選擇題：DELETE /api/quiz-questions?cardId=xxx */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const cardId = searchParams.get("cardId")?.trim() ?? "";
  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  try {
    const snapshot = await adminDb
      .collection("quizQuestions")
      .where("cardId", "==", cardId)
      .get();
    if (snapshot.empty) {
      return NextResponse.json({ deleted: 0 });
    }
    const batch = adminDb.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    return NextResponse.json({ deleted: snapshot.size });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete quiz questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inputs = Array.isArray(body.questions) ? body.questions : [];
  const normalized = inputs
    .map((item) => {
      const cardId = typeof item.cardId === "string" ? item.cardId.trim() : "";
      const question =
        typeof item.question === "string" ? item.question.trim() : "";
      const options = Array.isArray(item.options)
        ? item.options
            .map((o) => (typeof o === "string" ? o.trim() : ""))
            .filter(Boolean)
        : [];
      const correctIndex =
        typeof item.correctIndex === "number" ? item.correctIndex : -1;
      const explanation =
        typeof item.explanation === "string" ? item.explanation.trim() : "";
      if (
        !cardId ||
        !question ||
        options.length !== 4 ||
        correctIndex < 0 ||
        correctIndex > 3 ||
        !explanation
      ) {
        return null;
      }
      return {
        cardId,
        questionId:
          typeof item.questionId === "string" && item.questionId
            ? item.questionId
            : null,
        subject: typeof item.subject === "string" ? item.subject.trim() : "",
        keywords: Array.isArray(item.keywords)
          ? item.keywords.filter((k): k is string => typeof k === "string")
          : [],
        question,
        options,
        correctIndex,
        explanation,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (normalized.length === 0) {
    return NextResponse.json(
      { error: "questions must contain at least one valid item" },
      { status: 400 }
    );
  }

  try {
    const cardIds = Array.from(new Set(normalized.map((q) => q.cardId)));
    const existingSnapshot = await adminDb
      .collection("quizQuestions")
      .where("cardId", "in", cardIds.slice(0, 30))
      .get();
    const existingCardIds = new Set(
      existingSnapshot.docs.map((doc) => (doc.data() as { cardId?: string }).cardId)
    );

    const toCreate = normalized.filter((q) => !existingCardIds.has(q.cardId));

    if (toCreate.length === 0) {
      return NextResponse.json(
        { createdIds: [], skipped: normalized.length },
        { status: 200 }
      );
    }

    const batch = adminDb.batch();
    const created: string[] = [];
    for (const q of toCreate) {
      const ref = adminDb.collection("quizQuestions").doc();
      created.push(ref.id);
      batch.set(ref, {
        ...q,
        correctCount: 0,
        wrongCount: 0,
        lastResult: null,
        lastAnsweredAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return NextResponse.json(
      { createdIds: created, skipped: normalized.length - toCreate.length },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save quiz questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
