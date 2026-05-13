import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing question id" }, { status: 400 });
  }

  try {
    const snap = await adminDb.collection("questions").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: snap.id,
      ...snap.data(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing question id" }, { status: 400 });
  }

  try {
    const [flashcardsSnap, notesSnap] = await Promise.all([
      adminDb.collection("flashcards").where("questionId", "==", id).get(),
      adminDb.collection("studyNotes").where("questionId", "==", id).get(),
    ]);

    const refsToDelete = [
      adminDb.collection("questions").doc(id),
      ...flashcardsSnap.docs.map((doc) => doc.ref),
      ...notesSnap.docs.map((doc) => doc.ref),
    ];

    let batch = adminDb.batch();
    let opCount = 0;
    for (const ref of refsToDelete) {
      batch.delete(ref);
      opCount += 1;
      if (opCount === 450) {
        await batch.commit();
        batch = adminDb.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        question: 1,
        flashcards: flashcardsSnap.size,
        notes: notesSnap.size,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
