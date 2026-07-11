import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type KeyPointItem = {
  questionId: string;
  subject: string;
  questionText: string;
  keyPoints: string[];
  analyzedAt: string | null;
};

/** 速讀重點：彙整所有已批改題目的考題重點 */
export async function GET() {
  try {
    const snapshot = await adminDb
      .collection("attempts")
      .where("status", "in", ["analyzed", "flashcards_ready"])
      .limit(500)
      .get();

    const raw = snapshot.docs
      .map((doc) => {
        const data = doc.data() as {
          subject?: string;
          analysis?: { examKeyPoints?: unknown };
          analyzedAt?: { toDate?: () => Date } | null;
        };
        const keyPoints = Array.isArray(data.analysis?.examKeyPoints)
          ? data.analysis.examKeyPoints.filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0
            )
          : [];
        return {
          questionId: doc.id,
          subject: typeof data.subject === "string" ? data.subject : "",
          keyPoints,
          analyzedAt:
            typeof data.analyzedAt?.toDate === "function"
              ? data.analyzedAt.toDate().toISOString()
              : null,
        };
      })
      .filter((item) => item.keyPoints.length > 0);

    if (raw.length === 0) {
      return NextResponse.json([]);
    }

    // 批次補上題目文字（一次 getAll，避免 N+1）
    const questionSnaps = await adminDb.getAll(
      ...raw.map((item) =>
        adminDb.collection("questions").doc(item.questionId)
      )
    );
    const textMap = new Map<string, string>();
    for (const snap of questionSnaps) {
      if (!snap.exists) continue;
      const data = snap.data() as { questionText?: string; title?: string };
      const text =
        (typeof data.questionText === "string" && data.questionText) ||
        (typeof data.title === "string" && data.title) ||
        "";
      textMap.set(snap.id, text);
    }

    const items: KeyPointItem[] = raw
      .map((item) => ({
        ...item,
        questionText: textMap.get(item.questionId) ?? "",
      }))
      .sort((a, b) => {
        const ta = a.analyzedAt ?? "";
        const tb = b.analyzedAt ?? "";
        return tb.localeCompare(ta);
      });

    return NextResponse.json(items);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch key points";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
