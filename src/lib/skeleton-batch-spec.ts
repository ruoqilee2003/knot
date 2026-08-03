/**
 * 解析批量新增骨架卡用的半結構化文字格式，例如：
 *
 * 科目：作業系統
 * 1. 特權指令，Privileged Instruction，Privileged-Instruction（定義，目的，七種分類 配套，400字）
 * 2. 雙模式運算，Dual Mode Operation，Dual-Mode-Operation（定義，目的，運作，優缺，400字）
 *
 * 每行格式：中文主題，英文主題，關鍵字（內容重點...，字數）
 */

export type BatchSkeletonItem = {
  raw: string;
  topicZh: string;
  topicEn: string;
  keyword: string;
  aspects: string[];
  wordCount: number | null;
};

export type BatchSkeletonSpec = {
  subject: string;
  items: BatchSkeletonItem[];
};

const FULLWIDTH_COMMA = /[，,]/;
const OPEN_PAREN = /[（(]/;
const CLOSE_PAREN = /[）)]/g;
const WORD_COUNT_RE = /^(\d+)\s*字$/;

/**
 * 關鍵字未另外填寫時的預設衍生規則：優先用英文主題、空格改成連字號
 * （例如 "Transfer Rate" → "Transfer-Rate"）；沒有英文主題才退回中文主題。
 */
export function deriveKeywordFromTopic(topicEn: string, topicZh: string): string {
  const source = topicEn.trim() || topicZh.trim();
  return source.replace(/\s+/g, "-");
}

function splitTopLevel(text: string): string[] {
  return text
    .split(FULLWIDTH_COMMA)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripLeadingNumbering(line: string): string {
  return line.replace(/^\s*\d+[.、．)]\s*/, "").trim();
}

/** 解析單行為一張骨架卡的產生規格；解析失敗回傳 null 並附上原因 */
function parseItemLine(
  rawLine: string
): { item: BatchSkeletonItem } | { error: string } {
  const line = stripLeadingNumbering(rawLine);
  if (!line) return { error: "空白行" };

  const openIdx = line.search(OPEN_PAREN);
  if (openIdx === -1) {
    return { error: `缺少括號內的內容需求：「${rawLine}」` };
  }

  const head = line.slice(0, openIdx).trim();
  const inner = line
    .slice(openIdx + 1)
    .replace(CLOSE_PAREN, "")
    .trim();

  const headParts = splitTopLevel(head);
  if (headParts.length === 0) {
    return { error: `缺少主題名稱：「${rawLine}」` };
  }
  const topicZh = headParts[0] ?? "";
  const topicEn = headParts[1] ?? "";
  const keyword = (headParts[2] ?? deriveKeywordFromTopic(topicEn, topicZh)).trim();

  if (!topicZh) {
    return { error: `缺少中文主題名稱：「${rawLine}」` };
  }

  const innerParts = splitTopLevel(inner);
  let wordCount: number | null = null;
  const aspects: string[] = [];
  for (const part of innerParts) {
    const match = WORD_COUNT_RE.exec(part);
    if (match) {
      wordCount = Number(match[1]);
    } else if (part) {
      aspects.push(part);
    }
  }

  if (aspects.length === 0) {
    return { error: `括號內缺少內容重點：「${rawLine}」` };
  }

  return {
    item: { raw: rawLine, topicZh, topicEn, keyword, aspects, wordCount },
  };
}

/** 解析整段批量輸入文字，回傳解析結果與逐行錯誤訊息（不會拋例外） */
export function parseBatchSkeletonSpec(text: string): {
  spec: BatchSkeletonSpec | null;
  errors: string[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { spec: null, errors: ["請輸入內容"] };
  }

  let subject = "";
  const itemLines: string[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    const subjectMatch = /^科目[：:]\s*(.+)$/.exec(line);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      continue;
    }
    itemLines.push(line);
  }

  if (!subject) {
    errors.push("找不到「科目：」開頭的那一行");
  }

  const items: BatchSkeletonItem[] = [];
  for (const line of itemLines) {
    const result = parseItemLine(line);
    if ("error" in result) {
      errors.push(result.error);
    } else {
      items.push(result.item);
    }
  }

  if (items.length === 0) {
    errors.push("沒有解析出任何骨架卡項目");
  }

  if (!subject || items.length === 0) {
    return { spec: null, errors };
  }

  return { spec: { subject, items }, errors };
}
