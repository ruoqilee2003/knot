"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  dedupeKeywordsCaseInsensitive,
  parseKeywordInput,
  sanitizeKeyword,
} from "@/lib/keywords";
import {
  isCardComplete,
  toFullWidthPunctuation,
  type SkeletonBlock,
} from "@/lib/skeleton-cards";
import { PRESET_SUBJECTS, normalizeSubject } from "@/lib/subjects";

type RelatedCard = {
  id: string;
  subject: string;
  topic: string;
  topicEn: string;
  keywordDisplay: string[];
};

type ArchaeologyQuestion = {
  id: string;
  questionText: string;
  year: number;
  keywordDisplay: string[];
  isArchaeology: boolean;
};

export default function SkeletonCardEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");

  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [topicEn, setTopicEn] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [archaeologyQuestionIds, setArchaeologyQuestionIds] = useState<
    Set<string>
  >(new Set());
  const [archQuestions, setArchQuestions] = useState<ArchaeologyQuestion[]>([]);
  const [definition, setDefinition] = useState("");
  const [blocks, setBlocks] = useState<SkeletonBlock[]>([]);
  const [conclusion, setConclusion] = useState("");
  const [saveAsStub, setSaveAsStub] = useState(true);

  const [relatedCardIds, setRelatedCardIds] = useState<Set<string>>(new Set());
  const [allCards, setAllCards] = useState<RelatedCard[]>([]);
  const [relatedSearch, setRelatedSearch] = useState("");
  const [archLinksOpen, setArchLinksOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/skeleton-cards/${id}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取骨架卡失敗");
      }
      const data = (await response.json()) as Record<string, unknown>;
      setSubject(normalizeSubject(String(data.subject ?? "")) || PRESET_SUBJECTS[0]);
      setTopic(String(data.topic ?? ""));
      setTopicEn(String(data.topicEn ?? ""));
      setKeywords(
        Array.isArray(data.keywordDisplay)
          ? (data.keywordDisplay as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : []
      );
      setPrompts(
        Array.isArray(data.prompts)
          ? (data.prompts as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : []
      );
      setArchaeologyQuestionIds(
        new Set(
          Array.isArray(data.archaeologyQuestionIds)
            ? (data.archaeologyQuestionIds as unknown[]).filter(
                (item): item is string => typeof item === "string"
              )
            : []
        )
      );
      setDefinition(String(data.definition ?? ""));
      setBlocks(Array.isArray(data.blocks) ? (data.blocks as SkeletonBlock[]) : []);
      setConclusion(String(data.conclusion ?? ""));
      setSaveAsStub(data.isStub !== false);
      setRelatedCardIds(
        new Set(
          Array.isArray(data.relatedCardIds)
            ? (data.relatedCardIds as unknown[]).filter(
                (item): item is string => typeof item === "string"
              )
            : []
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取骨架卡失敗");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!subject.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArchQuestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 同科全部題目：關鍵字相符即可自動連結（不限「考古」標記）
        const params = new URLSearchParams({
          subject: subject.trim(),
        });
        const response = await fetch(`/api/questions?${params.toString()}`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<Record<string, unknown>>;
        if (cancelled) return;
        setArchQuestions(
          data.map((item) => ({
            id: String(item.id ?? ""),
            questionText: String(item.questionText ?? ""),
            year: typeof item.year === "number" ? item.year : 0,
            keywordDisplay: Array.isArray(item.latestKeywordDisplay)
              ? (item.latestKeywordDisplay as unknown[]).filter(
                  (k): k is string => typeof k === "string"
                )
              : [],
            isArchaeology: item.isArchaeology === true,
          }))
        );
      } catch {
        if (!cancelled) setArchQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject]);

  // 題目關鍵字跟卡片關鍵字有交集時自動連結，並把題幹帶入問法
  const matchedArchQuestionIds = useMemo(() => {
    const cardKeywords = new Set(keywords.map((k) => k.toLowerCase()));
    if (cardKeywords.size === 0) return new Set<string>();
    return new Set(
      archQuestions
        .filter((q) =>
          q.keywordDisplay.some((k) => cardKeywords.has(k.toLowerCase()))
        )
        .map((q) => q.id)
    );
  }, [archQuestions, keywords]);

  // 清單顯示：關鍵字相符的題目 + 標記為考古的題目（供手動勾選）
  const linkableQuestions = useMemo(() => {
    return archQuestions
      .filter(
        (q) => q.isArchaeology || matchedArchQuestionIds.has(q.id)
      )
      .sort((a, b) => {
        const aMatch = matchedArchQuestionIds.has(a.id) ? 0 : 1;
        const bMatch = matchedArchQuestionIds.has(b.id) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return (b.year || 0) - (a.year || 0);
      });
  }, [archQuestions, matchedArchQuestionIds]);

  useEffect(() => {
    if (matchedArchQuestionIds.size === 0) return;
    setArchaeologyQuestionIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const qid of matchedArchQuestionIds) {
        if (!next.has(qid)) {
          next.add(qid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [matchedArchQuestionIds]);

  useEffect(() => {
    if (archaeologyQuestionIds.size === 0 || archQuestions.length === 0) return;
    const selected = archQuestions.filter((q) =>
      archaeologyQuestionIds.has(q.id)
    );
    const drafts = selected.map((q) =>
      q.questionText.length > 40
        ? `${q.questionText.slice(0, 40)}…`
        : q.questionText
    );
    setPrompts((prev) => {
      const merged = Array.from(new Set([...prev, ...drafts].filter(Boolean)));
      return merged.length === prev.length &&
        merged.every((item, i) => item === prev[i])
        ? prev
        : merged;
    });
  }, [archaeologyQuestionIds, archQuestions]);

  // 載入全部骨架卡供「關聯骨架卡」搜尋選取
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/skeleton-cards");
        if (!response.ok) return;
        const data = (await response.json()) as Array<Record<string, unknown>>;
        if (cancelled) return;
        setAllCards(
          data.map((item) => ({
            id: String(item.id ?? ""),
            subject: String(item.subject ?? ""),
            topic: String(item.topic ?? ""),
            topicEn: String(item.topicEn ?? ""),
            keywordDisplay: Array.isArray(item.keywordDisplay)
              ? (item.keywordDisplay as unknown[]).filter(
                  (k): k is string => typeof k === "string"
                )
              : [],
          }))
        );
      } catch {
        if (!cancelled) setAllCards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const relatedSearchResults = useMemo(() => {
    const query = relatedSearch.trim().toLowerCase();
    return allCards
      .filter((card) => card.id !== id && !relatedCardIds.has(card.id))
      .filter((card) => {
        if (!query) return true;
        return (
          card.topic.toLowerCase().includes(query) ||
          card.topicEn.toLowerCase().includes(query) ||
          card.keywordDisplay.some((k) => k.toLowerCase().includes(query))
        );
      })
      .slice(0, 20);
  }, [allCards, id, relatedCardIds]);

  const relatedSelectedCards = useMemo(() => {
    return allCards.filter((card) => relatedCardIds.has(card.id));
  }, [allCards, relatedCardIds]);

  const toggleRelatedCard = useCallback((cardId: string) => {
    setRelatedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, []);

  const addKeyword = useCallback((value: string) => {
    const next = sanitizeKeyword(value);
    if (!next) return;
    setKeywords((prev) => dedupeKeywordsCaseInsensitive([...prev, next]));
    setKeywordInput("");
  }, []);

  const applyPendingKeyword = useCallback(() => {
    const pending = parseKeywordInput(keywordInput);
    if (pending.length === 0) return keywords;
    const merged = dedupeKeywordsCaseInsensitive([...keywords, ...pending]);
    setKeywords(merged);
    setKeywordInput("");
    return merged;
  }, [keywordInput, keywords]);

  const addBlock = useCallback(() => {
    setBlocks((prev) => [...prev, { label: "", count: 1, points: [] }]);
  }, []);

  const removeBlock = useCallback((index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateBlock = useCallback(
    (index: number, patch: Partial<SkeletonBlock>) => {
      setBlocks((prev) =>
        prev.map((block, i) => (i === index ? { ...block, ...patch } : block))
      );
    },
    []
  );

  const addPoint = useCallback((blockIndex: number) => {
    setBlocks((prev) =>
      prev.map((block, i) =>
        i === blockIndex && block.points.length < block.count
          ? { ...block, points: [...block.points, { key: "", hint: "" }] }
          : block
      )
    );
  }, []);

  const updatePoint = useCallback(
    (blockIndex: number, pointIndex: number, patch: { key?: string; hint?: string }) => {
      setBlocks((prev) =>
        prev.map((block, i) =>
          i === blockIndex
            ? {
                ...block,
                points: block.points.map((point, j) =>
                  j === pointIndex ? { ...point, ...patch } : point
                ),
              }
            : block
        )
      );
    },
    []
  );

  const removePoint = useCallback((blockIndex: number, pointIndex: number) => {
    setBlocks((prev) =>
      prev.map((block, i) =>
        i === blockIndex
          ? { ...block, points: block.points.filter((_, j) => j !== pointIndex) }
          : block
      )
    );
  }, []);

  const autoResizeTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const willBeComplete = useMemo(
    () => isCardComplete({ definition, conclusion, blocks }),
    [definition, conclusion, blocks]
  );

  const save = useCallback(async () => {
    if (!topic.trim()) {
      setError("主題名稱不能為空");
      return;
    }
    const finalKeywords = applyPendingKeyword();
    if (finalKeywords.length === 0) {
      setError("至少需要一個關鍵字");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/skeleton-cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          topic: topic.trim(),
          topicEn: topicEn.trim(),
          keywords: finalKeywords,
          prompts,
          archaeologyQuestionIds: Array.from(archaeologyQuestionIds),
          relatedCardIds: Array.from(relatedCardIds),
          definition,
          blocks,
          conclusion,
          isStub: saveAsStub,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "儲存失敗");
      }
      const data = (await response.json()) as { isStub: boolean };
      setSaveAsStub(data.isStub !== false);
      setSavedMessage(data.isStub ? "已儲存為卡樁" : "已儲存為完整骨架卡");
      setMode("view");
      // 重新載入以帶入伺服器端依關鍵字自動補上的考古題連結
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }, [
    id,
    subject,
    topic,
    topicEn,
    applyPendingKeyword,
    prompts,
    archaeologyQuestionIds,
    relatedCardIds,
    definition,
    blocks,
    conclusion,
    saveAsStub,
    load,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-stone-500">
        讀取中…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/skeleton-cards" className="text-xs text-stone-500 underline">
            ← 回骨架卡列表
          </Link>
          <h1 className="mt-1 font-serif text-2xl font-semibold text-stone-900">
            {mode === "edit" ? (
              "編輯骨架卡"
            ) : (
              <>
                {topic || "骨架卡"}
                {topicEn && (
                  <span className="ml-2 text-lg font-normal text-stone-500">
                    {topicEn}
                  </span>
                )}
              </>
            )}
          </h1>
        </div>
        {mode === "view" && (
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            編輯
          </button>
        )}
      </div>

      {error && (
        <div
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}
      {savedMessage && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {savedMessage}
        </div>
      )}

      {mode === "view" && (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
              {subject}
            </span>
            {saveAsStub ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                卡樁
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                完整
              </span>
            )}
            {archaeologyQuestionIds.size > 0 && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                考古 ×{archaeologyQuestionIds.size}
              </span>
            )}
            {relatedSelectedCards.length > 0 && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                關聯 ×{relatedSelectedCards.length}
              </span>
            )}
          </div>

          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <span
                  key={k}
                  className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
                >
                  #{k}
                </span>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5">
            <p className="text-sm font-semibold text-stone-800">① 定義</p>
            <p className="mt-2 w-full whitespace-pre-wrap text-left text-sm leading-relaxed text-stone-900">
              {definition || "（尚未填寫）"}
            </p>

            <p className="mt-6 text-sm font-semibold text-stone-800">
              ② 分類架構與逐點展開
            </p>
            <div className="mt-3 space-y-3">
              {blocks.map((block, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-stone-200 bg-white p-3"
                >
                  <p className="text-sm font-medium text-stone-800">
                    {block.label}
                    {block.note ? `（${block.note}）` : ""}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {block.points.map((point, j) => (
                      <li key={j} className="text-sm text-stone-700">
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
              {blocks.length === 0 && (
                <p className="text-sm text-stone-500">尚無分類架構。</p>
              )}
            </div>

            <p className="mt-6 text-sm font-semibold text-stone-800">③ 結論／實務</p>
            <p className="mt-2 w-full whitespace-pre-wrap text-left text-sm leading-relaxed text-stone-900">
              {conclusion || "（尚未填寫）"}
            </p>
          </div>

          {prompts.length > 0 && (
            <div>
              <p className="text-sm font-medium text-stone-700">問法</p>
              <ul className="mt-1 space-y-1 text-sm text-stone-700">
                {prompts.map((prompt, i) => (
                  <li key={i}>・{prompt}</li>
                ))}
              </ul>
            </div>
          )}

          {relatedSelectedCards.length > 0 && (
            <div>
              <p className="text-sm font-medium text-stone-700">關聯骨架卡</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {relatedSelectedCards.map((card) => (
                  <Link
                    key={card.id}
                    href={`/skeleton-cards/${card.id}`}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800 hover:bg-violet-200"
                  >
                    {card.topic}
                    {card.topicEn ? ` ${card.topicEn}` : ""}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "edit" && (
      <>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-stone-700">科目</label>
          <select
            value={
              PRESET_SUBJECTS.includes(
                subject as (typeof PRESET_SUBJECTS)[number]
              )
                ? subject
                : PRESET_SUBJECTS[0]
            }
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
          >
            {PRESET_SUBJECTS.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-stone-700">主題名稱（中文）</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-stone-700">主題名稱（英文）</label>
          <input
            value={topicEn}
            onChange={(e) => setTopicEn(e.target.value)}
            placeholder="例如：Deadlock"
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium text-stone-700">關鍵字（主索引）</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === "，") {
                e.preventDefault();
                addKeyword(keywordInput);
              }
            }}
            placeholder="#Deadlock"
            className="min-w-[200px] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
          />
          <button
            type="button"
            onClick={() => addKeyword(keywordInput)}
            disabled={!keywordInput.trim()}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            新增
          </button>
        </div>
        {keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {keywords.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() =>
                  setKeywords((prev) => prev.filter((k) => k !== item))
                }
                className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-300"
              >
                #{item} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 rounded-2xl border border-stone-200 bg-[#fffdf8] p-5">
        <p className="text-sm font-semibold text-stone-800">① 定義</p>
        <textarea
          value={definition}
          onChange={(e) => setDefinition(toFullWidthPunctuation(e.target.value))}
          placeholder="講它是什麼"
          className="mt-2 min-h-[120px] w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
        />

        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm font-semibold text-stone-800">② 分類架構與逐點展開</p>
          <button
            type="button"
            onClick={addBlock}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
          >
            + 新增分類
          </button>
        </div>
        <div className="mt-3 space-y-4">
          {blocks.map((block, blockIndex) => (
            <div
              key={blockIndex}
              className="rounded-xl border border-stone-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={block.label}
                  onChange={(e) =>
                    updateBlock(blockIndex, {
                      label: toFullWidthPunctuation(e.target.value),
                    })
                  }
                  placeholder="分類名稱，例如：四個必要條件"
                  className="min-w-[160px] flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                />
                <label className="flex items-center gap-1 text-xs text-stone-600">
                  數量
                  <input
                    type="number"
                    min={1}
                    value={block.count}
                    onChange={(e) =>
                      updateBlock(blockIndex, {
                        count: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-16 rounded-lg border border-stone-300 px-2 py-1 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeBlock(blockIndex)}
                  className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                >
                  刪除分類
                </button>
              </div>
              <input
                value={block.note ?? ""}
                onChange={(e) =>
                  updateBlock(blockIndex, {
                    note: toFullWidthPunctuation(e.target.value),
                  })
                }
                placeholder="簡短註記（選填）"
                className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600 outline-none ring-stone-400 focus:ring-2"
              />

              <div className="mt-3 space-y-1.5">
                {block.points.map((point, pointIndex) => (
                  <div key={pointIndex} className="flex flex-wrap items-start gap-2">
                    <input
                      value={point.key}
                      onChange={(e) =>
                        updatePoint(blockIndex, pointIndex, {
                          key: toFullWidthPunctuation(e.target.value),
                        })
                      }
                      placeholder="重點"
                      className="w-36 flex-none rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-900 outline-none ring-stone-400 focus:ring-2"
                    />
                    <textarea
                      ref={autoResizeTextarea}
                      value={point.hint ?? ""}
                      onChange={(e) => {
                        updatePoint(blockIndex, pointIndex, {
                          hint: toFullWidthPunctuation(e.target.value),
                        });
                        autoResizeTextarea(e.currentTarget);
                      }}
                      placeholder="提示"
                      rows={1}
                      className="min-w-[140px] flex-1 resize-none overflow-hidden rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 outline-none ring-stone-400 focus:ring-2"
                    />
                    <button
                      type="button"
                      onClick={() => removePoint(blockIndex, pointIndex)}
                      className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      刪
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addPoint(blockIndex)}
                  disabled={block.points.length >= block.count}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                >
                  + 新增重點（{block.points.length}/{block.count}）
                </button>
              </div>
            </div>
          ))}
          {blocks.length === 0 && (
            <p className="text-sm text-stone-500">還沒有分類，先按「+ 新增分類」。</p>
          )}
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-stone-800">③ 結論／實務</p>
          <textarea
            value={conclusion}
            onChange={(e) => setConclusion(toFullWidthPunctuation(e.target.value))}
            placeholder="一句話，講取捨或實務現況"
            className="mt-2 min-h-[120px] w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
          />
        </div>
      </div>

      {linkableQuestions.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setArchLinksOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-left hover:bg-stone-50"
          >
            <span className="text-sm font-medium text-stone-700">
              連結題目／問法
              {archaeologyQuestionIds.size > 0 && (
                <span className="ml-1.5 text-xs font-normal text-stone-500">
                  已連結 {archaeologyQuestionIds.size} 題
                </span>
              )}
            </span>
            <span className="text-xs text-stone-400">
              {archLinksOpen ? "收合 ▲" : "展開 ▼"}
            </span>
          </button>
          {archLinksOpen && (
            <>
              <p className="mt-2 text-xs text-stone-500">
                同科且關鍵字相符的題目會自動連結並帶入問法；標記為考古的題目也可手動勾選。
              </p>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
                {linkableQuestions.map((q) => (
                  <label
                    key={q.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs text-stone-700 hover:bg-stone-50"
                  >
                    <input
                      type="checkbox"
                      checked={archaeologyQuestionIds.has(q.id)}
                      onChange={(e) => {
                        setArchaeologyQuestionIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(q.id);
                          else next.delete(q.id);
                          return next;
                        });
                      }}
                      className="mt-0.5 h-3.5 w-3.5 accent-orange-600"
                    />
                    <span>
                      {q.year ? `${q.year}・` : ""}
                      {q.questionText.slice(0, 60)}
                      {matchedArchQuestionIds.has(q.id) && (
                        <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                          關鍵字相符
                        </span>
                      )}
                      {q.isArchaeology && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          考古
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-4">
        <label className="text-sm font-medium text-stone-700">問法</label>
        <div className="mt-1 space-y-1.5">
          {prompts.map((prompt, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={prompt}
                onChange={(e) =>
                  setPrompts((prev) =>
                    prev.map((item, i) => (i === index ? e.target.value : item))
                  )
                }
                className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
              />
              <button
                type="button"
                onClick={() =>
                  setPrompts((prev) => prev.filter((_, i) => i !== index))
                }
                className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                刪
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPrompts((prev) => [...prev, ""])}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
          >
            + 新增問法
          </button>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-stone-700">關聯骨架卡</p>
        {relatedSelectedCards.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {relatedSelectedCards.map((card) => (
              <button
                type="button"
                key={card.id}
                onClick={() => toggleRelatedCard(card.id)}
                className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800 hover:bg-violet-200"
              >
                {card.topic}
                {card.topicEn ? ` ${card.topicEn}` : ""} ×
              </button>
            ))}
          </div>
        )}
        <input
          value={relatedSearch}
          onChange={(e) => setRelatedSearch(e.target.value)}
          placeholder="搜尋主題名稱或關鍵字來連結相關骨架卡，例如：OSI參考模型 或 應用層"
          className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
        />
        {relatedSearch.trim() && relatedSearchResults.length > 0 && (
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
            {relatedSearchResults.map((card) => (
              <button
                type="button"
                key={card.id}
                onClick={() => {
                  toggleRelatedCard(card.id);
                  setRelatedSearch("");
                }}
                className="block w-full rounded px-1 py-1 text-left text-xs text-stone-700 hover:bg-stone-50"
              >
                <span className="text-stone-400">{card.subject}・</span>
                {card.topic}
                {card.topicEn ? ` ${card.topicEn}` : ""}
                {card.keywordDisplay.length > 0 && (
                  <span className="ml-1.5 text-stone-400">
                    {card.keywordDisplay.map((k) => `#${k}`).join(" ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm text-stone-600">
            內容完整度：
            <span className="font-medium text-stone-900">
              {willBeComplete ? "已補完" : "尚未補完"}
            </span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-sm font-medium text-stone-700">儲存為</p>
            <button
              type="button"
              onClick={() => setSaveAsStub(true)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
                saveAsStub
                  ? "border-sky-600 bg-sky-100 text-sky-800"
                  : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              卡樁
            </button>
            <button
              type="button"
              onClick={() => setSaveAsStub(false)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
                !saveAsStub
                  ? "border-emerald-600 bg-emerald-100 text-emerald-800"
                  : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              骨架卡
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void load();
              setMode("view");
            }}
            disabled={saving}
            className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-stone-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
