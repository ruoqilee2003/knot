"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { shuffle } from "@/lib/shuffle";

const STORAGE_KEY = "knot:common-subjects-session";

type StoredSession = {
  phase: Phase;
  deckIds: string[];
  index: number;
  sessionStats: { correct: number; wrong: number; skipped: number };
  wrongReviewIds: string[];
  examFilter: string;
  mode: Mode;
};

type CommonQuestion = {
  id: string;
  examName: string;
  subjectLabel: string;
  number: number;
  stem: string;
  options: string[];
  answerIndex: number;
  passage: string | null;
  explanation: string | null;
  correctCount: number;
  wrongCount: number;
  marked: boolean;
};

type Mode = "all" | "wrong" | "marked";
type Phase = "setup" | "reviewing" | "finished";

const MAX_GENERATE_PER_CALL = 15;
const optionLabels = ["A", "B", "C", "D"];

function isWeakQuestion(q: CommonQuestion): boolean {
  return q.wrongCount > 0 && q.wrongCount >= q.correctCount;
}

export default function CommonSubjectsPage() {
  const [questions, setQuestions] = useState<CommonQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 生成詳解
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 複習設定
  const [phase, setPhase] = useState<Phase>("setup");
  const [examFilter, setExamFilter] = useState("all");
  const [mode, setMode] = useState<Mode>("all");

  const [deck, setDeck] = useState<CommonQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    wrong: 0,
    skipped: 0,
  });
  const [wrongReview, setWrongReview] = useState<CommonQuestion[]>([]);
  const [restored, setRestored] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/common-questions", { method: "GET" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取共同科目題庫失敗");
      }
      const data = (await res.json()) as Array<Record<string, unknown>>;
      const list: CommonQuestion[] = data
        .map((x) => ({
          id: String(x.id ?? ""),
          examName: String(x.examName ?? ""),
          subjectLabel: String(x.subjectLabel ?? ""),
          number: typeof x.number === "number" ? x.number : 0,
          stem: String(x.stem ?? ""),
          options: Array.isArray(x.options)
            ? (x.options as unknown[]).map((o) => String(o))
            : [],
          answerIndex: typeof x.answerIndex === "number" ? x.answerIndex : -1,
          passage: typeof x.passage === "string" ? x.passage : null,
          explanation: typeof x.explanation === "string" ? x.explanation : null,
          correctCount: typeof x.correctCount === "number" ? x.correctCount : 0,
          wrongCount: typeof x.wrongCount === "number" ? x.wrongCount : 0,
          marked: x.marked === true,
        }))
        .filter((q) => q.stem && q.options.length === 4);
      setQuestions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取資料失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 還原上次未完成的複習進度（避免不小心切頁面就要重新開始）
  useEffect(() => {
    if (loading || restored) return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredSession;
        if (
          parsed.phase !== "setup" &&
          Array.isArray(parsed.deckIds) &&
          parsed.deckIds.length > 0
        ) {
          const map = new Map(questions.map((q) => [q.id, q]));
          const restoredDeck = parsed.deckIds
            .map((id) => map.get(id))
            .filter((q): q is CommonQuestion => Boolean(q));
          if (restoredDeck.length === parsed.deckIds.length) {
            setDeck(restoredDeck);
            setIndex(Math.min(parsed.index, restoredDeck.length - 1));
            setSessionStats(parsed.sessionStats);
            setWrongReview(
              parsed.wrongReviewIds
                .map((id) => map.get(id))
                .filter((q): q is CommonQuestion => Boolean(q))
            );
            setExamFilter(parsed.examFilter);
            setMode(parsed.mode);
            setPhase(parsed.phase);
          } else {
            sessionStorage.removeItem(STORAGE_KEY);
          }
        }
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setRestored(true);
  }, [loading, restored, questions]);

  // 持續把複習進度存起來，切頁面回來可以接續
  useEffect(() => {
    if (!restored) return;
    if (phase === "setup") {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload: StoredSession = {
      phase,
      deckIds: deck.map((q) => q.id),
      index,
      sessionStats,
      wrongReviewIds: wrongReview.map((q) => q.id),
      examFilter,
      mode,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    restored,
    phase,
    deck,
    index,
    sessionStats,
    wrongReview,
    examFilter,
    mode,
  ]);

  const examNames = useMemo(() => {
    const set = new Set(questions.map((q) => q.examName).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [questions]);

  const matchedQuestionsAll = useMemo(() => {
    return examFilter === "all"
      ? questions
      : questions.filter((q) => q.examName === examFilter);
  }, [questions, examFilter]);

  const withoutExplanation = useMemo(
    () => matchedQuestionsAll.filter((q) => !q.explanation),
    [matchedQuestionsAll]
  );

  const matchedQuestions = useMemo(() => {
    let pool = matchedQuestionsAll.filter((q) => q.explanation);
    if (mode === "wrong") {
      pool = pool.filter(isWeakQuestion);
    } else if (mode === "marked") {
      pool = pool.filter((q) => q.marked);
    }
    return pool;
  }, [matchedQuestionsAll, mode]);

  const weakCount = useMemo(
    () => matchedQuestionsAll.filter((q) => q.explanation && isWeakQuestion(q)).length,
    [matchedQuestionsAll]
  );

  const markedCount = useMemo(
    () => matchedQuestionsAll.filter((q) => q.explanation && q.marked).length,
    [matchedQuestionsAll]
  );

  const handleGenerateExplanations = useCallback(async () => {
    if (withoutExplanation.length === 0 || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const batch = withoutExplanation.slice(0, MAX_GENERATE_PER_CALL);
      const res = await fetch("/api/common-questions/generate-explanations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch.map((q) => q.id) }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { explanations?: Array<{ id: string; explanation: string }>; error?: string }
        | null;
      if (!res.ok || !payload?.explanations) {
        throw new Error(payload?.error || "生成詳解失敗");
      }
      await loadData();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "生成詳解失敗");
    } finally {
      setGenerating(false);
    }
  }, [withoutExplanation, generating, loadData]);

  const startReview = useCallback(() => {
    if (matchedQuestions.length === 0) return;
    setDeck(shuffle(matchedQuestions));
    setIndex(0);
    setSelectedOption(null);
    setAnswered(false);
    setSessionStats({ correct: 0, wrong: 0, skipped: 0 });
    setWrongReview([]);
    setPhase("reviewing");
  }, [matchedQuestions]);

  const backToSetup = useCallback(() => {
    setPhase("setup");
    setDeck([]);
    setIndex(0);
    setSelectedOption(null);
    setAnswered(false);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const current = phase === "reviewing" ? (deck[index] ?? null) : null;

  const advance = useCallback(() => {
    setSelectedOption(null);
    setAnswered(false);
    setIndex((prevIndex) => {
      if (prevIndex + 1 >= deck.length) {
        setPhase("finished");
        return prevIndex;
      }
      return prevIndex + 1;
    });
  }, [deck.length]);

  const skip = useCallback(() => {
    if (answered) return;
    setSessionStats((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
    advance();
  }, [answered, advance]);

  const selectOption = useCallback(
    (optionIndex: number) => {
      const q = deck[index];
      if (!q || answered) return;
      const isCorrect = optionIndex === q.answerIndex;
      setSelectedOption(optionIndex);
      setAnswered(true);

      void fetch(`/api/common-questions/${q.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: isCorrect ? "correct" : "wrong" }),
      }).catch(() => {});

      const patch = (item: CommonQuestion) =>
        item.id === q.id
          ? {
              ...item,
              correctCount: item.correctCount + (isCorrect ? 1 : 0),
              wrongCount: item.wrongCount + (isCorrect ? 0 : 1),
            }
          : item;
      setQuestions((prev) => prev.map(patch));
      setDeck((prev) => prev.map(patch));
      setSessionStats((prev) => ({
        ...prev,
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
      }));
      if (!isCorrect) {
        setWrongReview((prev) => [...prev, q]);
      }
    },
    [deck, index, answered]
  );

  const toggleMarked = useCallback(
    (q: CommonQuestion) => {
      const nextMarked = !q.marked;
      const patch = (item: CommonQuestion) =>
        item.id === q.id ? { ...item, marked: nextMarked } : item;
      setQuestions((prev) => prev.map(patch));
      setDeck((prev) => prev.map(patch));
      void fetch(`/api/common-questions/${q.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marked: nextMarked }),
      }).catch(() => {});
    },
    []
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
      if (["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        if (!answered) selectOption(Number(e.key) - 1);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (answered) advance();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (answered) advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, answered, selectOption, advance]);

  return (
    <div className="flex min-h-full w-full flex-col px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">共同科目</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
            {phase === "setup" ? "題庫匯入與複習設定" : "作答"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            {phase === "setup"
              ? "題庫由後台腳本匯入，用 Gemini 補上詳解後即可作答複習。"
              : "數字鍵 1-4 選答案，答題後按空白鍵／Enter 下一題。"}
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
          讀取中…
        </div>
      )}

      {/* ── 設定畫面 ── */}
      {!loading && !error && phase === "setup" && (
        <div className="mt-8 flex w-full max-w-2xl flex-col gap-6 self-center">
          {questions.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-[#fffdf8] p-6 text-center text-sm text-stone-500 shadow-sm">
              目前還沒有共同科目題庫，請以匯入腳本建立題庫。
            </div>
          ) : (
            <div className="rounded-3xl border border-stone-200 bg-[#fffdf8] p-6 shadow-sm md:p-8">
              <div>
                <p className="text-sm font-semibold text-stone-800">題庫</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setExamFilter("all")}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      examFilter === "all"
                        ? "bg-stone-900 text-white"
                        : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    全部
                  </button>
                  {examNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setExamFilter(name)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                        examFilter === name
                          ? "bg-stone-900 text-white"
                          : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <p className="text-sm font-semibold text-stone-800">複習範圍</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setMode("all")}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      mode === "all"
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <p className="text-sm font-semibold">全部已有詳解的題</p>
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
                    onClick={() => setMode("wrong")}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      mode === "wrong"
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <p className="text-sm font-semibold">加強錯題</p>
                    <p
                      className={`mt-1 text-xs ${
                        mode === "wrong" ? "text-stone-300" : "text-stone-500"
                      }`}
                    >
                      只出「答錯次數 ≥ 答對次數」的題（此範圍共 {weakCount} 題）
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("marked")}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      mode === "marked"
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <p className="text-sm font-semibold">★ 想再看一次</p>
                    <p
                      className={`mt-1 text-xs ${
                        mode === "marked" ? "text-stone-300" : "text-stone-500"
                      }`}
                    >
                      只出有標記「想再看一次」的題（此範圍共 {markedCount} 題）
                    </p>
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-stone-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-stone-700">
                    此範圍已有詳解：
                    <span className="font-semibold text-stone-900">
                      {matchedQuestionsAll.length - withoutExplanation.length}
                    </span>{" "}
                    題／共 {matchedQuestionsAll.length} 題，尚未生成：
                    <span className="font-semibold text-amber-700">
                      {withoutExplanation.length}
                    </span>{" "}
                    題
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleGenerateExplanations()}
                    disabled={withoutExplanation.length === 0 || generating}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {generating
                      ? "生成中…"
                      : `用 Gemini 生成詳解（最多 ${Math.min(
                          withoutExplanation.length,
                          MAX_GENERATE_PER_CALL
                        )} 題）`}
                  </button>
                </div>
                {generateError && (
                  <p className="mt-2 text-xs text-red-700">{generateError}</p>
                )}
              </div>

              <div className="mt-8 flex items-center justify-between gap-4 border-t border-stone-200 pt-6">
                <p className="text-sm text-stone-600">
                  符合條件：
                  <span className="font-semibold text-stone-900">
                    {matchedQuestions.length}
                  </span>{" "}
                  題
                </p>
                <button
                  type="button"
                  onClick={startReview}
                  disabled={matchedQuestions.length === 0}
                  className="rounded-xl bg-stone-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  開始作答 →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 作答中 ── */}
      {!error && current && (
        <div className="mt-10 flex flex-1 flex-col items-center">
          <p className="text-sm text-stone-500">
            {index + 1} / {deck.length}
            <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
              {current.examName}第{current.number}題
            </span>
            <span className="ml-3 text-xs text-emerald-600">
              答對 {current.correctCount}
            </span>
            <span className="ml-2 text-xs text-rose-600">
              答錯 {current.wrongCount}
            </span>
          </p>

          <div className="mt-6 w-full max-w-2xl rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 shadow-md">
            {current.passage && (
              <div className="mb-6 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Passage
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                  {current.passage}
                </p>
              </div>
            )}

            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                Question
              </p>
              <button
                type="button"
                onClick={() => toggleMarked(current)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  current.marked
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-stone-300 bg-white text-stone-500 hover:bg-stone-50"
                }`}
              >
                {current.marked ? "★ 已標記想再看" : "☆ 標記想再看"}
              </button>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-lg font-medium leading-relaxed text-stone-900">
              {current.stem}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              {current.options.map((option, i) => {
                const isSelected = selectedOption === i;
                const isCorrectOption = i === current.answerIndex;
                let stateClass =
                  "border-stone-300 bg-white text-stone-800 hover:bg-stone-50";
                if (answered) {
                  if (isCorrectOption) {
                    stateClass = "border-emerald-500 bg-emerald-50 text-emerald-900";
                  } else if (isSelected) {
                    stateClass = "border-rose-500 bg-rose-50 text-rose-900";
                  } else {
                    stateClass = "border-stone-200 bg-white text-stone-500";
                  }
                }
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectOption(i)}
                    disabled={answered}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-default ${stateClass}`}
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold">
                      {optionLabels[i]}
                    </span>
                    <span className="whitespace-pre-wrap leading-relaxed">
                      {option}
                    </span>
                  </button>
                );
              })}
            </div>

            {answered && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">
                  詳解
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
                  {current.explanation || "（尚無詳解）"}
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center gap-3">
            {!answered ? (
              <button
                type="button"
                onClick={skip}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
              >
                跳過 →
              </button>
            ) : (
              <button
                type="button"
                onClick={advance}
                className="rounded-xl bg-stone-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-800"
              >
                下一題 →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 完成結算 ── */}
      {!error && phase === "finished" && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-xl rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 shadow-sm">
            <p className="text-center font-serif text-2xl font-semibold text-stone-900">
              本輪完成 🎉
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-emerald-50 px-4 py-5 text-center">
                <p className="text-3xl font-semibold text-emerald-700">
                  {sessionStats.correct}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-600">答對</p>
              </div>
              <div className="rounded-2xl bg-rose-50 px-4 py-5 text-center">
                <p className="text-3xl font-semibold text-rose-700">
                  {sessionStats.wrong}
                </p>
                <p className="mt-1 text-xs font-medium text-rose-600">答錯</p>
              </div>
              <div className="rounded-2xl bg-stone-100 px-4 py-5 text-center">
                <p className="text-3xl font-semibold text-stone-700">
                  {sessionStats.skipped}
                </p>
                <p className="mt-1 text-xs font-medium text-stone-500">跳過</p>
              </div>
            </div>

            {wrongReview.length > 0 && (
              <div className="mt-8">
                <p className="text-sm font-semibold text-stone-800">
                  錯題回顧（{wrongReview.length} 題）
                </p>
                <div className="mt-3 flex max-h-80 flex-col gap-3 overflow-y-auto">
                  {wrongReview.map((q, i) => (
                    <div
                      key={`${q.id}-${i}`}
                      className="rounded-xl border border-rose-200 bg-rose-50/50 p-4"
                    >
                      <p className="text-sm font-medium text-stone-900">{q.stem}</p>
                      <p className="mt-2 text-sm text-emerald-700">
                        正解：{optionLabels[q.answerIndex]}．{q.options[q.answerIndex]}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-stone-600">
                        {q.explanation}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
