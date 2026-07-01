import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type ExportBody = {
  questionIds?: string[];
  subject?: string;
  keyword?: string;
};

type QuestionDoc = {
  questionText?: string;
  title?: string;
};

type AttemptDoc = {
  text?: string;
  keywords?: string[];
  status?: string;
};

function normalizeKeyword(input: string): string {
  return input.trim().toLowerCase().replace(/^#+/, "");
}

function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    )
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function POST(request: Request) {
  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionIds = normalizeIds(body.questionIds);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const keyword = typeof body.keyword === "string" ? normalizeKeyword(body.keyword) : "";

  if (questionIds.length === 0 && !subject && !keyword) {
    return NextResponse.json(
      { error: "questionIds, subject, keyword 至少要提供一項" },
      { status: 400 }
    );
  }

  try {
    const attemptsCollection = adminDb.collection("attempts");
    let attemptIds = questionIds;

    if (attemptIds.length === 0) {
      let query: FirebaseFirestore.Query = attemptsCollection;
      if (subject) {
        query = query.where("subject", "==", subject);
      }
      if (keyword) {
        query = query.where("keywords", "array-contains", keyword);
      }
      const snap = await query.get();
      attemptIds = Array.from(new Set(snap.docs.map((doc) => doc.id)));
    }

    if (attemptIds.length === 0) {
      return NextResponse.json({ records: [] });
    }

    const questionRecords: Array<{ question: string; answer: string }> = [];
    const idChunks = chunk(attemptIds, 10);

    for (const ids of idChunks) {
      const [attemptSnap, questionSnap] = await Promise.all([
        attemptsCollection.where("__name__", "in", ids).get(),
        adminDb.collection("questions").where("__name__", "in", ids).get(),
      ]);

      const attemptsMap = new Map<string, AttemptDoc>();
      const questionsMap = new Map<string, QuestionDoc>();

      for (const doc of attemptSnap.docs) {
        attemptsMap.set(doc.id, doc.data() as AttemptDoc);
      }
      for (const doc of questionSnap.docs) {
        questionsMap.set(doc.id, doc.data() as QuestionDoc);
      }

      for (const id of ids) {
        const attempt = attemptsMap.get(id);
        const question = questionsMap.get(id);
        if (!attempt || !question) continue;
        const answer = typeof attempt.text === "string" ? attempt.text.trim() : "";
        if (!answer) continue;
        const questionText = String(
          question.questionText ?? question.title ?? ""
        ).trim();
        if (!questionText) continue;
        questionRecords.push({
          question: questionText,
          answer,
        });
      }
    }

    return NextResponse.json({ records: questionRecords });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
