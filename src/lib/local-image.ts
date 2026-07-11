// 作答附圖走本機 public/ 資料夾（不經 Firebase Storage）。
// 使用者輸入 "erd.png"、"answer-images/erd.png" 或 "public/answer-images/erd.png"
// 一律正規化成以 "/" 開頭、相對 public/ 的路徑；http(s) 網址原樣保留。
export function normalizeLocalImagePath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  let normalized = trimmed.replace(/\\/g, "/");
  normalized = normalized.replace(/^\.?\//, "");
  if (normalized.toLowerCase().startsWith("public/")) {
    normalized = normalized.slice("public/".length);
  }
  if (!normalized) return null;
  return `/${normalized}`;
}

export function isPersistableImageUrl(
  value: string | null | undefined
): value is string {
  return !!value && (value.startsWith("http") || value.startsWith("/"));
}
