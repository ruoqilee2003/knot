"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PRESET_SUBJECTS, subjectsMatch } from "@/lib/subjects";
import { shuffle } from "@/lib/shuffle";

type SourceCard = {
  id: string;
  front: string;
  back: string;
  subject: string;
  questionId: string | null;
  keywords: string[];
};

type QuizQuestion = {
  id: string;
  cardId: string;
  questionId: string | null;
  subject: string;
  keywords: string[];
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  correctCount: number;
  wrongCount: number;
  marked: boolean;
};

type Mode = "all" | "wrong" | "marked";
type Phase = "setup" | "reviewing" | "finished";

const MAX_GENERATE_PER_CALL = 15;

function isWeakQuestion(q: QuizQuestion): boolean {
  return q.wrongCount > 0 && q.wrongCount >= q.correctCount;
}

export default function QuizReviewPage() {
  const [cards, setCards] = useState<SourceCard[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("setup");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set()
  );
  const [mode, setMode] = useState<Mode>("all");

  const [deck, setDeck] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    wrong: 0,
    skipped: 0,
  });
  const [wrongReview, setWrongReview] = useState<QuizQuestion[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cardsRes, quizRes] = await Promise.all([
        fetch("/api/flashcards", { method: "GET" }),
        fetch("/api/quiz-questions", { method: "GET" }),
      ]);
      if (!cardsRes.ok) {
        const payload = (await cardsRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取字卡失敗");
      }
      if (!quizRes.ok) {
        const payload = (await quizRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取選擇題失敗");
      }
      const cardsData = (await cardsRes.json()) as Array<
        Record<string, unknown>
      >;
      const quizData = (await quizRes.json()) as Array<Record<string, unknown>>;

      const cardList: SourceCard[] = cardsData
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
        }))
        .filter((card) => card.front && card.back);

      const quizList: QuizQuestion[] = quizData
        .map((x) => ({
          id: String(x.id ?? ""),
          cardId: String(x.cardId ?? ""),
          questionId: x.questionId ? String(x.questionId) : null,
          subject: String(x.subject ?? ""),
          keywords: Array.isArray(x.keywords)
            ? (x.keywords as unknown[]).filter(
                (item): item is string => typeof item === "string"
              )
            : [],
          question: String(x.question ?? ""),
          options: Array.isArray(x.options)
            ? (x.options as unknown[]).map((o) => String(o))
            : [],
          correctIndex:
            typeof x.correctIndex === "number" ? x.correctIndex : -1,
          explanation: String(x.explanation ?? ""),
          correctCount:
            typeof x.correctCount === "number" ? x.correctCount : 0,
          wrongCount: typeof x.wrongCount === "number" ? x.wrongCount : 0,
          marked: x.marked === true,
        }))
        .filter((q) => q.cardId && q.question && q.options.length === 4);

      setCards(cardList);
      setQuestions(quizList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取資料失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    return pool;
  }, [cards, subjectFilter, selectedKeywords]);

  const matchedCardIds = useMemo(
    () => new Set(matchedCards.map((c) => c.id)),
    [matchedCards]
  );

  const cardsWithoutQuiz = useMemo(() => {
    const existingCardIds = new Set(questions.map((q) => q.cardId));
    return matchedCards.filter((c) => !existingCardIds.has(c.id));
  }, [matchedCards, questions]);

  const matchedQuestions = useMemo(() => {
    let pool = questions.filter((q) => matchedCardIds.has(q.cardId));
    if (mode === "wrong") {
      pool = pool.filter(isWeakQuestion);
    } else if (mode === "marked") {
      pool = pool.filter((q) => q.marked);
    }
    return pool;
  }, [questions, matchedCardIds, mode]);

  const weakCount = useMemo(
    () => questions.filter((q) => matchedCardIds.has(q.cardId) && isWeakQuestion(q)).length,
    [questions, matchedCardIds]
  );

  const markedCount = useMemo(
    () => questions.filter((q) => matchedCardIds.has(q.cardId) && q.marked).length,
    [questions, matchedCardIds]
  );

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

  const handleGenerate = useCallback(async () => {
    if (cardsWithoutQuiz.length === 0 || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const batch = cardsWithoutQuiz.slice(0, MAX_GENERATE_PER_CALL);
      const genRes = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subjectFilter === "all" ? "" : subjectFilter,
          cards: batch.map((c) => ({ id: c.id, front: c.front, back: c.back })),
        }),
      });
      const genPayload = (await genRes.json().catch(() => null)) as
        | { questions?: Array<Record<string, unknown>>; error?: string }
        | null;
      if (!genRes.ok || !genPayload?.questions) {
        throw new Error(genPayload?.error || "生成選擇題失敗");
      }

      const cardMap = new Map(batch.map((c) => [c.id, c]));
      const toSave = genPayload.questions.map((q) => {
        const cardId = String(q.cardId ?? "");
        const card = cardMap.get(cardId);
        return {
          cardId,
          questionId: card?.questionId ?? null,
          subject: card?.subject ?? subjectFilter,
          keywords: card?.keywords ?? [],
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        };
      });

      const saveRes = await fetch("/api/quiz-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: toSave }),
      });
      if (!saveRes.ok) {
        const payload = (await saveRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "儲存選擇題失敗");
      }
      await loadData();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "生成選擇題失敗");
    } finally {
      setGenerating(false);
    }
  }, [cardsWithoutQuiz, generating, subjectFilter, loadData]);

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
      const isCorrect = optionIndex === q.correctIndex;
      setSelectedOption(optionIndex);
      setAnswered(true);

      void fetch(`/api/quiz-questions/${q.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: isCorrect ? "correct" : "wrong" }),
      }).catch(() => {});

      const patch = (item: QuizQuestion) =>
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
    (q: QuizQuestion) => {
      const nextMarked = !q.marked;
      const patch = (item: QuizQuestion) =>
        item.id === q.id ? { ...item, marked: nextMarked } : item;
      setQuestions((prev) => prev.map(patch));
      setDeck((prev) => prev.map(patch));
      void fetch(`/api/quiz-questions/${q.id}`, {
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

  const optionLabels = ["A", "B", "C", "D"];

  return (
    <div className="flex min-h-full w-full flex-col px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">選擇題複習</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
            {phase === "setup" ? "複習設定" : "作答"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            {phase === "setup"
              ? "由字卡自動生成四選一選擇題，快速上手、附詳解，答錯會累計錯題次數。"
              : "數字鍵 1-4 選答案，答題後按空白鍵／Enter 下一題。"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/review"
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            切換到翻卡複習
          </Link>
          {phase !== "setup" && (
            <button
              type="button"
              onClick={backToSetup}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              ← 回到設定
            </button>
          )}
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
          讀取中…
        </div>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="mt-16 flex flex-1 flex-col items-center justify-center gap-3 text-sm text-stone-500">
          <p>目前還沒有任何字卡，請先在練習頁批改題目產生字卡。</p>
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
                <p className="text-sm font-semibold">全部選擇題</p>
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
                此範圍已有選擇題：
                <span className="font-semibold text-stone-900">
                  {matchedCards.length - cardsWithoutQuiz.length}
                </span>{" "}
                題／字卡共 {matchedCards.length} 張，
                尚未生成：
                <span className="font-semibold text-amber-700">
                  {cardsWithoutQuiz.length}
                </span>{" "}
                張
              </p>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={cardsWithoutQuiz.length === 0 || generating}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating
                  ? "生成中…"
                  : `用 Gemini 生成選擇題（最多 ${Math.min(
                      cardsWithoutQuiz.length,
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

      {/* ── 作答中 ── */}
      {!error && current && (
        <div className="mt-10 flex flex-1 flex-col items-center">
          <p className="text-sm text-stone-500">
            {index + 1} / {deck.length}
            {current.subject && (
              <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                {current.subject}
              </span>
            )}
            <span className="ml-3 text-xs text-emerald-600">
              答對 {current.correctCount}
            </span>
            <span className="ml-2 text-xs text-rose-600">
              答錯 {current.wrongCount}
            </span>
          </p>

          <div className="mt-6 w-full max-w-2xl rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 shadow-md">
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
              {current.question}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              {current.options.map((option, i) => {
                const isSelected = selectedOption === i;
                const isCorrectOption = i === current.correctIndex;
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
                  {current.explanation}
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
          <div className="w-full max-w-xl rounded-3xl border border-stone-200 bg-[#fffdf8] p-8 shadow-sm">
            <p className="text-center font-serif text-2xl font-semibold text-stone-900">
              本輪完成 🎉
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-emerald-50 px-4 py-5 text-center">
                <p className="text-3xl font-semibold text-emerald-700">
                  {sessionStats.correct}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-600">
                  答對
                </p>
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
                <p className="mt-1 text-xs font-medium text-stone-500">
                  跳過
                </p>
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
                      <p className="text-sm font-medium text-stone-900">
                        {q.question}
                      </p>
                      <p className="mt-2 text-sm text-emerald-700">
                        正解：{optionLabels[q.correctIndex]}．{q.options[q.correctIndex]}
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
