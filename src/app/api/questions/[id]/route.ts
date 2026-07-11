import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateQuestionBody = {
  newId?: string;
  questionText?: string;
  title?: string;
  subject?: string;
  year?: number;
  score?: number;
  imageUrl?: string | null;
  isArchaeology?: boolean;
  archived?: boolean;
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
    const [flashcardsSnap, notesSnap, personalNotesSnap] = await Promise.all([
      adminDb.collection("flashcards").where("questionId", "==", id).get(),
      adminDb.collection("studyNotes").where("questionId", "==", id).get(),
      adminDb.collection("personalNotes").where("questionId", "==", id).get(),
    ]);

    const refsToDelete = [
      adminDb.collection("questions").doc(id),
      adminDb.collection("attempts").doc(id),
      ...flashcardsSnap.docs.map((doc) => doc.ref),
      ...notesSnap.docs.map((doc) => doc.ref),
      ...personalNotesSnap.docs.map((doc) => doc.ref),
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
        attempts: 1,
        flashcards: flashcardsSnap.size,
        notes: notesSnap.size,
        personalNotes: personalNotesSnap.size,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing question id" }, { status: 400 });
  }

  let body: UpdateQuestionBody;
  try {
    body = (await request.json()) as UpdateQuestionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.subject === "string") {
    const subject = body.subject.trim();
    if (!subject) {
      return NextResponse.json({ error: "subject cannot be empty" }, { status: 400 });
    }
    updates.subject = subject;
  }

  if (typeof body.questionText === "string") {
    const questionText = body.questionText.trim();
    if (!questionText) {
      return NextResponse.json(
        { error: "questionText cannot be empty" },
        { status: 400 }
      );
    }
    updates.questionText = questionText;
    updates.title = questionText;
  }

  if (typeof body.title === "string" && !("title" in updates)) {
    const title = body.title.trim();
    if (!title) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    updates.title = title;
  }

  if (typeof body.year === "number") {
    if (!Number.isFinite(body.year) || body.year <= 0) {
      return NextResponse.json({ error: "year must be valid" }, { status: 400 });
    }
    updates.year = body.year;
  }

  if (typeof body.score === "number") {
    if (!Number.isFinite(body.score) || body.score <= 0) {
      return NextResponse.json({ error: "score must be valid" }, { status: 400 });
    }
    updates.score = body.score;
  }

  // imageUrl 可設定也可清除（傳 null 或空字串代表移除附圖）
  if ("imageUrl" in body) {
    updates.imageUrl =
      typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0
        ? body.imageUrl.trim()
        : null;
  }

  if ("isArchaeology" in body) {
    updates.isArchaeology = body.isArchaeology === true;
  }

  if ("archived" in body) {
    if (body.archived === true) {
      updates.archived = true;
      updates.archivedAt = FieldValue.serverTimestamp();
    } else {
      updates.archived = false;
      updates.archivedAt = FieldValue.delete();
    }
  }

  if (Object.keys(updates).length === 0) {
    // allow id-only update; handled below
  }

  try {
    const sourceRef = adminDb.collection("questions").doc(id);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const newId = typeof body.newId === "string" ? body.newId.trim() : "";
    const shouldMove = newId.length > 0 && newId !== id;

    if (!shouldMove) {
      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: "At least one updatable field is required" },
          { status: 400 }
        );
      }
      await sourceRef.set(updates, { merge: true });
      if (typeof updates.subject === "string") {
        await adminDb
          .collection("attempts")
          .doc(id)
          .set({ subject: updates.subject }, { merge: true });
      }
      return NextResponse.json({ ok: true, id });
    }

    const targetRef = adminDb.collection("questions").doc(newId);
    const targetSnap = await targetRef.get();
    if (targetSnap.exists) {
      return NextResponse.json({ error: "題目 ID 已存在" }, { status: 409 });
    }

    const current = sourceSnap.data() ?? {};
    const nextData = { ...current, ...updates };

    const [flashcardsSnap, notesSnap, personalNotesSnap, attemptSnap] = await Promise.all([
      adminDb.collection("flashcards").where("questionId", "==", id).get(),
      adminDb.collection("studyNotes").where("questionId", "==", id).get(),
      adminDb.collection("personalNotes").where("questionId", "==", id).get(),
      adminDb.collection("attempts").doc(id).get(),
    ]);

    const refsToUpdate = [
      ...flashcardsSnap.docs.map((doc) => doc.ref),
      ...notesSnap.docs.map((doc) => doc.ref),
      ...personalNotesSnap.docs.map((doc) => doc.ref),
    ];

    let batch = adminDb.batch();
    let opCount = 0;
    batch.set(targetRef, nextData);
    opCount += 1;
    batch.delete(sourceRef);
    opCount += 1;
    if (attemptSnap.exists) {
      const nextAttemptData = {
        ...(attemptSnap.data() ?? {}),
        questionId: newId,
      };
      batch.set(adminDb.collection("attempts").doc(newId), nextAttemptData);
      opCount += 1;
      batch.delete(attemptSnap.ref);
      opCount += 1;
    }

    for (const ref of refsToUpdate) {
      batch.set(ref, { questionId: newId }, { merge: true });
      opCount += 1;
      if (opCount >= 420) {
        await batch.commit();
        batch = adminDb.batch();
        opCount = 0;
      }
    }
    if (typeof nextData.subject === "string" && attemptSnap.exists) {
      batch.set(
        adminDb.collection("attempts").doc(newId),
        { subject: nextData.subject },
        { merge: true }
      );
      opCount += 1;
    }
    if (opCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      id: newId,
      moved: true,
      updatedRefs: refsToUpdate.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
