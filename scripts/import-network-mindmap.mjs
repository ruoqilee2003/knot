// 一次性匯入：把 scripts/data/network-mindmap-outline.md 的章節大綱匯入成
// 資通網路科目的骨架心智圖畫布（mindMaps/資通網路）。
// 葉節點會嘗試比對現有 skeletonCards（依 topic/topicEn/keywordDisplay），
// 比對到的存成 card 節點，比對不到的存成純文字節點（不會建立新的骨架卡）。
// 用法：
//   node scripts/import-network-mindmap.mjs            （dry-run，只印統計與比對結果）
//   node scripts/import-network-mindmap.mjs --apply     （實際寫入，會覆蓋該科目現有畫布）
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const SUBJECT = "資通網路";
const OUTLINE_PATH = path.join(process.cwd(), "scripts/data/network-mindmap-outline.md");
const ROOT_ID = "__root__";

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;
  const raw = fs.readFileSync(dotEnvPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// ---- 大綱解析 ----

function parseOutline(markdown) {
  const lines = markdown.split(/\r?\n/);
  const chapters = [];
  let currentChapter = null;
  let currentSub = null;
  let inCrossLinkSection = false;
  const crossLinkPairs = [];

  const chapterHeadingRe = /^##\s+([A-Z])\.\s*(.+?)\s*$/;
  const subHeadingRe = /^###\s+(.+?)\s*$/;
  const itemRe = /^-\s+(\d+)\s+(.+?)\s*$/;

  for (const line of lines) {
    if (/^##\s+跨章節/.test(line)) {
      inCrossLinkSection = true;
      continue;
    }
    if (inCrossLinkSection) {
      const m = line.match(/^-\s+([A-Z])\.\s*.+?↔\s*([A-Z])\.\s*.+?$/);
      if (m) crossLinkPairs.push([m[1], m[2]]);
      continue;
    }
    const chapterMatch = line.match(chapterHeadingRe);
    if (chapterMatch) {
      currentChapter = { code: chapterMatch[1], name: chapterMatch[2], subtopics: [] };
      chapters.push(currentChapter);
      currentSub = null;
      continue;
    }
    const subMatch = line.match(subHeadingRe);
    if (subMatch && currentChapter) {
      currentSub = { name: subMatch[1], items: [] };
      currentChapter.subtopics.push(currentSub);
      continue;
    }
    const itemMatch = line.match(itemRe);
    if (itemMatch && currentSub) {
      currentSub.items.push({ num: itemMatch[1], name: itemMatch[2] });
      continue;
    }
  }

  return { chapters, crossLinkPairs };
}

// ---- 骨架卡比對 ----

function normalizeForMatch(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/／/g, "/")
    .replace(/[\s\-_/]+/g, "");
}

function candidateTerms(rawName) {
  const trimmed = rawName.trim();
  const candidates = new Set([trimmed]);
  const spaceIdx = trimmed.search(/\s/);
  if (spaceIdx > 0) {
    candidates.add(trimmed.slice(0, spaceIdx).trim());
    candidates.add(trimmed.slice(spaceIdx + 1).trim());
  }
  candidates.add(trimmed.replace(/\s+/g, ""));
  // 常見格式「中文名稱 / English Full Name, ABBR」：切開 "/" 兩側，再切開逗號取縮寫尾段
  for (const slashPart of trimmed.split("/")) {
    const part = slashPart.trim();
    if (!part) continue;
    candidates.add(part);
    const commaIdx = part.lastIndexOf(",");
    if (commaIdx > 0) {
      candidates.add(part.slice(0, commaIdx).trim());
      candidates.add(part.slice(commaIdx + 1).trim());
    }
  }
  return Array.from(candidates).filter(Boolean);
}

function buildCardIndex(cards) {
  const byKey = new Map();
  const prefixKeys = []; // { key, card } — 只用英文縮寫/代稱做前綴比對，避免中文誤配
  for (const card of cards) {
    const keys = new Set();
    if (card.topic) keys.add(normalizeForMatch(card.topic));
    if (card.topicEn) keys.add(normalizeForMatch(card.topicEn));
    for (const k of card.keywordDisplay || []) keys.add(normalizeForMatch(k));
    for (const key of keys) {
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, card);
    }
    if (card.topicEn) prefixKeys.push({ key: normalizeForMatch(card.topicEn), card });
    for (const k of card.keywordDisplay || []) {
      prefixKeys.push({ key: normalizeForMatch(k), card });
    }
  }
  return { byKey, prefixKeys };
}

function matchCard(rawName, cardIndex) {
  for (const candidate of candidateTerms(rawName)) {
    const key = normalizeForMatch(candidate);
    if (key && cardIndex.byKey.has(key)) return cardIndex.byKey.get(key);
  }
  // 前綴比對備援：只針對英文/縮寫候選詞（例如 "FIFO" 對到 "FIFO Replacement"）
  for (const candidate of candidateTerms(rawName)) {
    const key = normalizeForMatch(candidate);
    if (key.length < 3 || !/^[a-z0-9]+$/.test(key)) continue;
    const hit = cardIndex.prefixKeys.find((p) => p.key.startsWith(key));
    if (hit) return hit.card;
  }
  return null;
}

// ---- 佈局（sunburst 式輻射，跟前端 mindmap-layout 邏輯一致；半徑與作業系統版本一致，
//      並且比舊版更大，讓節點之間留更多空間、比較看得清楚） ----

const RADIUS = { chapter: 220, sub: 460, leaf: 700 };

function layoutTree(chapters) {
  const nodes = [];
  const edges = [];

  const leafCountOfSub = (sub) => Math.max(1, sub.items.length);
  const leafCountOfChapter = (ch) =>
    ch.subtopics.reduce((sum, sub) => sum + leafCountOfSub(sub), 0) || 1;
  const totalWeight = chapters.reduce((sum, ch) => sum + leafCountOfChapter(ch), 0) || 1;

  let cursor = -Math.PI / 2;
  const twoPi = Math.PI * 2;

  for (const ch of chapters) {
    const chWeight = leafCountOfChapter(ch);
    const chSpan = (chWeight / totalWeight) * twoPi;
    const chStart = cursor;
    const chEnd = cursor + chSpan;
    cursor = chEnd;
    const chMid = (chStart + chEnd) / 2;
    const chNodeId = `chapter-${ch.code}`;
    nodes.push({
      id: chNodeId,
      kind: "text",
      label: `${ch.code}. ${ch.name}`,
      x: RADIUS.chapter * Math.cos(chMid),
      y: RADIUS.chapter * Math.sin(chMid),
    });
    edges.push({ id: `${ROOT_ID}->${chNodeId}`, fromId: ROOT_ID, toId: chNodeId });

    let subCursor = chStart;
    ch.subtopics.forEach((sub, subIdx) => {
      const subWeight = leafCountOfSub(sub);
      const subSpan = (subWeight / chWeight) * chSpan;
      const subStart = subCursor;
      const subEnd = subCursor + subSpan;
      subCursor = subEnd;
      const subMid = (subStart + subEnd) / 2;
      const subNodeId = `sub-${ch.code}-${subIdx}`;
      nodes.push({
        id: subNodeId,
        kind: "text",
        label: sub.name,
        x: RADIUS.sub * Math.cos(subMid),
        y: RADIUS.sub * Math.sin(subMid),
      });
      edges.push({ id: `${chNodeId}->${subNodeId}`, fromId: chNodeId, toId: subNodeId });

      const itemCount = Math.max(1, sub.items.length);
      const itemSpan = subSpan / itemCount;
      sub.items.forEach((item, itemIdx) => {
        const itemMid = subStart + itemIdx * itemSpan + itemSpan / 2;
        const leafNodeId = `leaf-${ch.code}-${subIdx}-${itemIdx}`;
        nodes.push({
          __leaf: true,
          __rawName: item.name,
          id: leafNodeId,
          x: RADIUS.leaf * Math.cos(itemMid),
          y: RADIUS.leaf * Math.sin(itemMid),
        });
        edges.push({ id: `${subNodeId}->${leafNodeId}`, fromId: subNodeId, toId: leafNodeId });
      });
    });
  }

  return { nodes, edges };
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env"));
  const apply = process.argv.includes("--apply");

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: requiredEnv("FIREBASE_PROJECT_ID"),
        clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
        privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
    });
  const db = getFirestore(app);

  const markdown = fs.readFileSync(OUTLINE_PATH, "utf8");
  const { chapters, crossLinkPairs } = parseOutline(markdown);
  const chapterCount = chapters.length;
  const subCount = chapters.reduce((s, c) => s + c.subtopics.length, 0);
  const leafCount = chapters.reduce(
    (s, c) => s + c.subtopics.reduce((s2, sub) => s2 + sub.items.length, 0),
    0
  );
  console.log(
    `解析大綱：${chapterCount} 章節、${subCount} 子主題、${leafCount} 個項目、${crossLinkPairs.length} 條跨章節連結`
  );

  const cardsSnap = await db.collection("skeletonCards").where("subject", "==", SUBJECT).get();
  const cards = cardsSnap.docs.map((doc) => ({
    id: doc.id,
    topic: doc.data().topic || "",
    topicEn: doc.data().topicEn || "",
    keywordDisplay: Array.isArray(doc.data().keywordDisplay) ? doc.data().keywordDisplay : [],
  }));
  console.log(`${SUBJECT} 現有骨架卡：${cards.length} 張`);
  const cardIndex = buildCardIndex(cards);

  const { nodes: rawNodes, edges: treeEdges } = layoutTree(chapters);

  const finalNodes = [];
  const matched = [];
  const unmatched = [];
  for (const n of rawNodes) {
    if (!n.__leaf) {
      finalNodes.push(n);
      continue;
    }
    const card = matchCard(n.__rawName, cardIndex);
    if (card) {
      matched.push({ name: n.__rawName, topic: card.topic, id: card.id });
      finalNodes.push({ id: n.id, kind: "card", cardId: card.id, x: n.x, y: n.y });
    } else {
      unmatched.push(n.__rawName);
      finalNodes.push({ id: n.id, kind: "text", label: n.__rawName, x: n.x, y: n.y });
    }
  }

  console.log(`葉節點比對到現有骨架卡：${matched.length} / ${leafCount}`);
  if (matched.length > 0) {
    console.log("--- 比對到的骨架卡（前 20 筆） ---");
    matched.slice(0, 20).forEach((m) => console.log(`  ${m.name}  ->  ${m.topic} (${m.id})`));
  }
  console.log(`未比對到、將存成文字節點：${unmatched.length} 個`);
  unmatched.forEach((name) => console.log(`  - ${name}`));

  const chapterNodeByCode = new Map(chapters.map((ch) => [ch.code, `chapter-${ch.code}`]));
  const crossEdges = crossLinkPairs
    .filter(([a, b]) => chapterNodeByCode.has(a) && chapterNodeByCode.has(b))
    .map(([a, b]) => ({
      id: `cross-${a}-${b}`,
      fromId: chapterNodeByCode.get(a),
      toId: chapterNodeByCode.get(b),
    }));

  const finalEdges = [...treeEdges, ...crossEdges];

  console.log(
    `畫布節點總數：${finalNodes.length}（${chapterCount} 章節 + ${subCount} 子主題 + ${leafCount} 項目），連線總數：${finalEdges.length}`
  );

  const mapRef = db.collection("mindMaps").doc(SUBJECT);
  const existingSnap = await mapRef.get();
  if (existingSnap.exists) {
    const existing = existingSnap.data();
    const existingNodeCount = Array.isArray(existing.nodes) ? existing.nodes.length : 0;
    console.log(`⚠ ${SUBJECT} 畫布目前已有 ${existingNodeCount} 個節點，套用後會整份覆蓋`);
  } else {
    console.log(`${SUBJECT} 畫布目前是空的`);
  }

  if (!apply) {
    console.log("\n(dry-run，未寫入。確認沒問題後加上 --apply 執行)");
    return;
  }

  await mapRef.set({
    subject: SUBJECT,
    nodes: finalNodes,
    edges: finalEdges,
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`已寫入 mindMaps/${SUBJECT}`);
}

main().catch((error) => {
  console.error("[import-network-mindmap] failed:", error);
  process.exitCode = 1;
});
