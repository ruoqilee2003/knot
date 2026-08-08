"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SkeletonBlock } from "@/lib/skeleton-cards";
import { shuffle } from "@/lib/shuffle";
import { PRESET_SUBJECTS, normalizeSubject, subjectsMatch } from "@/lib/subjects";

type Card = {
  id: string;
  subject: string;
  topic: string;
  topicEn: string;
  keywords: string[];
  prompts: string[];
  archaeologyCount: number;
  heat: number;
  definition: string;
  blocks: SkeletonBlock[];
  conclusion: string;
  confidence: number;
  simpleExplanation?: string;
};

type Round = "R1" | "R2" | "R3";
type Phase = "setup" | "reviewing" | "finished";

export default function SkeletonReviewPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("setup");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set()
  );
  const [round, setRound] = useState<Round>("R1");
  const [archaeologyOnly, setArchaeologyOnly] = useState(false);

  const [deck, setDeck] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    instant: 0,
    recalled: 0,
    blank: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cardsRes = await fetch("/api/skeleton-cards", { method: "GET" });
        if (!cardsRes.ok) {
          const payload = (await cardsRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "讀取骨架卡失敗");
        }
        const data = (await cardsRes.json()) as Array<Record<string, unknown>>;
        if (cancelled) return;
        const list: Card[] = data
          .map((x) => ({
            id: String(x.id ?? ""),
            subject: normalizeSubject(String(x.subject ?? "")),
            topic: String(x.topic ?? ""),
            topicEn: String(x.topicEn ?? ""),
            keywords: Array.isArray(x.keywordDisplay)
              ? (x.keywordDisplay as unknown[]).filter(
                  (item): item is string => typeof item === "string"
                )
              : [],
            prompts: Array.isArray(x.prompts)
              ? (x.prompts as unknown[]).filter(
                  (item): item is string => typeof item === "string"
                )
              : [],
            archaeologyCount: Array.isArray(x.archaeologyQuestionIds)
              ? x.archaeologyQuestionIds.length
              : 0,
            heat: typeof x.heat === "number" ? x.heat : 0,
            definition: String(x.definition ?? ""),
            blocks: Array.isArray(x.blocks) ? (x.blocks as SkeletonBlock[]) : [],
            conclusion: String(x.conclusion ?? ""),
            confidence: typeof x.confidence === "number" ? x.confidence : 0,
            simpleExplanation:
              typeof x.simpleExplanation === "string"
                ? x.simpleExplanation
                : undefined,
          }))
          .filter(
            (card) => card.blocks.length > 0 || card.definition.trim().length > 0
          );
        setCards(list);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "讀取骨架卡失敗");
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedKeywords((prev) => {
      const valid = new Set(keywordOptions);
      const next = new Set(
        Array.from(prev).filter((keyword) => valid.has(keyword))
      );
      return next.size === prev.size ? prev : next;
    });
  }, [keywordOptions]);

  const toggleKeyword = useCallback((keyword: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }, []);

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
    if (round === "R2") {
      pool = pool.filter((card) => card.confidence < 2);
    } else if (round === "R3") {
      pool = pool.filter((card) => card.confidence === 0);
    }
    if (archaeologyOnly) {
      pool = pool.filter((card) => card.archaeologyCount > 0);
    }
    return pool;
  }, [cards, subjectFilter, selectedKeywords, round, archaeologyOnly]);

  const startReview = useCallback(() => {
    if (matchedCards.length === 0) return;
    setDeck(shuffle(matchedCards));
    setIndex(0);
    setFlipped(false);
    setSessionStats({ instant: 0, recalled: 0, blank: 0 });
    setPhase("reviewing");
  }, [matchedCards]);

  const backToSetup = useCallback(() => {
    setPhase("setup");
    setDeck([]);
    setIndex(0);
    setFlipped(false);
  }, []);

  const current = phase === "reviewing" ? (deck[index] ?? null) : null;

  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  useEffect(() => {
    setExplainError(null);
  }, [index]);

  const handleExplain = useCallback(async () => {
    const card = deck[index];
    if (!card) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await fetch(`/api/skeleton-cards/${card.id}/simplify`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as
        | { simpleExplanation?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || "生成白話說明失敗");
      }
      const explanation = payload?.simpleExplanation ?? "";
      const patch = (item: Card) =>
        item.id === card.id ? { ...item, simpleExplanation: explanation } : item;
      setCards((prev) => prev.map(patch));
      setDeck((prev) => prev.map(patch));
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : "生成白話說明失敗");
    } finally {
      setExplaining(false);
    }
  }, [deck, index]);

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

  const markConfidence = useCallback(
    (confidence: 0 | 1 | 2) => {
      const card = deck[index];
      if (!card) return;
      void fetch(`/api/skeleton-cards/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidence }),
      }).catch(() => {});
      const patch = (item: Card) =>
        item.id === card.id ? { ...item, confidence } : item;
      setCards((prev) => prev.map(patch));
      setDeck((prev) => prev.map(patch));
      setSessionStats((prev) => ({
        instant: prev.instant + (confidence === 2 ? 1 : 0),
        recalled: prev.recalled + (confidence === 1 ? 1 : 0),
        blank: prev.blank + (confidence === 0 ? 1 : 0),
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
        markConfidence(2);
      } else if (e.key === "2") {
        e.preventDefault();
        markConfidence(1);
      } else if (e.key === "3") {
        e.preventDefault();
        markConfidence(0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, advance, goPrev, markConfidence]);

  return (
    <div className="flex min-h-full w-full flex-col px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">骨架複習</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
            {phase === "setup" ? "複習設定" : "回想模式"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            {phase === "setup"
              ? "正面只給鉤子（問法＋分類數量），翻面前先在腦中默寫一次。"
              : "空白鍵翻面，1 秒答、2 想得出來、3 空白，← → 切換卡片。"}
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
          讀取骨架卡中…
        </div>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center gap-3 text-sm text-stone-500">
          <p>目前還沒有可複習的骨架卡（至少要有一組分類架構）。</p>
          <Link href="/skeleton-cards" className="text-stone-800 underline">
            前往骨架卡列表
          </Link>
        </div>
      )}

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
              <p className="mt-3 text-sm text-stone-500">此範圍沒有關聯關鍵字。</p>
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
            <p className="text-sm font-semibold text-stone-800">複習輪次</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(
                [
                  { key: "R1" as const, title: "R1・全部卡", desc: "建立基準線" },
                  { key: "R2" as const, title: "R2・尚未秒答", desc: "信心 < 2" },
                  { key: "R3" as const, title: "R3・完全空白", desc: "信心 = 0" },
                ]
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRound(item.key)}
                  className={`rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    round === item.key
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p
                    className={`mt-1 text-xs ${
                      round === item.key ? "text-stone-300" : "text-stone-500"
                    }`}
                  >
                    {item.desc}
                  </p>
                </button>
              ))}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
              <input
                type="checkbox"
                checked={archaeologyOnly}
                onChange={(e) => setArchaeologyOnly(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-orange-600"
              />
              <span>
                <span className="text-sm font-medium text-stone-800">
                  僅顯示有連結考古題佐證的卡
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  可與上方範圍併用
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

      {!error && current && (
        <div className="mt-10 flex flex-1 flex-col items-center">
          <p className="text-sm text-stone-500">
            {index + 1} / {deck.length}
            <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
              {current.subject}
            </span>
            <span className="ml-2 text-xs text-amber-600">
              {"●".repeat(current.heat)}
              {"○".repeat(3 - current.heat)}
            </span>
            {current.archaeologyCount > 0 && (
              <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                考古 ×{current.archaeologyCount}
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
              className="relative min-h-[380px] w-full transition-transform duration-500 [transform-style:preserve-3d]"
              style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
            >
              <div className="absolute inset-0 flex flex-col items-center overflow-y-auto rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 shadow-md [backface-visibility:hidden]">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Topic
                </p>
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  {current.topicEn ? (
                    <>
                      <p className="text-3xl font-semibold leading-snug text-stone-900">
                        {current.topicEn}
                      </p>
                      <p className="mt-2 text-xl font-medium text-stone-500">
                        {current.topic}
                      </p>
                    </>
                  ) : (
                    <p className="text-3xl font-semibold leading-snug text-stone-900">
                      {current.topic}
                    </p>
                  )}
                </div>
                <div className="w-full max-w-md space-y-1">
                  {current.blocks.map((block, i) => (
                    <p
                      key={i}
                      className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-medium text-stone-600"
                    >
                      ② {block.label}（{block.count}）
                    </p>
                  ))}
                </div>
                <p className="mt-4 text-xs text-stone-400">先在腦中默寫，再點擊翻面</p>
              </div>
              <div
                className="absolute inset-0 flex flex-col items-start overflow-y-auto rounded-3xl border border-amber-200 bg-amber-50/70 p-8 shadow-md [backface-visibility:hidden]"
                style={{ transform: "rotateY(180deg)" }}
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
                  ① 定義
                </p>
                <p className="mt-1 w-full text-left text-sm leading-relaxed text-stone-900">
                  {current.definition || "（尚未填寫）"}
                </p>
                <div className="mt-4 w-full space-y-3">
                  {current.blocks.map((block, i) => (
                    <div key={i} className="w-full text-left">
                      <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
                        ② {block.label}
                        {block.note ? `（${block.note}）` : ""}
                      </p>
                      <ul className="mt-1 w-full space-y-1 text-left">
                        {block.points.map((point, j) => (
                          <li key={j} className="w-full text-left text-sm text-stone-800">
                            {point.key.trim() && (
                              <span className="font-semibold">{point.key}</span>
                            )}
                            {point.hint && (
                              <span className="text-stone-500"> → {point.hint}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-amber-600">
                  ③ 結論
                </p>
                <p className="mt-1 w-full text-left text-sm leading-relaxed text-stone-800">
                  {current.conclusion || "（尚未填寫）"}
                </p>
              </div>
            </div>
          </button>

          <div className="mt-6 w-full max-w-2xl">
            {current.simpleExplanation ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-sky-900">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
                    真的不懂？白話說明
                  </p>
                  <button
                    type="button"
                    onClick={handleExplain}
                    disabled={explaining}
                    className="text-xs text-sky-600 underline hover:text-sky-800 disabled:opacity-40"
                  >
                    {explaining ? "生成中…" : "重新生成"}
                  </button>
                </div>
                <p className="mt-2">{current.simpleExplanation}</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleExplain}
                disabled={explaining}
                className="w-full rounded-xl border border-dashed border-sky-300 bg-sky-50/50 px-4 py-3 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {explaining ? "生成中…" : "🤔 真的不懂，給我大白話說明"}
              </button>
            )}
            {explainError && (
              <p className="mt-2 text-xs text-red-600">{explainError}</p>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => markConfidence(2)}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            >
              秒答
            </button>
            <button
              type="button"
              onClick={() => markConfidence(1)}
              className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-400"
            >
              想得出來
            </button>
            <button
              type="button"
              onClick={() => markConfidence(0)}
              className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500"
            >
              空白
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

          <Link
            href={`/skeleton-cards/${current.id}`}
            className="mt-6 text-xs text-stone-500 underline hover:text-stone-800"
          >
            編輯這張卡
          </Link>
        </div>
      )}

      {!error && phase === "finished" && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 text-center shadow-sm">
            <p className="font-serif text-2xl font-semibold text-stone-900">
              本輪完成 🎉
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-emerald-50 px-3 py-5">
                <p className="text-2xl font-semibold text-emerald-700">
                  {sessionStats.instant}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-600">秒答</p>
              </div>
              <div className="rounded-2xl bg-amber-50 px-3 py-5">
                <p className="text-2xl font-semibold text-amber-700">
                  {sessionStats.recalled}
                </p>
                <p className="mt-1 text-xs font-medium text-amber-600">
                  想得出來
                </p>
              </div>
              <div className="rounded-2xl bg-rose-50 px-3 py-5">
                <p className="text-2xl font-semibold text-rose-700">
                  {sessionStats.blank}
                </p>
                <p className="mt-1 text-xs font-medium text-rose-600">空白</p>
              </div>
            </div>
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
