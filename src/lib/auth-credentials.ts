// 僅供 Node.js runtime 的 API route 使用（proxy 請改用 lib/auth.ts 的 token 驗證）。
import { scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 密碼雜湊格式：s2:<salt hex>:<scrypt hash hex>，由 scripts/hash-password.mjs 產生。
 * 分隔符不能用 $：Next.js 載入 .env 時會把 $xxx 當成變數引用展開掉。
 */
function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "s2") return false;
  const [, salt, expectedHex] = parts;
  try {
    const expected = Buffer.from(expectedHex!, "hex");
    const actual = scryptSync(password, salt!, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function validateCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.AUTH_USERNAME ?? "";
  const passwordHash = process.env.AUTH_PASSWORD_HASH ?? "";
  if (!expectedUsername || !passwordHash) return false;

  const usernameBuf = Buffer.from(username);
  const expectedBuf = Buffer.from(expectedUsername);
  const usernameOk =
    usernameBuf.length === expectedBuf.length &&
    timingSafeEqual(usernameBuf, expectedBuf);

  return usernameOk && verifyPassword(password, passwordHash);
}
