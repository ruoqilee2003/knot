import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/auth";
import { validateCredentials } from "@/lib/auth-credentials";

type LoginBody = {
  username?: string;
  password?: string;
};

export const runtime = "nodejs";

// 簡易登入失敗鎖定：連續失敗 5 次後鎖 10 分鐘（重啟後歸零，單人使用足夠）
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;
let failedAttempts = 0;
let lockedUntil = 0;

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (Date.now() < lockedUntil) {
    const waitMinutes = Math.ceil((lockedUntil - Date.now()) / 60000);
    return NextResponse.json(
      { error: `登入失敗次數過多，請 ${waitMinutes} 分鐘後再試` },
      { status: 429 }
    );
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password =
    typeof body.password === "string" ? body.password.trim() : "";

  if (!validateCredentials(username, password)) {
    failedAttempts += 1;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = Date.now() + LOCKOUT_MS;
      failedAttempts = 0;
    }
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }

  failedAttempts = 0;
  lockedUntil = 0;

  let token: string;
  try {
    token = await createSessionToken();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "無法簽發登入憑證";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
