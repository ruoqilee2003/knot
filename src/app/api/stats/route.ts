import { NextResponse } from "next/server";
import { getActiveKeywordStats } from "@/lib/active-keywords";
import { getArchivedQuestionIds, isQuestionArchived } from "@/lib/archive";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type SubjectStat = {
  subject: string;
  total: number;
  completed: number;
  analyzed: number;
  flashcards: number;
  skeletonCards: number;
};

const DONE_STATUSES = new Set(["completed", "analyzed", "flashcards_ready"]);
const ANALYZED_STATUSES = new Set(["analyzed", "flashcards_ready"]);

function toMillis(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as { toMillis?: () => number };
  if (typeof candidate.toMillis === "function") {
    const millis = candidate.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

export async function GET() {
  try {
    const [
      questionsSnap,
      attemptsSnap,
      flashcardsSnap,
      skeletonCardsSnap,
      quizQuestionsSnap,
    ] = await Promise.all([
      adminDb
        .collection("questions")
        .select("subject", "latestAttemptStatus", "latestDraft", "archived")
        .limit(2000)
        .get(),
      adminDb
        .collection("attempts")
        .select("subject", "status", "updatedAt")
        .limit(2000)
        .get(),
      adminDb
        .collection("flashcards")
        .select("subject", "questionId", "rememberCount", "forgetCount")
        .limit(5000)
        .get(),
      adminDb
        .collection("skeletonCards")
        .select("subject", "updatedAt", "confidence", "reviewCount")
        .limit(2000)
        .get(),
      adminDb
        .collection("quizQuestions")
        .select("correctCount", "wrongCount")
        .limit(5000)
        .get(),
    ]);

    const subjectMap = new Map<string, SubjectStat>();
    const ensureSubject = (subject: string): SubjectStat => {
      const key = subject || "未分類";
      let stat = subjectMap.get(key);
      if (!stat) {
        stat = {
          subject: key,
          total: 0,
          completed: 0,
          analyzed: 0,
          flashcards: 0,
          skeletonCards: 0,
        };
        subjectMap.set(key, stat);
      }
      return stat;
    };

    const archivedIds = await getArchivedQuestionIds();

    let totalQuestions = 0;
    let totalCompleted = 0;
    let totalAnalyzed = 0;
    let totalFlashcards = 0;
    let totalSkeletonCards = 0;
    let totalFlashcardReviews = 0;
    let totalSkeletonReviews = 0;
    let totalQuizQuestions = 0;
    let totalQuizReviews = 0;
    let totalQuizCorrect = 0;
    let totalQuizWrong = 0;

    for (const doc of questionsSnap.docs) {
      const data = doc.data() as {
        subject?: string;
        latestAttemptStatus?: string;
        latestDraft?: { status?: string };
        archived?: boolean;
      };
      if (isQuestionArchived(data) || archivedIds.has(doc.id)) continue;
      const status =
        typeof data.latestAttemptStatus === "string"
          ? data.latestAttemptStatus
          : typeof data.latestDraft?.status === "string"
            ? data.latestDraft.status
            : "";
      const stat = ensureSubject(
        typeof data.subject === "string" ? data.subject.trim() : ""
      );
      stat.total += 1;
      totalQuestions += 1;
      if (DONE_STATUSES.has(status)) {
        stat.completed += 1;
        totalCompleted += 1;
      }
      if (ANALYZED_STATUSES.has(status)) {
        stat.analyzed += 1;
        totalAnalyzed += 1;
      }
    }

    for (const doc of flashcardsSnap.docs) {
      const data = doc.data() as {
        subject?: string;
        questionId?: string;
        rememberCount?: number;
        forgetCount?: number;
      };
      const questionId =
        typeof data.questionId === "string" ? data.questionId : "";
      if (questionId && archivedIds.has(questionId)) continue;
      const stat = ensureSubject(
        typeof data.subject === "string" ? data.subject.trim() : ""
      );
      stat.flashcards += 1;
      totalFlashcards += 1;

      const rememberCount =
        typeof data.rememberCount === "number" ? data.rememberCount : 0;
      const forgetCount =
        typeof data.forgetCount === "number" ? data.forgetCount : 0;
      totalFlashcardReviews += rememberCount + forgetCount;
    }

    for (const doc of quizQuestionsSnap.docs) {
      const data = doc.data() as {
        correctCount?: number;
        wrongCount?: number;
      };
      totalQuizQuestions += 1;
      const correctCount =
        typeof data.correctCount === "number" ? data.correctCount : 0;
      const wrongCount = typeof data.wrongCount === "number" ? data.wrongCount : 0;
      totalQuizCorrect += correctCount;
      totalQuizWrong += wrongCount;
      totalQuizReviews += correctCount + wrongCount;
    }

    // 最近活動（依日期統計作答 + 骨架卡）
    const dailyActivity = new Map<string, number>();

    for (const doc of skeletonCardsSnap.docs) {
      const data = doc.data() as {
        subject?: string;
        updatedAt?: unknown;
        confidence?: number;
        reviewCount?: number;
      };
      const stat = ensureSubject(
        typeof data.subject === "string" ? data.subject.trim() : ""
      );
      stat.skeletonCards += 1;
      totalSkeletonCards += 1;

      // 累計複習次數
      if (typeof data.reviewCount === "number" && data.reviewCount > 0) {
        totalSkeletonReviews += data.reviewCount;
      }

      const updatedAt = toMillis(data.updatedAt);
      if (updatedAt) {
        const date = new Date(updatedAt);
        const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        dailyActivity.set(dayKey, (dailyActivity.get(dayKey) || 0) + 1);
      }
    }

    for (const doc of attemptsSnap.docs) {
      if (archivedIds.has(doc.id)) continue;
      const updatedAt = toMillis((doc.data() as { updatedAt?: unknown }).updatedAt);
      if (!updatedAt) continue;
      const date = new Date(updatedAt);
      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      dailyActivity.set(dayKey, (dailyActivity.get(dayKey) || 0) + 1);
    }

    // 取前 5 天
    const topDays = Array.from(dailyActivity.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .sort((a, b) => a[0].localeCompare(b[0]));

    const topActivity = topDays.map(([dayKey, count]) => {
      const [, month, day] = dayKey.split("-");
      return { date: `${parseInt(month)}/${parseInt(day)}`, count };
    });

    const topKeywords = (await getActiveKeywordStats(archivedIds, 12)).map(
      (item) => ({
        keyword: item.keyword,
        usageCount: item.usageCount,
      })
    );

    const subjects = Array.from(subjectMap.values())
      .filter(
        (subject) =>
          subject.total > 0 ||
          subject.completed > 0 ||
          subject.analyzed > 0 ||
          subject.flashcards > 0 ||
          subject.skeletonCards > 0
      )
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      totals: {
        questions: totalQuestions,
        completed: totalCompleted,
        analyzed: totalAnalyzed,
        flashcards: totalFlashcards,
        skeletonCards: totalSkeletonCards,
        flashcardReviews: totalFlashcardReviews,
        skeletonReviews: totalSkeletonReviews,
        quizQuestions: totalQuizQuestions,
        quizReviews: totalQuizReviews,
        quizCorrect: totalQuizCorrect,
        quizWrong: totalQuizWrong,
      },
      subjects,
      topActivity,
      topKeywords,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
