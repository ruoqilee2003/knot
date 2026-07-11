// 一次性修復：根據 attempts 的實際內容，把 questions 上鏡射的
// latestAttemptStatus 補回正確值（有 analysis 卻被降回 draft/completed 的題目）。
// 用法：node scripts/repair-attempt-status.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env"));
  const dryRun = process.argv.includes("--dry-run");

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

  const attemptsSnap = await db.collection("attempts").get();
  let scanned = 0;
  let repairedAttempts = 0;
  let repairedQuestions = 0;
  const batch = db.batch();

  for (const doc of attemptsSnap.docs) {
    scanned += 1;
    const data = doc.data() || {};
    const status = typeof data.status === "string" ? data.status : "draft";
    const hasAnalysis = data.analysis != null;
    if (!hasAnalysis) continue;

    // 有批改結果的題目，狀態至少應為 analyzed
    let correctStatus = status;
    if (status === "draft" || status === "completed" || status === "analyze_failed") {
      correctStatus = data.flashcardsGeneratedAt != null ? "flashcards_ready" : "analyzed";
    }

    const questionRef = db.collection("questions").doc(doc.id);
    const questionSnap = await questionRef.get();
    const mirrored = questionSnap.exists
      ? questionSnap.data()?.latestAttemptStatus
      : undefined;

    if (correctStatus !== status) {
      console.log(`attempt ${doc.id}: status ${status} -> ${correctStatus}`);
      if (!dryRun) batch.set(doc.ref, { status: correctStatus }, { merge: true });
      repairedAttempts += 1;
    }
    if (questionSnap.exists && mirrored !== correctStatus) {
      console.log(
        `question ${doc.id}: latestAttemptStatus ${mirrored ?? "(none)"} -> ${correctStatus}`
      );
      if (!dryRun) {
        batch.set(
          questionRef,
          { latestAttemptStatus: correctStatus },
          { merge: true }
        );
      }
      repairedQuestions += 1;
    }
  }

  if (!dryRun && (repairedAttempts > 0 || repairedQuestions > 0)) {
    await batch.commit();
  }
  console.log(
    JSON.stringify({ scanned, repairedAttempts, repairedQuestions, dryRun }, null, 2)
  );
}

main().catch((error) => {
  console.error("[repair-attempt-status] failed:", error);
  process.exitCode = 1;
});
