/** 考科固定四科（題目、字卡、骨架卡、篩選共用） */
export const PRESET_SUBJECTS = [
  "資通網路",
  "資通安全",
  "資料庫應用",
  "作業系統",
] as const;

export type PresetSubject = (typeof PRESET_SUBJECTS)[number];

/** 舊資料別名 → 正式科名 */
const SUBJECT_ALIASES: Record<string, PresetSubject> = {
  資通庫應用: "資料庫應用",
};

export function isPresetSubject(value: string): value is PresetSubject {
  return (PRESET_SUBJECTS as readonly string[]).includes(value);
}

/** 正規化科名：trim、套用別名；無法對應時回傳原字串 */
export function normalizeSubject(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isPresetSubject(trimmed)) return trimmed;
  return SUBJECT_ALIASES[trimmed] ?? trimmed;
}

/** 篩選比對：兩邊都正規化後比較 */
export function subjectsMatch(a: string, b: string): boolean {
  return normalizeSubject(a) === normalizeSubject(b);
}

/**
 * Firestore `where("subject","==",…)` 要用的科名清單。
 * 含正規化後的正式名與會對應到它的舊別名（例如 資料庫應用 ↔ 資通庫應用）。
 */
export function subjectQueryValues(subject: string): string[] {
  const trimmed = subject.trim();
  if (!trimmed) return [];
  const normalized = normalizeSubject(trimmed);
  const values = new Set<string>([normalized]);
  if (trimmed !== normalized) values.add(trimmed);
  for (const [alias, target] of Object.entries(SUBJECT_ALIASES)) {
    if (target === normalized) values.add(alias);
  }
  return Array.from(values);
}
