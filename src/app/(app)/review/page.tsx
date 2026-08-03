"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PRESET_SUBJECTS, subjectsMatch } from "@/lib/subjects";
import { shuffle } from "@/lib/shuffle";

type Card = {
  id: string;
  front: string;
  back: string;
  subject: string;
  questionId: string | null;
  keywords: string[];
  rememberCount: number;
  forgetCount: number;
  important: boolean;
};

type Mode = "all" | "forgotten";
type Phase = "setup" | "reviewing" | "finished";

function isWeakCard(card: Card): boolean {
  return card.forgetCount > 0 && card.forgetCount >= card.rememberCount;
}

export default function FlashcardReviewPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("setup");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set()
  );
  const [mode, setMode] = useState<Mode>("all");
  const [importantOnly, setImportantOnly] = useState(false);

  const [deck, setDeck] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionStats, setSessionStats] = useState({ remember: 0, forget: 0 });

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
            keywords: Array.isArray(x.keywordDisplay)
              ? (x.keywordDisplay as unknown[]).filter(
                  (item): item is string => typeof item === "string"
                )
              : [],
            rememberCount:
              typeof x.rememberCount === "number" ? x.rememberCount : 0,
            forgetCount:
              typeof x.forgetCount === "number" ? x.forgetCount : 0,
            important: x.important === true,
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

  const subjects = PRESET_SUBJECTS;

  /** 目前科目底下可勾選的關鍵字（依出現次數排序） */
  const keywordOptions = useMemo(() => {
    const pool =
      subjectFilter === "all"
        ? cards
        : cards.filter((card) => subjectsMatch(card.subject, subjectFilter));
    const counts = new Map<string, number>();
    for (const card of pool) {
      for (const keyword of card.keywords) {
        counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
      .map(([keyword]) => keyword);
  }, [cards, subjectFilter]);

  // 換科目時清掉已不存在的勾選
  useEffect(() => {
    setSelectedKeywords((prev) => {
      const valid = new Set(keywordOptions);
      const next = new Set(
        Array.from(prev).filter((keyword) => valid.has(keyword))
      );
      return next.size === prev.size ? prev : next;
    });
  }, [keywordOptions]);

  const matchedCards = useMemo(() => {
    let pool =
      subjectFilter === "all"
        ? cards
        : cards.filter((card) => subjectsMatch(card.subject, subjectFilter));
    if (selectedKeywords.size > 0) {
      pool = pool.filter((card) =>
        card.keywords.some((keyword) => selectedKeywords.has(keyword))
      );
    }
    if (mode === "forgotten") {
      pool = pool.filter(isWeakCard);
    }
    if (importantOnly) {
      pool = pool.filter((card) => card.important);
    }
    return pool;
  }, [cards, subjectFilter, selectedKeywords, mode, importantOnly]);

  const toggleKeyword = useCallback((keyword: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });
  }, []);

  const startReview = useCallback(() => {
    if (matchedCards.length === 0) return;
    setDeck(shuffle(matchedCards));
    setIndex(0);
    setFlipped(false);
    setSessionStats({ remember: 0, forget: 0 });
    setPhase("reviewing");
  }, [matchedCards]);

  const backToSetup = useCallback(() => {
    setPhase("setup");
    setDeck([]);
    setIndex(0);
    setFlipped(false);
  }, []);

  const current = phase === "reviewing" ? (deck[index] ?? null) : null;

  const advance = useCallback(() => {
    setFlipped(false);
    if (index + 1 >= deck.length) {
      setPhase("finished");
    } else {
      setIndex(index + 1);
    }
  }, [index, deck.length]);

  const goPrev = useCallback(() => {
    setFlipped(false);
    setIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const markReview = useCallback(
    (kind: "remember" | "forget") => {
      const card = deck[index];
      if (!card) return;
      // 樂觀更新本地計數，API 失敗不影響複習流程
      void fetch(`/api/flashcards/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review: kind }),
      }).catch(() => {});
      const patch = (item: Card) =>
        item.id === card.id
          ? {
              ...item,
              rememberCount:
                item.rememberCount + (kind === "remember" ? 1 : 0),
              forgetCount: item.forgetCount + (kind === "forget" ? 1 : 0),
            }
          : item;
      setCards((prev) => prev.map(patch));
      setDeck((prev) => prev.map(patch));
      setSessionStats((prev) => ({
        remember: prev.remember + (kind === "remember" ? 1 : 0),
        forget: prev.forget + (kind === "forget" ? 1 : 0),
      }));
      advance();
    },
    [deck, index, advance]
  );

  useEffect(() => {
    if (phase !== "reviewing") return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((prev) => !prev);
      } else if (e.key === "1") {
        e.preventDefault();
        markReview("remember");
      } else if (e.key === "2") {
        e.preventDefault();
        markReview("forget");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, advance, goPrev, markReview]);

  const weakCount = useMemo(
    () => cards.filter(isWeakCard).length,
    [cards]
  );

  const importantCount = useMemo(
    () => cards.filter((card) => card.important).length,
    [cards]
  );

  return (
    <div className="flex min-h-full w-full flex-col px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">字卡複習</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
            {phase === "setup" ? "複習設定" : "隨機翻卡"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            {phase === "setup"
              ? "選擇範圍後開始複習。回答「記得／不記得」會累計到每張卡片上，之後可以只加強不熟的卡。"
              : "空白鍵翻面，1 記得、2 不記得，← → 切換卡片。"}
          </p>
        </div>
        {phase !== "setup" && (
          <button
            type="button"
            onClick={backToSetup}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            ← 回到設定
          </button>
        )}
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

      {!loading && !error && cards.length === 0 && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center gap-3 text-sm text-stone-500">
          <p>目前還沒有任何字卡。</p>
          <Link href="/flashcards" className="text-stone-800 underline">
            前往關鍵字卡總覽
          </Link>
        </div>
      )}

      {/* ── 設定畫面 ── */}
      {!loading && !error && cards.length > 0 && phase === "setup" && (
        <div className="mt-8 w-full max-w-2xl self-center rounded-3xl border border-stone-200 bg-[#fffdf8] p-6 shadow-sm md:p-8">
          <div>
            <p className="text-sm font-semibold text-stone-800">考科</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSubjectFilter("all")}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  subjectFilter === "all"
                    ? "bg-stone-900 text-white"
                    : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                全部
              </button>
              {subjects.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => setSubjectFilter(subject)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    subjectFilter === subject
                      ? "bg-stone-900 text-white"
                      : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800">
                關鍵字
                <span className="ml-2 text-xs font-normal text-stone-500">
                  不勾選＝不限
                </span>
              </p>
              {selectedKeywords.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedKeywords(new Set())}
                  className="text-xs text-stone-500 underline hover:text-stone-800"
                >
                  清除勾選
                </button>
              )}
            </div>
            {keywordOptions.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                此範圍的字卡沒有關聯關鍵字。
              </p>
            ) : (
              <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                {keywordOptions.map((keyword) => {
                  const active = selectedKeywords.has(keyword);
                  return (
                    <button
                      key={keyword}
                      type="button"
                      onClick={() => toggleKeyword(keyword)}
                      className={`rounded-full px-3 py-1.5 text-sm transition ${
                        active
                          ? "bg-amber-500 font-medium text-white"
                          : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                      aria-pressed={active}
                    >
                      #{keyword}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold text-stone-800">複習範圍</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  mode === "all"
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                <p className="text-sm font-semibold">全部字卡</p>
                <p
                  className={`mt-1 text-xs ${
                    mode === "all" ? "text-stone-300" : "text-stone-500"
                  }`}
                >
                  隨機洗牌，完整過一輪
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode("forgotten")}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  mode === "forgotten"
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                <p className="text-sm font-semibold">加強不記得</p>
                <p
                  className={`mt-1 text-xs ${
                    mode === "forgotten" ? "text-stone-300" : "text-stone-500"
                  }`}
                >
                  只出「不記得次數 ≥ 記得次數」的卡（全部共 {weakCount} 張）
                </p>
              </button>
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
              <input
                type="checkbox"
                checked={importantOnly}
                onChange={(e) => setImportantOnly(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-orange-600"
              />
              <span>
                <span className="text-sm font-medium text-stone-800">
                  僅重要字卡
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  只複習考古題產生的字卡（全部共 {importantCount} 張），可與上方範圍併用
                </span>
              </span>
            </label>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-stone-200 pt-6">
            <p className="text-sm text-stone-600">
              符合條件：
              <span className="font-semibold text-stone-900">
                {matchedCards.length}
              </span>{" "}
              張
            </p>
            <button
              type="button"
              onClick={startReview}
              disabled={matchedCards.length === 0}
              className="rounded-xl bg-stone-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              開始複習 →
            </button>
          </div>
        </div>
      )}

      {/* ── 複習中 ── */}
      {!error && current && (
        <div className="mt-10 flex flex-1 flex-col items-center">
          <p className="text-sm text-stone-500">
            {index + 1} / {deck.length}
            {current.subject && (
              <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                {current.subject}
              </span>
            )}
            {current.important && (
              <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                重要
              </span>
            )}
            <span className="ml-3 text-xs text-emerald-600">
              記得 {current.rememberCount}
            </span>
            <span className="ml-2 text-xs text-rose-600">
              不記得 {current.forgetCount}
            </span>
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
              onClick={() => markReview("remember")}
              className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            >
              ✓ 記得
            </button>
            <button
              type="button"
              onClick={() => markReview("forget")}
              className="rounded-xl bg-rose-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500"
            >
              ✗ 不記得
            </button>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
            >
              ← 上一張
            </button>
            <button
              type="button"
              onClick={() => setFlipped((prev) => !prev)}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              翻面
            </button>
            <button
              type="button"
              onClick={advance}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              跳過 →
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

      {/* ── 完成結算 ── */}
      {!error && phase === "finished" && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 text-center shadow-sm">
            <p className="font-serif text-2xl font-semibold text-stone-900">
              本輪完成 🎉
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-emerald-50 px-4 py-5">
                <p className="text-3xl font-semibold text-emerald-700">
                  {sessionStats.remember}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-600">
                  記得
                </p>
              </div>
              <div className="rounded-2xl bg-rose-50 px-4 py-5">
                <p className="text-3xl font-semibold text-rose-700">
                  {sessionStats.forget}
                </p>
                <p className="mt-1 text-xs font-medium text-rose-600">
                  不記得
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs text-stone-500">
              共複習 {deck.length} 張（跳過{" "}
              {Math.max(
                0,
                deck.length - sessionStats.remember - sessionStats.forget
              )}{" "}
              張）
            </p>
            <div className="mt-8 flex flex-col gap-2">
              <button
                type="button"
                onClick={startReview}
                className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
              >
                同條件再來一輪
              </button>
              <button
                type="button"
                onClick={backToSetup}
                className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                回到設定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
