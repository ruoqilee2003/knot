import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type FlashcardBody = {
  questionId?: string;
  attemptId?: string;
  subject?: string;
  cards?: Array<{
    front?: string;
    back?: string;
  }>;
};

export async function GET() {
  try {
    const snapshot = await adminDb
      .collection("flashcards")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const cards = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json(cards);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch flashcards";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 刪除某一題的全部字卡：DELETE /api/flashcards?questionId=xxx */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const questionId = searchParams.get("questionId")?.trim() ?? "";
  if (!questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }

  try {
    const snapshot = await adminDb
      .collection("flashcards")
      .where("questionId", "==", questionId)
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
      error instanceof Error ? error.message : "Failed to delete flashcards";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: FlashcardBody;
  try {
    body = (await request.json()) as FlashcardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const attemptId =
    typeof body.attemptId === "string" ? body.attemptId.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const cards = Array.isArray(body.cards) ? body.cards : [];
  if (!questionId || cards.length === 0) {
    return NextResponse.json(
      { error: "questionId and cards are required" },
      { status: 400 }
    );
  }

  const normalizedCards = cards
    .map((card) => ({
      front: typeof card.front === "string" ? card.front.trim() : "",
      back: typeof card.back === "string" ? card.back.trim() : "",
    }))
    .filter((card) => card.front && card.back);

  if (normalizedCards.length === 0) {
    return NextResponse.json(
      { error: "cards must contain at least one valid front/back pair" },
      { status: 400 }
    );
  }

  try {
    const existingSnapshot = await adminDb
      .collection("flashcards")
      .where("questionId", "==", questionId)
      .get();
    const existingKeys = new Set(
      existingSnapshot.docs.map((doc) => {
        const data = doc.data() as { front?: string; back?: string };
        return `${String(data.front ?? "").trim()}|||${String(data.back ?? "").trim()}`;
      })
    );

    const uniqueCards = normalizedCards.filter((card) => {
      const key = `${card.front}|||${card.back}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (uniqueCards.length === 0) {
      return NextResponse.json(
        {
          createdIds: [],
          skipped: normalizedCards.length,
          message: "All flashcards already exist",
        },
        { status: 200 }
      );
    }

    const batch = adminDb.batch();
    const created: string[] = [];
    for (const card of uniqueCards) {
      const ref = adminDb.collection("flashcards").doc();
      created.push(ref.id);
      batch.set(ref, {
        questionId,
        attemptId: attemptId || questionId,
        subject,
        front: card.front,
        back: card.back,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return NextResponse.json(
      {
        createdIds: created,
        skipped: normalizedCards.length - uniqueCards.length,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save flashcards";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
