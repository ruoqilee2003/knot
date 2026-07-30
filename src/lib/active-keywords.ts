import { adminDb } from "@/lib/firebase-admin";
import { normalizeKeyword, sanitizeKeyword } from "@/lib/keywords";

export type ActiveKeywordStat = {
  keyword: string;
  usageCount: number;
  normalized: string;
};

type KeywordCountMap = Map<string, { keyword: string; usageCount: number }>;

function addKeywordsFromDisplayList(
  counts: KeywordCountMap,
  displayList: unknown
) {
  if (!Array.isArray(displayList)) return;
  const seen = new Set<string>();
  for (const raw of displayList) {
    if (typeof raw !== "string") continue;
    const normalized = normalizeKeyword(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const keyword = sanitizeKeyword(raw);
    const existing = counts.get(normalized);
    if (existing) {
      existing.usageCount += 1;
    } else {
      counts.set(normalized, { keyword, usageCount: 1 });
    }
  }
}

/**
 * 彙整可用關鍵字：
 * - 未封存題目的 attempts（每題每關鍵字計 1）
 * - 骨架卡（每卡每關鍵字計 1）
 */
export async function getActiveKeywordStats(
  archivedIds: Set<string>,
  limit = 12
): Promise<ActiveKeywordStat[]> {
  const [attemptsSnap, skeletonSnap] = await Promise.all([
    adminDb
      .collection("attempts")
      .select("keywords", "keywordDisplay")
      .limit(2000)
      .get(),
    adminDb
      .collection("skeletonCards")
      .select("keywords", "keywordDisplay")
      .limit(2000)
      .get(),
  ]);

  const counts: KeywordCountMap = new Map();

  for (const doc of attemptsSnap.docs) {
    if (archivedIds.has(doc.id)) continue;
    const data = doc.data() as {
      keywords?: unknown;
      keywordDisplay?: unknown;
    };
    const displayList = Array.isArray(data.keywordDisplay)
      ? data.keywordDisplay
      : data.keywords;
    addKeywordsFromDisplayList(counts, displayList);
  }

  for (const doc of skeletonSnap.docs) {
    const data = doc.data() as {
      keywords?: unknown;
      keywordDisplay?: unknown;
    };
    const displayList = Array.isArray(data.keywordDisplay)
      ? data.keywordDisplay
      : data.keywords;
    addKeywordsFromDisplayList(counts, displayList);
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
