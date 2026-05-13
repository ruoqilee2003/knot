const DEFAULT_AUTH_USERNAME = "iwillgetit2026";
const DEFAULT_AUTH_PASSWORD = "Lee_031337";
const DEFAULT_AUTH_SESSION_TOKEN = "knot-single-user-session";

export const AUTH_COOKIE_NAME = "knot_auth";

function getExpectedUsername() {
  return process.env.AUTH_USERNAME ?? DEFAULT_AUTH_USERNAME;
}

function getExpectedPassword() {
  return process.env.AUTH_PASSWORD ?? DEFAULT_AUTH_PASSWORD;
}

export function getSessionToken() {
  return process.env.AUTH_SESSION_TOKEN ?? DEFAULT_AUTH_SESSION_TOKEN;
}

export function validateCredentials(username: string, password: string) {
  return username === getExpectedUsername() && password === getExpectedPassword();
}

export function isSessionTokenValid(token?: string | null) {
  return token === getSessionToken();
}
