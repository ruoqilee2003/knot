import { adminDb } from "@/lib/firebase-admin";
import { normalizeKeyword, sanitizeKeyword } from "@/lib/keywords";

export type ActiveKeywordStat = {
  keyword: string;
  usageCount: number;
  normalized: string;
};

/** 從未封存題目的 attempts 彙整關鍵字使用次數（每題每關鍵字計 1） */
export async function getActiveKeywordStats(
  archivedIds: Set<string>,
  limit = 12
): Promise<ActiveKeywordStat[]> {
  const attemptsSnap = await adminDb
    .collection("attempts")
    .select("keywords", "keywordDisplay")
    .limit(2000)
    .get();

  const counts = new Map<string, { keyword: string; usageCount: number }>();

  for (const doc of attemptsSnap.docs) {
    if (archivedIds.has(doc.id)) continue;
    const data = doc.data() as {
      keywords?: unknown;
      keywordDisplay?: unknown;
    };
    const displayList = Array.isArray(data.keywordDisplay)
      ? data.keywordDisplay
      : Array.isArray(data.keywords)
        ? data.keywords
        : [];

    const seenInAttempt = new Set<string>();
    for (const raw of displayList) {
      if (typeof raw !== "string") continue;
      const normalized = normalizeKeyword(raw);
      if (!normalized || seenInAttempt.has(normalized)) continue;
      seenInAttempt.add(normalized);
      const keyword = sanitizeKeyword(raw);
      const existing = counts.get(normalized);
      if (existing) {
        existing.usageCount += 1;
      } else {
        counts.set(normalized, { keyword, usageCount: 1 });
      }
    }
  }

  return Array.from(counts.entries())
    .map(([normalized, stat]) => ({
      normalized,
      keyword: stat.keyword,
      usageCount: stat.usageCount,
    }))
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount ||
        a.keyword.localeCompare(b.keyword, "zh-Hant")
    )
    .slice(0, limit);
}

export function filterActiveKeywordsByQuery(
  stats: ActiveKeywordStat[],
  query: string,
  limit: number
): ActiveKeywordStat[] {
  if (!query) return stats.slice(0, limit);
  return stats
    .filter(
      (item) =>
        item.normalized.includes(query) ||
        item.keyword.toLowerCase().includes(query)
    )
    .slice(0, limit);
}
