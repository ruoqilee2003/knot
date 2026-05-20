import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type QuestionBody = {
  questionId?: string;
  questionText?: string;
  title?: string;
  subject?: string;
  year?: number;
  score?: number;
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
  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const year =
    typeof body.year === "number" && Number.isFinite(body.year)
      ? body.year
      : new Date().getFullYear();
  const score =
    typeof body.score === "number" && Number.isFinite(body.score) && body.score > 0
      ? body.score
      : 100;
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
    const payload = {
      title: title || normalizedQuestionText,
      subject,
      year,
      score,
      questionText: normalizedQuestionText,
      imageUrl,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (questionId) {
      const targetRef = adminDb.collection("questions").doc(questionId);
      const existing = await targetRef.get();
      if (existing.exists) {
        return NextResponse.json({ error: "題目 ID 已存在" }, { status: 409 });
      }
      await targetRef.set(payload);
      return NextResponse.json({ id: targetRef.id }, { status: 201 });
    }

    const ref = await adminDb.collection("questions").add(payload);

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
