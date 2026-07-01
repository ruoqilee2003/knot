export function normalizeKeyword(input: string): string {
  return input.trim().toLowerCase().replace(/^#+/, "");
}

export function sanitizeKeyword(input: string): string {
  return input.trim().replace(/^#+/, "");
}

export function normalizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => (typeof item === "string" ? item : ""))
        .map((item) => sanitizeKeyword(item))
        .map((item) => normalizeKeyword(item))
        .filter(Boolean)
    )
  );
}

export function parseKeywordInput(input: string): string[] {
  return dedupeKeywordsCaseInsensitive(
    input
      .split(/[\s,，、]+/g)
      .map((token) => sanitizeKeyword(token))
      .filter(Boolean)
  );
}

export function dedupeKeywordsCaseInsensitive(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const token = sanitizeKeyword(raw);
    if (!token) continue;
    const normalized = normalizeKeyword(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(token);
  }
  return Array.from(
    out
  );
}
