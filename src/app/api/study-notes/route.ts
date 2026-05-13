import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type NoteBody = {
  title?: string;
  body?: string;
  questionId?: string;
  subject?: string;
};

function makeNoteTitleFromQuestion(questionText: string): string {
  const normalized = questionText.replace(/\s+/g, " ").trim();
  if (!normalized) return "未命名題目";
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}

export async function GET() {
  try {
    const snapshot = await adminDb
      .collection("studyNotes")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const notes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json(notes);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch notes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: NoteBody;
  try {
    body = (await request.json()) as NoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const noteBody = typeof body.body === "string" ? body.body.trim() : "";
  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";

  if (!noteBody || !questionId) {
    return NextResponse.json(
      { error: "body and questionId are required" },
      { status: 400 }
    );
  }

  try {
    const questionSnap = await adminDb.collection("questions").doc(questionId).get();
    const questionData = questionSnap.data() as { questionText?: string; title?: string } | undefined;
    const sourceText = String(
      questionData?.questionText ?? questionData?.title ?? body.title ?? ""
    );
    const title = makeNoteTitleFromQuestion(sourceText);

    const existingSnapshot = await adminDb
      .collection("studyNotes")
      .where("questionId", "==", questionId)
      .get();
    const duplicate = existingSnapshot.docs.find((doc) => {
      const data = doc.data() as { body?: string };
      const existingBody = String(data.body ?? "").trim();
      return existingBody === noteBody;
    });

    if (duplicate) {
      await duplicate.ref.set({ title, subject }, { merge: true });
      return NextResponse.json(
        { id: duplicate.id, deduped: true, message: "Note already exists" },
        { status: 200 }
      );
    }

    const ref = await adminDb.collection("studyNotes").add({
      title,
      body: noteBody,
      questionId,
      subject,
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ id: ref.id, deduped: false }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
