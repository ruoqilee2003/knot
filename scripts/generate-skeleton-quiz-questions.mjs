import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

loadDotEnv(path.resolve(process.cwd(), ".env"));

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const projectId = requiredEnv("FIREBASE_PROJECT_ID");
const clientEmail = requiredEnv("FIREBASE_CLIENT_EMAIL");
const privateKey = requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
const geminiApiKey = requiredEnv("GEMINI_API_KEY");

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(geminiApiKey);

const MAX_CARDS_PER_CALL = 3;
const MAX_POINTS_PER_CALL = 20;
const DELAY_MS_BETWEEN_CALLS = 4000;
const MAX_RETRIES_PER_BATCH = 3;
const RETRY_BACKOFF_MS = 30000;
const DEFAULT_SUBJECTS = ["資通網路", "資通安全", "資料庫應用", "作業系統"];
const DEFAULT_GEMINI_MODEL = "gemini-3-flash";
const FALLBACK_GEMINI_MODELS = [
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const SKELETON_QUIZ_SCHEMA_PROMPT = `你是台灣國家考試（申論題）的專業命題助教，專長在以下考科：資通網路、資訊安全實務、資料庫應用、系統程式。
你會拿到幾張「骨架卡」（考生用來記憶申論題重點的知識卡，結構是：定義 → 分類架構＋逐點展開 → 結論）。
請針對每張卡「指定要出題的逐點展開項目」（見卡片內容中以 [pointRef=x-y] 標示的項目）各出一題四選一選擇題，測驗考生是否記得該逐點項目的內容；可以參考同卡的定義／結論輔助鋪陳題幹，但正解與詳解要聚焦在該逐點項目本身。
請輸出 **純 JSON**（不要 markdown、不要註解），格式固定如下：
{
  "questions": [
    {
      "cardId": "對應輸入的骨架卡 id，原樣照抄",
      "pointRef": "對應輸入的 pointRef（例如 0-1），原樣照抄",
      "question": "題幹（須清楚明確，讓考生知道在問哪個逐點項目）",
      "options": ["選項A", "選項B", "選項C", "選項D"],
      "correctIndex": 0,
      "explanation": "詳解：說明正確選項為何正確、其餘選項為何錯誤或不夠精確"
    }
  ]
}
規則：
1) 每個指定的 pointRef 都必須產生恰好一題，cardId 與 pointRef 要與輸入完全對應，不可遺漏或新增。
2) 正確答案內容須忠實依據該逐點項目的重點與提示，不要偏離或加入卡片內容未提及的知識當作正解。
3) 錯誤選項（干擾項）須與正解主題相關、具有一定的混淆性（例如同卡其他逐點項目、相似概念、常見誤解），不要出現明顯無關或荒謬的選項。
4) correctIndex 為正確選項在 options 陣列中的索引（0~3），且務必打亂正確答案的位置，不要每題都放在同一個索引。
5) explanation 需完整說明為什麼正解對、其他三個選項分別錯在哪裡，讓考生讀完就能理解整個概念，繁體中文，語句通順。
6) 全部使用繁體中文，不要產生示範文或多餘說明文字。`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(targetModel, promptText) {
  const model = genAI.getGenerativeModel({
    model: targetModel,
    generationConfig: {
      temperature: 0.5,
      responseMimeType: "application/json",
    },
  });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: promptText }] }],
  });
  return result.response.text();
}

function buildPrompt(subject, cards) {
  const validPointRefs = new Set();

  const cardsText = cards
    .map((card, cardIdx) => {
      const blockLines = card.blocks
        .map((block) => {
          const pointLines = block.points
            .map((point) => {
              validPointRefs.add(`${card.id}::${point.ref}`);
              const hintText = point.hint ? `（提示：${point.hint}）` : "";
              return `  - [pointRef=${point.ref}] ${point.key ?? ""}${hintText}`;
            })
            .join("\n");
          const noteText = block.note ? `（${block.note}）` : "";
          return `- 分類「${block.label ?? ""}」${noteText}\n${pointLines}`;
        })
        .join("\n");
      const pointRefsForCard = card.blocks
        .flatMap((block) => block.points.map((p) => p.ref))
        .join("、");
      return `【骨架卡 ${cardIdx + 1}】id="${card.id}" 主題：${card.topic ?? ""}
定義：${card.definition ?? ""}
分類架構與逐點展開：
${blockLines}
結論：${card.conclusion ?? ""}
請針對此卡的以下 pointRef 出題：${pointRefsForCard}`;
    })
    .join("\n\n");

  const promptText = `${SKELETON_QUIZ_SCHEMA_PROMPT}

${subject ? `科目：${subject}\n\n` : ""}${cardsText}`;

  return { promptText, validPointRefs };
}

async function generateForBatch(modelName, subject, cards) {
  const { promptText, validPointRefs } = buildPrompt(subject, cards);

  const candidateModels = Array.from(new Set([modelName, ...FALLBACK_GEMINI_MODELS]));
  let text = "";
  let lastError = null;
  for (const candidate of candidateModels) {
    try {
      text = await callModel(candidate, promptText);
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const shouldTryNext =
        message.includes("404") ||
        message.toLowerCase().includes("not found") ||
        message.toLowerCase().includes("not supported") ||
        message.toLowerCase().includes("no longer available");
      if (!shouldTryNext) throw error;
    }
  }
  if (!text) {
    throw lastError ?? new Error(`No available Gemini models. Tried: ${candidateModels.join(", ")}`);
  }

  const parsed = JSON.parse(text);
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map((item) => {
      if (typeof item !== "object" || item == null) return null;
      const cardId = typeof item.cardId === "string" ? item.cardId.trim() : "";
      const pointRef = typeof item.pointRef === "string" ? item.pointRef.trim() : "";
      const question = typeof item.question === "string" ? item.question.trim() : "";
      const options = Array.isArray(item.options)
        ? item.options.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean)
        : [];
      const correctIndex = typeof item.correctIndex === "number" ? item.correctIndex : -1;
      const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
      if (
        !validPointRefs.has(`${cardId}::${pointRef}`) ||
        !question ||
        options.length !== 4 ||
        correctIndex < 0 ||
        correctIndex > 3 ||
        !explanation
      ) {
        return null;
      }
      return { cardId, pointRef, question, options, correctIndex, explanation };
    })
    .filter((item) => item !== null);

  return questions;
}

function isQuotaError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("429") ||
    message.toLowerCase().includes("quota exceeded") ||
    message.toLowerCase().includes("too many requests") ||
    message.toLowerCase().includes("resource exhausted") ||
    message.toLowerCase().includes("overloaded") ||
    message.toLowerCase().includes("unavailable")
  );
}

async function generateForBatchWithRetry(modelName, subject, cards) {
  let attempt = 0;
  for (;;) {
    try {
      return await generateForBatch(modelName, subject, cards);
    } catch (error) {
      attempt += 1;
      if (attempt >= MAX_RETRIES_PER_BATCH || !isQuotaError(error)) {
        throw error;
      }
      const wait = RETRY_BACKOFF_MS * attempt;
      console.warn(
        `  -> quota/overload error (attempt ${attempt}/${MAX_RETRIES_PER_BATCH}), retrying in ${wait / 1000}s: ${
          error instanceof Error ? error.message : error
        }`
      );
      await sleep(wait);
    }
  }
}

/** 把 skeletonCards 攤成 { id, subject, topic, definition, conclusion, keywords, blocks: [{label, note, points:[{ref,key,hint}]}] }，只保留還缺選擇題的逐點 */
function buildPendingCards(rawCards, existingRefsByCardId) {
  return rawCards
    .map((raw) => {
      const existing = existingRefsByCardId.get(raw.id) ?? new Set();
      const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
        .map((block, blockIdx) => {
          const points = (Array.isArray(block.points) ? block.points : [])
            .map((point, pointIdx) => ({
              ref: `${blockIdx}-${pointIdx}`,
              key: typeof point.key === "string" ? point.key : "",
              hint: typeof point.hint === "string" ? point.hint : "",
            }))
            .filter((p) => (p.key || p.hint) && !existing.has(p.ref));
          return {
            label: typeof block.label === "string" ? block.label : "",
            note: typeof block.note === "string" ? block.note : "",
            points,
          };
        })
        .filter((block) => block.points.length > 0);
      return {
        id: raw.id,
        subject: raw.subject ?? "",
        topic: raw.topic ?? "",
        definition: raw.definition ?? "",
        conclusion: raw.conclusion ?? "",
        keywords: Array.isArray(raw.keywordDisplay) ? raw.keywordDisplay : [],
        blocks,
      };
    })
    .filter((card) => card.blocks.some((b) => b.points.length > 0));
}

/** 把待處理卡片切成每批最多 MAX_CARDS_PER_CALL 張、且逐點總數不超過 MAX_POINTS_PER_CALL 的批次 */
function chunkCards(pendingCards) {
  const batches = [];
  let current = [];
  let currentPoints = 0;
  for (const card of pendingCards) {
    const cardPoints = card.blocks.reduce((sum, b) => sum + b.points.length, 0);
    if (
      current.length > 0 &&
      (current.length >= MAX_CARDS_PER_CALL || currentPoints + cardPoints > MAX_POINTS_PER_CALL)
    ) {
      batches.push(current);
      current = [];
      currentPoints = 0;
    }
    current.push(card);
    currentPoints += cardPoints;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const subjectArg = args.find((a) => a.startsWith("--subject="));
  const onlySubject = subjectArg ? subjectArg.split("=")[1] : null;
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitCards = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : null;
  const allowedSubjects = onlySubject ? [onlySubject] : DEFAULT_SUBJECTS;
  const modelName = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  console.log(`Subjects: ${allowedSubjects.join(", ")}${dryRun ? " (dry-run)" : ""}`);

  const allowedSet = new Set(allowedSubjects);
  const skeletonSnap = await db.collection("skeletonCards").get();
  const rawCards = skeletonSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((c) => allowedSet.has(c.subject));

  const existingSnap = await db
    .collection("quizQuestions")
    .where("sourceType", "==", "skeleton")
    .select("cardId", "pointRef")
    .get();
  const existingRefsByCardId = new Map();
  for (const doc of existingSnap.docs) {
    const data = doc.data();
    if (!data.cardId || !data.pointRef) continue;
    if (!existingRefsByCardId.has(data.cardId)) {
      existingRefsByCardId.set(data.cardId, new Set());
    }
    existingRefsByCardId.get(data.cardId).add(data.pointRef);
  }

  let pendingCards = buildPendingCards(rawCards, existingRefsByCardId);
  if (limitCards && limitCards > 0) {
    pendingCards = pendingCards.slice(0, limitCards);
  }

  const totalPendingPoints = pendingCards.reduce(
    (sum, c) => sum + c.blocks.reduce((s, b) => s + b.points.length, 0),
    0
  );
  console.log(
    `Skeleton cards in scope: ${rawCards.length}, cards with pending points: ${pendingCards.length}, pending points: ${totalPendingPoints}`
  );

  if (pendingCards.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const batches = chunkCards(pendingCards);

  let totalCreated = 0;
  let totalFailedBatches = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const subjectForBatch = batch[0]?.subject || onlySubject || "";
    const batchPoints = batch.reduce((sum, c) => sum + c.blocks.reduce((s, bl) => s + bl.points.length, 0), 0);
    console.log(
      `[${b + 1}/${batches.length}] Generating ${batchPoints} question(s) across ${batch.length} card(s) for subject="${subjectForBatch}"...`
    );
    try {
      const questions = await generateForBatchWithRetry(modelName, subjectForBatch, batch);
      if (questions.length === 0) {
        console.warn("  -> model returned no valid questions for this batch, skipping.");
        totalFailedBatches += 1;
        continue;
      }

      const cardMap = new Map(batch.map((c) => [c.id, c]));
      const toSave = questions.map((q) => {
        const card = cardMap.get(q.cardId);
        return {
          cardId: q.cardId,
          pointRef: q.pointRef,
          sourceType: "skeleton",
          questionId: null,
          subject: card?.subject ?? subjectForBatch,
          keywords: card?.keywords ?? [],
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        };
      });

      if (dryRun) {
        console.log(`  -> [dry-run] would save ${toSave.length} question(s)`);
      } else {
        const writeBatch = db.batch();
        for (const q of toSave) {
          const ref = db.collection("quizQuestions").doc();
          writeBatch.set(ref, {
            ...q,
            correctCount: 0,
            wrongCount: 0,
            lastResult: null,
            lastAnsweredAt: null,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        await writeBatch.commit();
        console.log(`  -> saved ${toSave.length} question(s)`);
      }

      totalCreated += toSave.length;
    } catch (error) {
      console.error(`  -> batch failed permanently: ${error instanceof Error ? error.message : error}`);
      totalFailedBatches += 1;
    }

    if (b < batches.length - 1) {
      await sleep(DELAY_MS_BETWEEN_CALLS);
    }
  }

  console.log("\nDone.");
  console.log(`Created: ${totalCreated}, failed batches: ${totalFailedBatches}`);
  if (totalFailedBatches > 0) {
    console.log("Re-run this script to retry the points that are still missing quiz questions.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
