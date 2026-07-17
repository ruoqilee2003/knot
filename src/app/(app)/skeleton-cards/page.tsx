"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import {
  dedupeKeywordsCaseInsensitive,
  parseKeywordInput,
  sanitizeKeyword,
} from "@/lib/keywords";
import { SKELETON_SUBJECTS } from "@/lib/skeleton-cards";

type SkeletonCard = {
  id: string;
  subject: string;
  topic: string;
  topicEn: string;
  keywordDisplay: string[];
  archaeologyQuestionIds: string[];
  relatedCardIds: string[];
  heat: number;
  isStub: boolean;
  confidence: number;
};

type ArchaeologyQuestion = {
  id: string;
  questionText: string;
  year: number;
};

type Duplicate = { id: string; topic: string; matchedKeywords: string[] };

export default function SkeletonCardsPage() {
  const [cards, setCards] = useState<SkeletonCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formSubject, setFormSubject] = useState(SKELETON_SUBJECTS[0]);
  const [formTopic, setFormTopic] = useState("");
  const [formTopicEn, setFormTopicEn] = useState("");
  const [formKeywordInput, setFormKeywordInput] = useState("");
  const [formKeywords, setFormKeywords] = useState<string[]>([]);
  const [keywordOptions, setKeywordOptions] = useState<string[]>([]);
  const [archQuestions, setArchQuestions] = useState<ArchaeologyQuestion[]>([]);
  const [selectedArchIds, setSelectedArchIds] = useState<Set<string>>(new Set());
  const [formBusy, setFormBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/skeleton-cards", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取骨架卡失敗");
      }
      const data = (await response.json()) as Array<Record<string, unknown>>;
      const list: SkeletonCard[] = data.map((x) => ({
        id: String(x.id ?? ""),
        subject: String(x.subject ?? ""),
        topic: String(x.topic ?? ""),
        topicEn: String(x.topicEn ?? ""),
        keywordDisplay: Array.isArray(x.keywordDisplay)
          ? (x.keywordDisplay as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : [],
        archaeologyQuestionIds: Array.isArray(x.archaeologyQuestionIds)
          ? (x.archaeologyQuestionIds as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : [],
        relatedCardIds: Array.isArray(x.relatedCardIds)
          ? (x.relatedCardIds as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : [],
        heat: typeof x.heat === "number" ? x.heat : 0,
        isStub: x.isStub !== false,
        confidence: typeof x.confidence === "number" ? x.confidence : 0,
      }));
      setCards(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取骨架卡失敗");
      setCards([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // 表單開著且選了科目時，載入該科目的考古題供連結
  useEffect(() => {
    if (!formOpen || !formSubject.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArchQuestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          subject: formSubject.trim(),
          archaeology: "1",
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
          }))
        );
      } catch {
        if (!cancelled) setArchQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formOpen, formSubject]);

  const subjects = useMemo(() => {
    return Array.from(
      new Set(cards.map((card) => card.subject.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [cards]);

  const visibleCards = useMemo(() => {
    const pool =
      subjectFilter === "all"
        ? cards
        : cards.filter((card) => card.subject === subjectFilter);
    return [...pool].sort(
      (a, b) => b.heat - a.heat || a.topic.localeCompare(b.topic, "zh-Hant")
    );
  }, [cards, subjectFilter]);

  const stubCountBySubject = useMemo(() => {
    const map = new Map<string, { total: number; stub: number }>();
    for (const card of cards) {
      const entry = map.get(card.subject) ?? { total: 0, stub: 0 };
      entry.total += 1;
      if (card.isStub) entry.stub += 1;
      map.set(card.subject, entry);
    }
    return map;
  }, [cards]);

  // 依輸入內容從 /api/keywords 抓取既有關鍵字建議（debounce 220ms）
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (formKeywordInput.trim()) {
          params.set("query", formKeywordInput.trim());
        }
        params.set("limit", "30");
        const response = await fetch(`/api/keywords?${params.toString()}`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<{ keyword?: string }>;
        if (cancelled) return;
        const options = data
          .map((item) => sanitizeKeyword(String(item.keyword ?? "")))
          .filter(Boolean);
        setKeywordOptions(dedupeKeywordsCaseInsensitive(options));
      } catch {
        if (!cancelled) setKeywordOptions([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [formKeywordInput]);

  const suggestedKeywords = useMemo(() => {
    return keywordOptions
      .filter(
        (item) =>
          !formKeywords.some(
            (chosen) => chosen.toLowerCase() === item.toLowerCase()
          )
      )
      .slice(0, 12);
  }, [keywordOptions, formKeywords]);

  const addFormKeyword = useCallback((value: string) => {
    const next = sanitizeKeyword(value);
    if (!next) return;
    setFormKeywords((prev) => dedupeKeywordsCaseInsensitive([...prev, next]));
    setFormKeywordInput("");
  }, []);

  const submitForm = useCallback(
    async (allowDuplicate: boolean) => {
      if (!formSubject.trim() || !formTopic.trim()) {
        setError("請填寫科目與主題名稱");
        return;
      }
      const keywords = dedupeKeywordsCaseInsensitive([
        ...formKeywords,
        ...parseKeywordInput(formKeywordInput),
      ]);
      if (keywords.length === 0) {
        setError("至少需要一個關鍵字");
        return;
      }
      setFormBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/skeleton-cards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: formSubject.trim(),
            topic: formTopic.trim(),
            topicEn: formTopicEn.trim(),
            keywords,
            archaeologyQuestionIds: Array.from(selectedArchIds),
            allowDuplicate,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; duplicates?: Duplicate[] }
            | null;
          if (
            response.status === 409 &&
            Array.isArray(payload?.duplicates) &&
            payload.duplicates.length > 0
          ) {
            setDuplicates(payload.duplicates);
            return;
          }
          throw new Error(payload?.error || "新增骨架卡失敗");
        }
        const created = (await response.json()) as { id: string };
        setFormOpen(false);
        setFormSubject(SKELETON_SUBJECTS[0]);
        setFormTopic("");
        setFormTopicEn("");
        setFormKeywords([]);
        setFormKeywordInput("");
        setSelectedArchIds(new Set());
        setDuplicates([]);
        await load();
        if (typeof window !== "undefined") {
          window.location.href = `/skeleton-cards/${created.id}`;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "新增骨架卡失敗");
      } finally {
        setFormBusy(false);
      }
    },
    [
      formSubject,
      formTopic,
      formTopicEn,
      formKeywords,
      formKeywordInput,
      selectedArchIds,
      load,
    ]
  );

  const bumpHeat = useCallback(async (id: string, delta: number) => {
    try {
      const response = await fetch(`/api/skeleton-cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heatDelta: delta }),
      });
      if (!response.ok) throw new Error("更新熱度失敗");
      const data = (await response.json()) as { heat: number };
      setCards((prev) =>
        prev.map((card) => (card.id === id ? { ...card, heat: data.heat } : card))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新熱度失敗");
    }
  }, []);

  const deleteCard = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/skeleton-cards/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("刪除骨架卡失敗");
      setCards((prev) => prev.filter((card) => card.id !== id));
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除骨架卡失敗");
    } finally {
      setDeleting(false);
    }
  }, []);

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">可默寫的架構</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">
            骨架卡
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            定義 → 分類架構 → 逐點展開 → 結論實務。內容補完前會先存成卡樁，之後再挖出來補完。
          </p>
        </div>
        <Link
          href="/skeleton-review"
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          進入骨架複習 →
        </Link>
      </div>

      {error && (
        <div
          className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-stone-700">
          科目
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
          onClick={() => setFormOpen((prev) => !prev)}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-40"
        >
          {formOpen ? "取消新增" : "+ 新增骨架卡"}
        </button>
      </div>

      {formOpen && (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-[#fffdf8] p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-stone-700">科目</label>
              <select
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
              >
                {SKELETON_SUBJECTS.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-stone-700">
                關鍵字（主索引）
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  value={formKeywordInput}
                  onChange={(e) => setFormKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "," || e.key === "，") {
                      e.preventDefault();
                      addFormKeyword(formKeywordInput);
                    }
                  }}
                  placeholder="#Deadlock"
                  className="min-w-[160px] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => addFormKeyword(formKeywordInput)}
                  disabled={!formKeywordInput.trim()}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  新增
                </button>
              </div>
            </div>
          </div>

          {formKeywordInput.trim() && suggestedKeywords.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-stone-500">符合的既有關鍵字</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {suggestedKeywords.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => addFormKeyword(item)}
                    className="rounded-full border border-dashed border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-600 transition hover:border-stone-500 hover:bg-stone-50 hover:text-stone-900"
                  >
                    + #{item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {formKeywords.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {formKeywords.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() =>
                    setFormKeywords((prev) => prev.filter((k) => k !== item))
                  }
                  className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-300"
                >
                  #{item} ×
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-stone-700">主題名稱（中文）</label>
              <input
                value={formTopic}
                onChange={(e) => setFormTopic(e.target.value)}
                placeholder="例如：死結"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-stone-700">主題名稱（英文）</label>
              <input
                value={formTopicEn}
                onChange={(e) => setFormTopicEn(e.target.value)}
                placeholder="例如：Deadlock"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
              />
            </div>
          </div>

          {formSubject.trim() && archQuestions.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-stone-700">
                連結考古題（選填，佐證用）
              </p>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
                {archQuestions.map((q) => (
                  <label
                    key={q.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs text-stone-700 hover:bg-stone-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedArchIds.has(q.id)}
                      onChange={(e) => {
                        setSelectedArchIds((prev) => {
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
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {duplicates.length > 0 && (
            <div
              className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="alert"
            >
              <p className="font-medium">偵測到相同關鍵字的骨架卡，可能已經存在：</p>
              <ul className="mt-2 space-y-1">
                {duplicates.map((d) => (
                  <li key={d.id} className="text-xs text-stone-700">
                    {d.topic}（重複關鍵字：{d.matchedKeywords.join("、")}）
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void submitForm(true)}
                disabled={formBusy}
                className="mt-2 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-60"
              >
                {formBusy ? "建立中…" : "仍要建立"}
              </button>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setDuplicates([]);
                void submitForm(false);
              }}
              disabled={formBusy}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
            >
              {formBusy ? "建立中…" : "建立並進入編輯"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={Boolean(deleteTargetId)}
        title="刪除骨架卡"
        description="此動作無法復原，確定要刪除這張骨架卡嗎？"
        confirmLabel="確認刪除"
        busy={deleting}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (!deleteTargetId || deleting) return;
          void deleteCard(deleteTargetId);
        }}
      />

      {subjectFilter !== "all" && stubCountBySubject.get(subjectFilter) && (
        <p className="mt-4 text-xs text-stone-500">
          {subjectFilter}：共 {stubCountBySubject.get(subjectFilter)?.total} 張（
          {stubCountBySubject.get(subjectFilter)?.stub} 張待補完）
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {visibleCards.map((card) => (
          <li
            key={card.id}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-stone-500">{card.subject}</p>
              {card.isStub ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                  卡樁
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                  完整・信心 {card.confidence}
                </span>
              )}
              <span className="text-xs text-amber-600">
                {"●".repeat(card.heat)}
                {"○".repeat(3 - card.heat)}
              </span>
              {card.archaeologyQuestionIds.length > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">
                  考古 ×{card.archaeologyQuestionIds.length}
                </span>
              )}
              {card.relatedCardIds.length > 0 && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
                  關聯 ×{card.relatedCardIds.length}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-semibold text-stone-900">
              {card.topic}
              {card.topicEn && (
                <span className="ml-1.5 font-normal text-stone-500">
                  {card.topicEn}
                </span>
              )}
            </p>
            {card.keywordDisplay.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {card.keywordDisplay.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600"
                  >
                    #{keyword}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={`/skeleton-cards/${card.id}`}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
              >
                {card.isStub ? "補完" : "編輯"}
              </Link>
              <button
                type="button"
                onClick={() => void bumpHeat(card.id, 1)}
                disabled={card.heat >= 3}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
              >
                +1 熱度
              </button>
              <button
                type="button"
                onClick={() => void bumpHeat(card.id, -1)}
                disabled={card.heat <= 0}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
              >
                −1 熱度
              </button>
              <button
                type="button"
                onClick={() => setDeleteTargetId(card.id)}
                className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                刪除
              </button>
            </div>
          </li>
        ))}
      </ul>

      {visibleCards.length === 0 && !error && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有骨架卡。
        </p>
      )}
    </div>
  );
}
