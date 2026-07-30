import { isQuestionArchived } from "@/lib/archive";
import { adminDb } from "@/lib/firebase-admin";
import { subjectsMatch } from "@/lib/subjects";

/**
 * 依科目＋關鍵字找出應自動連結的題目 ID（寫入 archaeologyQuestionIds）。
 * 關鍵字以 attempts 為準；同科、未封存即可，不要求 isArchaeology
 * （練習題若已掛上相同關鍵字，也應能作為「考過的問法」佐證）。
 */
export async function findArchaeologyQuestionIdsByKeywords(
  subject: string,
  normalizedKeywords: string[]
): Promise<string[]> {
  const keywords = normalizedKeywords.filter(Boolean);
  if (!subject.trim() || keywords.length === 0) return [];

  const matchedAttemptIds = new Set<string>();
  for (let i = 0; i < keywords.length; i += 10) {
    const chunk = keywords.slice(i, i + 10);
    const snap = await adminDb
      .collection("attempts")
      .where("keywords", "array-contains-any", chunk)
      .get();
    for (const doc of snap.docs) {
      matchedAttemptIds.add(doc.id);
    }
  }

  if (matchedAttemptIds.size === 0) return [];

  const ids = Array.from(matchedAttemptIds);
  const snaps = await adminDb.getAll(
    ...ids.map((id) => adminDb.collection("questions").doc(id))
  );

  const result: string[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() as {
      subject?: string;
      archived?: boolean;
      archivedAt?: unknown;
    };
    if (isQuestionArchived(data)) continue;
    if (!subjectsMatch(String(data.subject ?? ""), subject)) continue;
    result.push(snap.id);
  }
  return result;
}
