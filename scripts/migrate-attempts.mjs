import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

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
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeKeyword(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "");
}

function sanitizeKeyword(input) {
  return String(input || "")
    .trim()
    .replace(/^#+/, "");
}

function dedupeKeywordsCaseInsensitive(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const display = sanitizeKeyword(item);
    if (!display) continue;
    const normalized = normalizeKeyword(display);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(display);
  }
  return out;
}

function resolveTimestamp(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value.toDate === "function") return value;
    if (value instanceof Date) return value;
  }
  return FieldValue.serverTimestamp();
}

async function main() {
  const cwd = process.cwd();
  loadDotEnv(path.join(cwd, ".env"));

  const dryRun = process.argv.includes("--dry-run");
  const batchSizeArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
  const batchSize = batchSizeArg ? Number(batchSizeArg.split("=")[1]) : 120;
  const safeBatchSize =
    Number.isFinite(batchSize) && batchSize > 0 ? Math.min(Math.floor(batchSize), 300) : 120;

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

  let lastDoc = null;
  let scanned = 0;
  let migrated = 0;
  let cleaned = 0;
  let createdKeywords = 0;
  let batch = db.batch();
  let pendingOps = 0;

  async function flushBatch() {
    if (pendingOps === 0 || dryRun) return;
    await batch.commit();
    batch = db.batch();
    pendingOps = 0;
  }

  async function ensureCapacity(additionalOps) {
    if (pendingOps + additionalOps <= 400) return;
    await flushBatch();
  }

  console.log(
    `[migrate-attempts] start dryRun=${dryRun} batchSize=${safeBatchSize}`
  );

  while (true) {
    let query = db.collection("questions").orderBy("__name__").limit(safeBatchSize);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      scanned += 1;
      lastDoc = doc;

      const data = doc.data() || {};
      const legacyDraft = data.latestDraft || null;
      const legacyAnalysis = data.latestAnalysis || null;
      const hasLegacyFields =
        legacyDraft != null || legacyAnalysis != null || data.latestAnalyzedAt != null;
      if (!hasLegacyFields) continue;

      const status =
        typeof legacyDraft?.status === "string"
          ? legacyDraft.status
          : legacyAnalysis
            ? "analyzed"
            : "draft";
      const keywordDisplay = dedupeKeywordsCaseInsensitive([
        ...(Array.isArray(legacyDraft?.keywords) ? legacyDraft.keywords : []),
        ...(Array.isArray(legacyDraft?.keywordDisplay)
          ? legacyDraft.keywordDisplay
          : []),
        ...(Array.isArray(data.latestAttemptKeywordDisplay)
          ? data.latestAttemptKeywordDisplay
          : []),
        ...(Array.isArray(data.latestAttemptKeywords) ? data.latestAttemptKeywords : []),
      ]);
      const keywords = keywordDisplay.map((item) => normalizeKeyword(item)).filter(Boolean);

      const attemptPayload = {
        questionId: doc.id,
        subject: typeof data.subject === "string" ? data.subject : "",
        text: typeof legacyDraft?.text === "string" ? legacyDraft.text : "",
        imageUrl:
          typeof legacyDraft?.imageUrl === "string" && legacyDraft.imageUrl.trim()
            ? legacyDraft.imageUrl
            : null,
        status,
        errorMessage:
          typeof legacyDraft?.errorMessage === "string" && legacyDraft.errorMessage.trim()
            ? legacyDraft.errorMessage
            : null,
        analysis: legacyAnalysis || null,
        keywords,
        keywordDisplay,
        createdAt: resolveTimestamp(
          legacyDraft?.updatedAt,
          data.latestAnalyzedAt,
          data.createdAt
        ),
        updatedAt: resolveTimestamp(
          legacyDraft?.updatedAt,
          data.latestAnalyzedAt,
          data.createdAt
        ),
      };

      const opsNeeded = 2 + keywordDisplay.length;
      await ensureCapacity(opsNeeded);

      const attemptRef = db.collection("attempts").doc(doc.id);
      const questionRef = db.collection("questions").doc(doc.id);
      if (!dryRun) {
        batch.set(attemptRef, attemptPayload, { merge: true });
        batch.set(
          questionRef,
          {
            latestDraft: FieldValue.delete(),
            latestAnalysis: FieldValue.delete(),
            latestAnalyzedAt: FieldValue.delete(),
            latestAttemptKeywordDisplay: FieldValue.delete(),
          },
          { merge: true }
        );
      }
      pendingOps += 2;
      migrated += 1;
      cleaned += 1;

      for (const displayKeyword of keywordDisplay) {
        const keyword = normalizeKeyword(displayKeyword);
        if (!keyword) continue;
        if (!dryRun) {
          batch.set(
            db.collection("keywords").doc(keyword),
            {
              keyword,
              displayKeyword,
              usageCount: FieldValue.increment(1),
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        pendingOps += 1;
        createdKeywords += 1;
      }
    }
  }

  await flushBatch();
  console.log("[migrate-attempts] done");
  console.log(
    JSON.stringify(
      { scanned, migrated, cleaned, keywordUpserts: createdKeywords, dryRun },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[migrate-attempts] failed:", error);
  process.exitCode = 1;
});
