import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

/**
 * 從環境變數讀取 Firebase Web App 設定。
 * NEXT_PUBLIC_FIREBASE_CONFIG 需為 **單行 JSON 字串**，例如：
 * {"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}
 */
function parseFirebaseConfig() {
  const raw = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "缺少 NEXT_PUBLIC_FIREBASE_CONFIG。請在 .env.local 設定完整的 Firebase Web 設定 JSON。"
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_FIREBASE_CONFIG 必須是有效的 JSON 字串（請確認沒有換行與未轉義的引號）。"
    );
  }
}

let cachedApp;

export function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }
  if (!cachedApp) {
    cachedApp = initializeApp(parseFirebaseConfig());
  }
  return cachedApp;
}

/** 延遲建立，避免在未設定環境變數時於 import 階段就拋錯（利於 CI / build） */
export function getDb() {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseStorage() {
  return getStorage(getFirebaseApp());
}
