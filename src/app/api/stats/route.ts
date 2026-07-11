import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type SubjectStat = {
  subject: string;
  total: number;
  completed: number;
  analyzed: number;
  flashcards: number;
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
    const [questionsSnap, attemptsSnap, flashcardsSnap, keywordsSnap] =
      await Promise.all([
        adminDb
          .collection("questions")
          .select("subject", "latestAttemptStatus", "latestDraft")
          .limit(2000)
          .get(),
        adminDb
          .collection("attempts")
          .select("subject", "status", "updatedAt")
          .limit(2000)
          .get(),
        adminDb.collection("flashcards").select("subject").limit(5000).get(),
        adminDb
          .collection("keywords")
          .orderBy("usageCount", "desc")
          .limit(12)
          .get(),
      ]);

    const subjectMap = new Map<string, SubjectStat>();
    const ensureSubject = (subject: string): SubjectStat => {
      const key = subject || "未分類";
      let stat = subjectMap.get(key);
      if (!stat) {
        stat = { subject: key, total: 0, completed: 0, analyzed: 0, flashcards: 0 };
        subjectMap.set(key, stat);
      }
      return stat;
    };

    let totalQuestions = 0;
    let totalCompleted = 0;
    let totalAnalyzed = 0;

    for (const doc of questionsSnap.docs) {
      const data = doc.data() as {
        subject?: string;
        latestAttemptStatus?: string;
        latestDraft?: { status?: string };
      };
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
      const data = doc.data() as { subject?: string };
      const stat = ensureSubject(
        typeof data.subject === "string" ? data.subject.trim() : ""
      );
      stat.flashcards += 1;
    }

    // 最近 8 週的作答活動（依 attempt 最後更新時間）
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 週一為每週起點
    const currentWeekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - dayOfWeek
    ).getTime();
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const start = currentWeekStart - (7 - i) * WEEK_MS;
      return { start, count: 0 };
    });

    for (const doc of attemptsSnap.docs) {
      const updatedAt = toMillis((doc.data() as { updatedAt?: unknown }).updatedAt);
      if (!updatedAt) continue;
      for (const week of weeks) {
        if (updatedAt >= week.start && updatedAt < week.start + WEEK_MS) {
          week.count += 1;
          break;
        }
      }
    }

    const weeklyActivity = weeks.map((week) => {
      const date = new Date(week.start);
      const label = `${date.getMonth() + 1}/${date.getDate()}`;
      return { weekStart: label, count: week.count };
    });

    const topKeywords = keywordsSnap.docs.map((doc) => {
      const data = doc.data() as {
        keyword?: string;
        displayKeyword?: string;
        usageCount?: number;
      };
      return {
        keyword: String(data.displayKeyword ?? data.keyword ?? doc.id),
        usageCount:
          typeof data.usageCount === "number" && Number.isFinite(data.usageCount)
            ? data.usageCount
            : 0,
      };
    });

    const subjects = Array.from(subjectMap.values()).sort(
      (a, b) => b.total - a.total
    );

    return NextResponse.json({
      totals: {
        questions: totalQuestions,
        completed: totalCompleted,
        analyzed: totalAnalyzed,
        flashcards: flashcardsSnap.size,
      },
      subjects,
      weeklyActivity,
      topKeywords,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
