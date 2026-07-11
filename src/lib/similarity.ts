/** 移除空白與標點、轉小寫，讓「同一題不同排版」能比對成功 */
export function normalizeQuestionText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

/** 字元 bigram 的 Jaccard 相似度（0~1），適合中文短文比對 */
export function textSimilarity(a: string, b: string): number {
  const normalizedA = normalizeQuestionText(a);
  const normalizedB = normalizeQuestionText(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  const gramsA = bigrams(normalizedA);
  const gramsB = bigrams(normalizedB);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return intersection / (gramsA.size + gramsB.size - intersection);
}
