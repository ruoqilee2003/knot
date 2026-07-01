import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  normalizeKeywords,
} from "@/lib/keywords";

export const runtime = "nodejs";

type QuestionDoc = {
  id: string;
  subject?: string;
  year?: number;
  score?: number;
  questionText?: string;
  title?: string;
  imageUrl?: string | null;
  createdAt?: unknown;
  latestDraft?: {
    status?: string;
  };
  latestAttemptStatus?: string;
  latestAttemptKeywords?: string[];
  latestAttemptKeywordDisplay?: string[];
};

type AttemptDoc = {
  status?: string;
  keywords?: string[];
  keywordDisplay?: string[];
};

type QuestionBody = {
  questionId?: string;
  questionText?: string;
  title?: string;
  subject?: string;
  year?: number;
  score?: number;
  imageUrl?: string | null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject")?.trim() ?? "";
    const keyword = normalizeKeyword(searchParams.get("keyword") ?? "");

    let query: FirebaseFirestore.Query = adminDb.collection("questions");
    if (subject) {
      query = query.where("subject", "==", subject);
    }
    query = query.orderBy("createdAt", "desc").limit(300);

    const snapshot = await query.get();
    let docs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<QuestionDoc, "id">),
    }));

    if (keyword) {
      const attemptsWithKeyword = await adminDb
        .collection("attempts")
        .where("keywords", "array-contains", keyword)
        .get();
      const allowedIds = new Set(attemptsWithKeyword.docs.map((doc) => doc.id));
      docs = docs.filter((doc) => allowedIds.has(doc.id));
    }

    const attempts = await Promise.all(
      docs.map((doc) => adminDb.collection("attempts").doc(doc.id).get())
    );
    const attemptMap = new Map<string, AttemptDoc>();
    for (const attempt of attempts) {
      if (!attempt.exists) continue;
      attemptMap.set(attempt.id, attempt.data() as AttemptDoc);
    }

    const data = docs.map((doc) => {
      const attempt = attemptMap.get(doc.id);
      const latestAttemptStatus =
        typeof attempt?.status === "string"
          ? attempt.status
          : typeof doc.latestAttemptStatus === "string"
            ? doc.latestAttemptStatus
            : typeof doc.latestDraft?.status === "string"
              ? doc.latestDraft.status
              : null;

      const attemptKeywords = normalizeKeywords(attempt?.keywords);
      const attemptKeywordDisplay = dedupeKeywordsCaseInsensitive(
        Array.isArray(attempt?.keywordDisplay)
          ? attempt.keywordDisplay
          : attempt?.keywords ?? []
      );
      const latestKeywords =
        attemptKeywords.length > 0
          ? attemptKeywords
          : normalizeKeywords(doc.latestAttemptKeywords);
      const latestKeywordDisplay =
        attemptKeywordDisplay.length > 0
          ? attemptKeywordDisplay
          : dedupeKeywordsCaseInsensitive(
              Array.isArray(doc.latestAttemptKeywordDisplay)
                ? doc.latestAttemptKeywordDisplay
                : doc.latestAttemptKeywords ?? []
            );

      return {
        ...doc,
        latestAttemptStatus,
        latestKeywords,
        latestKeywordDisplay,
      };
    });

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
