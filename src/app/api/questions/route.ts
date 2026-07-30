import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  normalizeKeywords,
} from "@/lib/keywords";
import { isQuestionArchived } from "@/lib/archive";
import { textSimilarity } from "@/lib/similarity";
import { normalizeSubject, subjectQueryValues } from "@/lib/subjects";

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
  isArchaeology?: boolean;
  archived?: boolean;
};

function getCreatedAtMillis(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as { toMillis?: () => number };
  if (typeof candidate.toMillis === "function") {
    const millis = candidate.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

type QuestionBody = {
  questionId?: string;
  questionText?: string;
  title?: string;
  subject?: string;
  year?: number;
  score?: number;
  imageUrl?: string | null;
  isArchaeology?: boolean;
  allowDuplicate?: boolean;
};

const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject")?.trim() ?? "";
    const keyword = normalizeKeyword(searchParams.get("keyword") ?? "");
    const archaeologyOnly =
      searchParams.get("archaeology") === "1" ||
      searchParams.get("archaeology") === "true";
    const includeArchived =
      searchParams.get("includeArchived") === "1" ||
      searchParams.get("includeArchived") === "true";

    const subjectValues = subject ? subjectQueryValues(subject) : [];
    let docs: Array<{ id: string } & Omit<QuestionDoc, "id">> = [];

    if (subjectValues.length === 0) {
      const snapshot = await adminDb
        .collection("questions")
        .orderBy("createdAt", "desc")
        .limit(300)
        .get();
      docs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<QuestionDoc, "id">),
      }));
    } else if (subjectValues.length === 1) {
      const snapshot = await adminDb
        .collection("questions")
        .where("subject", "==", subjectValues[0])
        .get();
      docs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<QuestionDoc, "id">),
      }));
    } else {
      // 含舊別名時分別查詢再合併（例如 資料庫應用 ↔ 資通庫應用）
      const snapshots = await Promise.all(
        subjectValues.map((value) =>
          adminDb.collection("questions").where("subject", "==", value).get()
        )
      );
      const seen = new Set<string>();
      for (const snapshot of snapshots) {
        for (const doc of snapshot.docs) {
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          docs.push({
            id: doc.id,
            ...(doc.data() as Omit<QuestionDoc, "id">),
          });
        }
      }
    }

    if (subjectValues.length > 0) {
      docs = docs
        .sort(
          (a, b) =>
            getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt)
        )
        .slice(0, 300);
    }

    if (keyword) {
      const attemptsWithKeyword = await adminDb
        .collection("attempts")
        .where("keywords", "array-contains", keyword)
        .get();
      const allowedIds = new Set(attemptsWithKeyword.docs.map((doc) => doc.id));
      docs = docs.filter((doc) => allowedIds.has(doc.id));
    }

    if (archaeologyOnly) {
      docs = docs.filter((doc) => doc.isArchaeology === true);
    }

    if (!includeArchived) {
      docs = docs.filter((doc) => !isQuestionArchived(doc));
    }

    // 狀態與關鍵字優先使用 question 文件上的鏡射欄位（attempts PUT 時會同步），
    // 缺狀態或缺關鍵字鏡射的舊資料用單次 getAll 批次補查（避免 N+1）。
    const docsNeedingFallback = docs.filter((doc) => {
      const hasStatus =
        typeof doc.latestAttemptStatus === "string" ||
        typeof doc.latestDraft?.status === "string";
      const hasMirroredKeywords =
        (Array.isArray(doc.latestAttemptKeywordDisplay) &&
          doc.latestAttemptKeywordDisplay.length > 0) ||
        (Array.isArray(doc.latestAttemptKeywords) &&
          doc.latestAttemptKeywords.length > 0);
      return !hasStatus || !hasMirroredKeywords;
    });
    const fallbackAttempts = new Map<
      string,
      { status?: string; keywords?: string[]; keywordDisplay?: string[] }
    >();
    if (docsNeedingFallback.length > 0) {
      const refs = docsNeedingFallback.map((doc) =>
        adminDb.collection("attempts").doc(doc.id)
      );
      const snapshots = await adminDb.getAll(...refs);
      for (const snap of snapshots) {
        if (!snap.exists) continue;
        fallbackAttempts.set(
          snap.id,
          snap.data() as {
            status?: string;
            keywords?: string[];
            keywordDisplay?: string[];
          }
        );
      }
    }

    const data = docs.map((doc) => {
      const fallback = fallbackAttempts.get(doc.id);
      const latestAttemptStatus =
        typeof doc.latestAttemptStatus === "string"
          ? doc.latestAttemptStatus
          : typeof doc.latestDraft?.status === "string"
            ? doc.latestDraft.status
            : typeof fallback?.status === "string"
              ? fallback.status
              : null;

      const mirroredKeywords = normalizeKeywords(doc.latestAttemptKeywords);
      const latestKeywords =
        mirroredKeywords.length > 0
          ? mirroredKeywords
          : normalizeKeywords(fallback?.keywords);
      const mirroredKeywordDisplay = dedupeKeywordsCaseInsensitive(
        Array.isArray(doc.latestAttemptKeywordDisplay)
          ? doc.latestAttemptKeywordDisplay
          : doc.latestAttemptKeywords ?? []
      );
      const latestKeywordDisplay =
        mirroredKeywordDisplay.length > 0
          ? mirroredKeywordDisplay
          : dedupeKeywordsCaseInsensitive(
              Array.isArray(fallback?.keywordDisplay)
                ? fallback.keywordDisplay
                : fallback?.keywords ?? []
            );

      return {
        id: doc.id,
        subject: doc.subject ?? "",
        year: doc.year ?? 0,
        score: doc.score ?? 100,
        questionText: doc.questionText ?? doc.title ?? "",
        imageUrl: doc.imageUrl ?? null,
        isArchaeology: doc.isArchaeology === true,
        createdAt: doc.createdAt ?? null,
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
  const subject =
    typeof body.subject === "string" ? normalizeSubject(body.subject) : "";
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
  const allowDuplicate = body.allowDuplicate === true;
  const isArchaeology = body.isArchaeology === true;

  if (!subject || (!questionText && !title)) {
    return NextResponse.json(
      { error: "subject and questionText (or title) are required" },
      { status: 400 }
    );
  }

  try {
    const normalizedQuestionText = questionText || title;

    if (!allowDuplicate) {
      const sameSubjectSnapshot = await adminDb
        .collection("questions")
        .where("subject", "==", subject)
        .select("questionText", "title", "year")
        .limit(500)
        .get();

      const duplicates = sameSubjectSnapshot.docs
        .filter((doc) => !isQuestionArchived(doc.data()))
        .map((doc) => {
          const data = doc.data() as {
            questionText?: string;
            title?: string;
            year?: number;
          };
          const existingText = String(data.questionText ?? data.title ?? "");
          return {
            id: doc.id,
            year: typeof data.year === "number" ? data.year : null,
            questionText:
              existingText.length > 120
                ? `${existingText.slice(0, 120)}…`
                : existingText,
            similarity: textSimilarity(normalizedQuestionText, existingText),
          };
        })
        .filter((item) => item.similarity >= DUPLICATE_SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      if (duplicates.length > 0) {
        return NextResponse.json(
          {
            error: "偵測到相似題目，可能已經存在",
            duplicates,
          },
          { status: 409 }
        );
      }
    }

    const payload = {
      title: title || normalizedQuestionText,
      subject,
      year,
      score,
      questionText: normalizedQuestionText,
      imageUrl,
      isArchaeology,
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
