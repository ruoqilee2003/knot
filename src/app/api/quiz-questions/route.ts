import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type QuizQuestionInput = {
  cardId?: string;
  pointRef?: string | null;
  sourceType?: "flashcard" | "skeleton";
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
      const sourceType = item.sourceType === "skeleton" ? "skeleton" : "flashcard";
      const pointRef =
        sourceType === "skeleton" && typeof item.pointRef === "string"
          ? item.pointRef.trim()
          : "";
      if (
        !cardId ||
        !question ||
        options.length !== 4 ||
        correctIndex < 0 ||
        correctIndex > 3 ||
        !explanation ||
        (sourceType === "skeleton" && !pointRef)
      ) {
        return null;
      }
      return {
        cardId,
        pointRef,
        sourceType,
        dedupeKey: `${cardId}::${pointRef}`,
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
    // 骨架卡一張卡可以有多題（每個 pointRef 各一題），去重要用 cardId+pointRef 複合鍵；
    // 舊資料／字卡沒有 pointRef，維持原本「同 cardId 只留一題」的行為
    const existingDedupeKeys = new Set(
      existingSnapshot.docs.map((doc) => {
        const data = doc.data() as { cardId?: string; pointRef?: string };
        return `${data.cardId ?? ""}::${data.pointRef ?? ""}`;
      })
    );

    const toCreate = normalized.filter(
      (q) => !existingDedupeKeys.has(q.dedupeKey)
    );

    if (toCreate.length === 0) {
      return NextResponse.json(
        { createdIds: [], skipped: normalized.length },
        { status: 200 }
      );
    }

    const batch = adminDb.batch();
    const created: string[] = [];
    for (const { dedupeKey, ...q } of toCreate) {
      void dedupeKey;
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
