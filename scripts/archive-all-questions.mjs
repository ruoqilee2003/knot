// 一次性封存全部題目（資料保留，僅從介面隱藏）。
// 用法：node scripts/archive-all-questions.mjs [--dry-run] [--restore]
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

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env"));
  const dryRun = process.argv.includes("--dry-run");
  const restore = process.argv.includes("--restore");

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

  const snap = await db.collection("questions").select("archived").get();
  const targets = snap.docs.filter((doc) => {
    const archived = doc.data().archived === true;
    return restore ? archived : !archived;
  });

  console.log(
    restore
      ? `將還原 ${targets.length} 題封存題目${dryRun ? "（dry-run）" : ""}`
      : `將封存 ${targets.length} 題${dryRun ? "（dry-run）" : ""}`
  );

  if (dryRun || targets.length === 0) return;

  let batch = db.batch();
  let opCount = 0;

  for (const doc of targets) {
    if (restore) {
      batch.set(
        doc.ref,
        { archived: false, archivedAt: FieldValue.delete() },
        { merge: true }
      );
    } else {
      batch.set(
        doc.ref,
        { archived: true, archivedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    opCount += 1;
    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  console.log("完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
