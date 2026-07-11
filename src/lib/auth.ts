export const AUTH_COOKIE_NAME = "knot_auth";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getAuthSecret(): string {
  return process.env.AUTH_SECRET ?? "";
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(signature);
}

function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i]! ^ bufB[i]!;
  }
  return diff === 0;
}

/** 簽發格式為 `<到期時間>.<HMAC簽章>` 的 session token，無 AUTH_SECRET 時拋錯。 */
export async function createSessionToken(): Promise<string> {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("伺服器未設定 AUTH_SECRET，請先執行 scripts/hash-password.mjs 並更新 .env");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const signature = await hmacSign(secret, `knot-session:${expiresAt}`);
  return `${expiresAt}.${signature}`;
}

export async function isSessionTokenValid(token?: string | null): Promise<boolean> {
  const secret = getAuthSecret();
  if (!secret || !token) return false;
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return false;
  const expiresAtRaw = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  const expected = await hmacSign(secret, `knot-session:${expiresAtRaw}`);
  return timingSafeEqualString(signature, expected);
}
