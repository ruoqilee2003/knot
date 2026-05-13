"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "登入失敗");
      }

      const target = nextPath && nextPath.startsWith("/") ? nextPath : "/";
      router.replace(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f1eb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-[#fffdf8] p-6 shadow-sm">
        <p className="text-center font-serif text-4xl font-semibold tracking-tight text-stone-900">
          Knot.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm text-stone-700">
            帳號
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none ring-stone-400 focus:ring"
            />
          </label>

          <label className="block text-sm text-stone-700">
            密碼
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none ring-stone-400 focus:ring"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "登入中..." : "登入"}
          </button>
        </form>
      </div>
    </main>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f1eb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-[#fffdf8] p-6 text-center text-sm text-stone-600 shadow-sm">
        載入登入頁中...
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
