import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type QuestionBody = {
  questionText?: string;
  title?: string;
  subject?: string;
  year?: number;
  imageUrl?: string | null;
};

export async function GET() {
  try {
    const snapshot = await adminDb
      .collection("questions")
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();

    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: QuestionBody;
  try {
    body = (await request.json()) as QuestionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionText =
    typeof body.questionText === "string" ? body.questionText.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const year =
    typeof body.year === "number" && Number.isFinite(body.year)
      ? body.year
      : new Date().getFullYear();
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0
      ? body.imageUrl.trim()
      : null;

  if (!subject || (!questionText && !title)) {
    return NextResponse.json(
      { error: "subject and questionText (or title) are required" },
      { status: 400 }
    );
  }

  try {
    const normalizedQuestionText = questionText || title;
    const ref = await adminDb.collection("questions").add({
      title: title || normalizedQuestionText,
      subject,
      year,
      questionText: normalizedQuestionText,
      imageUrl,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
