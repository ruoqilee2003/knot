import { PRESET_SUBJECTS } from "@/lib/subjects";

export const MAX_HEAT = 3;
/** @deprecated 請改用 PRESET_SUBJECTS；保留別名以免舊 import 壞掉 */
export const SKELETON_SUBJECTS = PRESET_SUBJECTS;

/** 半形標點自動轉全形，供定義/分類/逐點展開/結論等輸入框使用 */
export function toFullWidthPunctuation(value: string): string {
  return value
    .replace(/,/g, "，")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/:/g, "：")
    .replace(/;/g, "；");
}

export type SkeletonPoint = {
  key: string;
  hint?: string;
};

export type SkeletonBlock = {
  label: string;
  note?: string;
  count: number;
  points: SkeletonPoint[];
};

export type SkeletonCardShape = {
  definition?: string;
  conclusion?: string;
  blocks?: SkeletonBlock[];
};

/** 每個 block 的 count 必須是正整數，且 points 不能超過 count（硬限制） */
export function validateBlocks(blocks: SkeletonBlock[]): string | null {
  for (const block of blocks) {
    if (!Number.isInteger(block.count) || block.count <= 0) {
      return `分類「${block.label || "未命名"}」的數量必須是正整數`;
    }
    if (block.points.length > block.count) {
      return `分類「${block.label}」的逐點展開不能超過 ${block.count} 項`;
    }
  }
  return null;
}

/** 完整度判斷：定義/結論非空、每個 block 的 points 都補滿 count，決定 isStub */
export function isCardComplete(card: SkeletonCardShape): boolean {
  const definition = (card.definition ?? "").trim();
  const conclusion = (card.conclusion ?? "").trim();
  const blocks = card.blocks ?? [];
  if (!definition) return false;
  if (!conclusion) return false;
  if (blocks.length === 0) return false;
  return blocks.every(
    (block) =>
      block.count === block.points.length &&
      block.points.every((point) => point.key.trim().length > 0)
  );
}

type RawBlockInput = {
  label?: string;
  note?: string;
  count?: number;
  points?: Array<{ key?: string; hint?: string }>;
};

/**
 * 把 API 收到的原始 block 陣列清理成可以直接寫進 Firestore 的形狀。
 * 刻意不要輸出 `undefined` 的 note/hint 欄位——Firestore 的 set() 不接受 undefined 值，
 * 只能整個省略該欄位（用可選欄位語意，不是「欄位存在但值是 undefined」）。
 * 列點只要有重點或提示其中之一就保留（允許先只填提示）。
 */
export function sanitizeBlocks(input: RawBlockInput[] | undefined): SkeletonBlock[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((block) => {
      const label = typeof block.label === "string" ? block.label.trim() : "";
      const note = typeof block.note === "string" ? block.note.trim() : "";
      const count =
        typeof block.count === "number" && Number.isFinite(block.count)
          ? Math.floor(block.count)
          : 0;
      const points = Array.isArray(block.points)
        ? block.points
            .map((point) => {
              const key = typeof point.key === "string" ? point.key.trim() : "";
              const hint = typeof point.hint === "string" ? point.hint.trim() : "";
              return hint ? { key, hint } : { key };
            })
            .filter((point) => point.key || point.hint)
        : [];
      const base = { label, count, points };
      return note ? { ...base, note } : base;
    })
    .filter((block) => block.label);
}

export type ReviewableCard = {
  heat: number;
  confidence: number;
};

/** 複習牌組排序：熱度遞減、同熱度信心遞增（刻意不洗牌，優先複習高熱度＋低信心的卡） */
export function sortForReview<T extends ReviewableCard>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) => b.heat - a.heat || a.confidence - b.confidence
  );
}
