/** 「共同科目」選擇題匯入解析：把特定格式的 .md 題庫轉成結構化資料 */

export type ParsedCommonQuestion = {
  number: number;
  subjectLabel: string;
  stem: string;
  options: string[];
  answerIndex: number;
  passage: string | null;
};

export type ParsedCommonExam = {
  examName: string;
  questions: ParsedCommonQuestion[];
};

const ANSWER_LETTERS = ["A", "B", "C", "D"] as const;

function letterToIndex(letter: string): number {
  return ANSWER_LETTERS.indexOf(letter.toUpperCase() as (typeof ANSWER_LETTERS)[number]);
}

/** 解析「參、閱讀測驗篇章」區塊，回傳「題號 -> 篇章文字」的對照表 */
function parsePassages(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const passageSectionMatch = text.match(
    /##\s*[參参][、.]\s*[\s\S]*?(?=\n##\s|$)/
  );
  if (!passageSectionMatch) return map;
  const section = passageSectionMatch[0];

  const headingRegex = /###\s*.*?[（(]第\s*(\d+)\s*題(?:[至到]第?\s*(\d+)\s*題)?[）)]/g;
  const headingMatches = Array.from(section.matchAll(headingRegex));

  for (let i = 0; i < headingMatches.length; i++) {
    const match = headingMatches[i]!;
    const start = match.index! + match[0].length;
    const end =
      i + 1 < headingMatches.length ? headingMatches[i + 1]!.index! : section.length;
    const body = section.slice(start, end);

    const passageLines = body
      .split("\n")
      .filter((line) => line.trim().startsWith(">"))
      .map((line) => line.replace(/^\s*>\s?/, ""))
      .join("\n")
      .trim();
    if (!passageLines) continue;

    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    for (let n = from; n <= to; n++) {
      map.set(n, passageLines);
    }
  }

  return map;
}

/** 解析「壹、選擇題」區塊裡每一題所屬的科目小標（### 《xxx》） */
function parseSubjectLabels(text: string): Map<number, string> {
  const map = new Map<number, string>();
  let currentLabel = "";

  const lineRegex = /^(###\s+.*|####\s*第\s*(\d+)\s*題)$/gm;
  for (const match of text.matchAll(lineRegex)) {
    const line = match[0];
    if (line.startsWith("###") && !line.startsWith("####")) {
      currentLabel = line
        .replace(/^###\s*/, "")
        .replace(/[《》]/g, "")
        .trim();
    } else {
      const num = Number(match[2]);
      if (Number.isFinite(num)) {
        map.set(num, currentLabel);
      }
    }
  }
  return map;
}

/**
 * 解析 .md 題庫文字。格式範例：
 * # 110年 xxx 選擇題題目與解析
 * #### 第 1 題
 * - **答案**：(D)
 * - **題幹**：...
 * - **選項**：
 *   - (A) ...
 *   - (B) ...
 *   - (C) ...
 *   - (D) ...
 */
export function parseCommonQuestionsMarkdown(raw: string): ParsedCommonExam {
  const text = raw.replace(/\r\n/g, "\n");

  const titleMatch = text.match(/^#\s+(.+)$/m);
  const examName = titleMatch ? titleMatch[1]!.trim() : "";

  const passages = parsePassages(text);
  const subjectLabels = parseSubjectLabels(text);

  const blockRegex = /####\s*第\s*(\d+)\s*題\s*\n([\s\S]*?)(?=\n####\s*第\s*\d+\s*題|\n##\s|$)/g;
  const questions: ParsedCommonQuestion[] = [];

  for (const match of text.matchAll(blockRegex)) {
    const number = Number(match[1]);
    const block = match[2] ?? "";
    if (!Number.isFinite(number)) continue;

    const answerMatch = block.match(/\*\*答案\*\*[：:]\s*\(?([A-D])\)?/i);
    const stemMatch = block.match(/\*\*題幹\*\*[：:]\s*(.+)/);
    if (!answerMatch || !stemMatch) continue;

    const optionRegex = /^\s*-\s*\(([A-D])\)\s*(.+)$/gim;
    const optionsByLetter = new Map<string, string>();
    for (const optMatch of block.matchAll(optionRegex)) {
      optionsByLetter.set(optMatch[1]!.toUpperCase(), optMatch[2]!.trim());
    }
    const options = ANSWER_LETTERS.map((letter) => optionsByLetter.get(letter) ?? "");
    if (options.some((opt) => !opt)) continue;

    const answerIndex = letterToIndex(answerMatch[1]!);
    if (answerIndex < 0) continue;

    questions.push({
      number,
      subjectLabel: subjectLabels.get(number) ?? "",
      stem: stemMatch[1]!.trim(),
      options,
      answerIndex,
      passage: passages.get(number) ?? null,
    });
  }

  questions.sort((a, b) => a.number - b.number);

  return { examName, questions };
}
