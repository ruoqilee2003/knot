"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Card = {
  id: string;
  front: string;
  back: string;
  subject: string;
  questionId: string | null;
};

function shuffle<T>(input: T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export default function FlashcardReviewPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [deck, setDeck] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/flashcards", { method: "GET" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "讀取字卡失敗");
        }
        const data = (await response.json()) as Array<Record<string, unknown>>;
        if (cancelled) return;
        const list: Card[] = data
          .map((x) => ({
            id: String(x.id ?? ""),
            front: String(x.front ?? ""),
            back: String(x.back ?? ""),
            subject: String(x.subject ?? ""),
            questionId: x.questionId ? String(x.questionId) : null,
          }))
          .filter((card) => card.front && card.back);
        setCards(list);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "讀取字卡失敗");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subjects = useMemo(() => {
    return Array.from(
      new Set(cards.map((card) => card.subject.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [cards]);

  const reshuffle = useCallback(
    (source: Card[], subject: string) => {
      const filtered =
        subject === "all"
          ? source
          : source.filter((card) => card.subject === subject);
      setDeck(shuffle(filtered));
      setIndex(0);
      setFlipped(false);
    },
    []
  );

  useEffect(() => {
    reshuffle(cards, subjectFilter);
  }, [cards, subjectFilter, reshuffle]);

  const current = deck[index] ?? null;

  const goNext = useCallback(() => {
    setFlipped(false);
    setIndex((prev) => (deck.length === 0 ? 0 : (prev + 1) % deck.length));
  }, [deck.length]);

  const goPrev = useCallback(() => {
    setFlipped(false);
    setIndex((prev) =>
      deck.length === 0 ? 0 : (prev - 1 + deck.length) % deck.length
    );
  }, [deck.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  return (
    <div className="flex min-h-full w-full flex-col px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">字卡複習</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
            隨機翻卡
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            點擊卡片翻面。鍵盤操作：空白鍵翻面，← → 切換上一張／下一張。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-stone-700">
            考科
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="ml-2 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
            >
              <option value="all">全部</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => reshuffle(cards, subjectFilter)}
            disabled={deck.length === 0}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            重新洗牌
          </button>
        </div>
      </header>

      {error && (
        <div
          className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="mt-16 flex flex-1 items-center justify-center text-sm text-stone-500">
          讀取字卡中…
        </div>
      )}

      {!loading && !error && deck.length === 0 && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center gap-3 text-sm text-stone-500">
          <p>目前篩選條件下沒有字卡。</p>
          <Link href="/flashcards" className="text-stone-800 underline">
            前往關鍵字卡總覽
          </Link>
        </div>
      )}

      {!loading && !error && current && (
        <div className="mt-10 flex flex-1 flex-col items-center">
          <p className="text-sm text-stone-500">
            {index + 1} / {deck.length}
            {current.subject && (
              <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                {current.subject}
              </span>
            )}
          </p>

          <button
            type="button"
            onClick={() => setFlipped((prev) => !prev)}
            className="mt-6 w-full max-w-2xl cursor-pointer"
            style={{ perspective: "1200px" }}
            aria-label={flipped ? "翻回正面" : "翻到背面"}
          >
            <div
              className="relative min-h-[320px] w-full transition-transform duration-500 [transform-style:preserve-3d]"
              style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 shadow-md [backface-visibility:hidden]">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Question
                </p>
                <p className="mt-4 whitespace-pre-wrap text-center text-lg font-medium leading-relaxed text-stone-900">
                  {current.front}
                </p>
                <p className="mt-6 text-xs text-stone-400">點擊翻面查看答案</p>
              </div>
              <div
                className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-3xl border border-amber-200 bg-amber-50/70 p-8 shadow-md [backface-visibility:hidden]"
                style={{ transform: "rotateY(180deg)" }}
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
                  Answer
                </p>
                <p className="mt-4 whitespace-pre-wrap text-center text-base leading-relaxed text-stone-800">
                  {current.back}
                </p>
              </div>
            </div>
          </button>

          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={goPrev}
              className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              ← 上一張
            </button>
            <button
              type="button"
              onClick={() => setFlipped((prev) => !prev)}
              className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
            >
              翻面
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              下一張 →
            </button>
          </div>

          {current.questionId && (
            <Link
              href={`/practice/${current.questionId}`}
              className="mt-6 text-xs text-stone-500 underline hover:text-stone-800"
            >
              檢視原題
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
