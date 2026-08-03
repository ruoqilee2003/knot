"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  parseKeywordInput,
  sanitizeKeyword,
} from "@/lib/keywords";
import {
  SKELETON_SUBJECTS,
  type SkeletonBlock,
} from "@/lib/skeleton-cards";
import { PRESET_SUBJECTS, normalizeSubject } from "@/lib/subjects";
import {
  deriveKeywordFromTopic,
  parseBatchSkeletonSpec,
} from "@/lib/skeleton-batch-spec";

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
  definition: string;
  blocks: SkeletonBlock[];
  conclusion: string;
  prompts: string[];
};

type ArchaeologyQuestion = {
  id: string;
  questionText: string;
  year: number;
  keywordDisplay: string[];
  isArchaeology: boolean;
};

type Duplicate = { id: string; topic: string; matchedKeywords: string[] };

type BatchMode = "simple" | "advanced";

type BatchRow = {
  topicZh: string;
  topicEn: string;
  keyword: string;
  aspectsText: string;
  wordCountText: string;
};

const SIMPLE_DEFAULT_WORD_COUNT = "200";
const ADVANCED_DEFAULT_WORD_COUNT = "400";

function emptyBatchRow(wordCountText: string): BatchRow {
  return { topicZh: "", topicEn: "", keyword: "", aspectsText: "", wordCountText };
}

// 記住列表捲動位置與已載入頁數，讓從編輯頁返回時能停在原本點擊的地方
const LIST_STATE_STORAGE_KEY = "knot:skeleton-cards-list-state";

type StoredListState = {
  subjectFilter: string;
  search: string;
  offset: number;
  scrollY: number;
};

function readStoredListState(): StoredListState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LIST_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredListState>;
    if (
      typeof parsed.subjectFilter !== "string" ||
      typeof parsed.search !== "string" ||
      typeof parsed.offset !== "number" ||
      typeof parsed.scrollY !== "number"
    ) {
      return null;
    }
    return parsed as StoredListState;
  } catch {
    return null;
  }
}

function writeStoredListState(state: StoredListState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LIST_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 私密瀏覽模式等 sessionStorage 不可用時直接放棄記錄
  }
}

export default function SkeletonCardsPage() {
  const [restoredState] = useState<StoredListState | null>(() =>
    readStoredListState()
  );
  const restoreAppliedRef = useRef(false);
  const scrollRestoredRef = useRef(false);

  const [cards, setCards] = useState<SkeletonCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState(
    restoredState?.subjectFilter ?? "all"
  );
  const [searchText, setSearchText] = useState(restoredState?.search ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(
    restoredState?.search ?? ""
  );
  const [total, setTotal] = useState(0);
  const [stubTotal, setStubTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const PAGE_SIZE = 10;
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formSubject, setFormSubject] = useState("");
  const [formTopic, setFormTopic] = useState("");
  const [formTopicEn, setFormTopicEn] = useState("");
  const [formKeywordInput, setFormKeywordInput] = useState("");
  const [formKeywords, setFormKeywords] = useState<string[]>([]);
  const [keywordOptions, setKeywordOptions] = useState<string[]>([]);
  const [archQuestions, setArchQuestions] = useState<ArchaeologyQuestion[]>([]);
  const [selectedArchIds, setSelectedArchIds] = useState<Set<string>>(new Set());
  const [formBusy, setFormBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [selectingForExport, setSelectingForExport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportingAll, setExportingAll] = useState(false);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<BatchMode>("simple");
  const [batchSubject, setBatchSubject] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([
    emptyBatchRow(SIMPLE_DEFAULT_WORD_COUNT),
  ]);
  const [batchPasteOpen, setBatchPasteOpen] = useState(false);
  const [batchPasteText, setBatchPasteText] = useState("");
  const [batchPasteErrors, setBatchPasteErrors] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<
    Array<{
      index: number;
      topic: string;
      success: boolean;
      id?: string;
      isStub?: boolean;
      error?: string;
    }>
  >([]);
  const [batchKeywordOptions, setBatchKeywordOptions] = useState<string[]>([]);
  const [batchExistingCards, setBatchExistingCards] = useState<
    Array<{ id: string; topic: string; keywords: string[] }>
  >([]);

  const parseCards = (data: Array<Record<string, unknown>>): SkeletonCard[] =>
    data.map((x) => ({
      id: String(x.id ?? ""),
      subject: normalizeSubject(String(x.subject ?? "")),
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
      definition: String(x.definition ?? ""),
      blocks: Array.isArray(x.blocks) ? (x.blocks as SkeletonBlock[]) : [],
      conclusion: String(x.conclusion ?? ""),
      prompts: Array.isArray(x.prompts)
        ? (x.prompts as unknown[]).filter(
            (item): item is string => typeof item === "string"
          )
        : [],
    }));

  const load = useCallback(
    async (options?: { append?: boolean; limit?: number }) => {
      const append = options?.append ?? false;
      setError(null);
      if (append) setLoadingMore(true);
      const nextOffset = append ? offsetRef.current : 0;
      const requestLimit = options?.limit ?? PAGE_SIZE;
      try {
        const params = new URLSearchParams();
        if (subjectFilter !== "all") params.set("subject", subjectFilter);
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
        params.set("limit", String(requestLimit));
        params.set("offset", String(nextOffset));
        const response = await fetch(`/api/skeleton-cards?${params.toString()}`, {
          method: "GET",
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "讀取骨架卡失敗");
        }
        const payload = (await response.json()) as {
          items: Array<Record<string, unknown>>;
          total: number;
          stubTotal: number;
        };
        const list = parseCards(payload.items);
        setCards((prev) => (append ? [...prev, ...list] : list));
        setTotal(payload.total);
        setStubTotal(payload.stubTotal);
        offsetRef.current = nextOffset + list.length;
        writeStoredListState({
          subjectFilter,
          search: debouncedSearch,
          offset: offsetRef.current,
          scrollY: typeof window !== "undefined" ? window.scrollY : 0,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "讀取骨架卡失敗");
        if (!append) setCards([]);
      } finally {
        setLoadingMore(false);
      }
    },
    [subjectFilter, debouncedSearch]
  );

  useEffect(() => {
    // 只有第一次載入且有還原狀態時，才一次撈回原本已載入的頁數，之後（篩選條件變更）一律照常從第一頁開始
    const shouldRestore = !restoreAppliedRef.current && restoredState;
    restoreAppliedRef.current = true;
    void load(
      shouldRestore
        ? { limit: Math.max(PAGE_SIZE, restoredState!.offset) }
        : undefined
    );
  }, [load, restoredState]);

  // 資料回來且尚未還原過捲動位置時，捲回上次點擊的地方；沒有存檔就照舊捲回頂端
  // （編輯頁的返回連結關掉了 Next.js 預設的自動捲頂，避免它在我們還原完之後又蓋回頂端）
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    if (cards.length === 0) return;
    scrollRestoredRef.current = true;
    const targetY = restoredState?.scrollY ?? 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: targetY, behavior: "auto" });
    });
  }, [cards, restoredState]);

  // 持續記錄捲動位置，離開頁面（例如點進編輯頁）後才能回到原本位置
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;
    const handleScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        writeStoredListState({
          subjectFilter,
          search: debouncedSearch,
          offset: offsetRef.current,
          scrollY: window.scrollY,
        });
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [subjectFilter, debouncedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const loadMore = useCallback(() => {
    void load({ append: true });
  }, [load]);

  // 表單開著且選了科目時，載入該科目題目供連結（不限考古標記）
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
  }, [formOpen, formSubject]);

  // 表單關鍵字跟題目有交集時自動勾選
  const formKeywordsForMatch = useMemo(
    () =>
      dedupeKeywordsCaseInsensitive([
        ...formKeywords,
        ...parseKeywordInput(formKeywordInput),
      ]),
    [formKeywords, formKeywordInput]
  );

  const matchedArchQuestionIds = useMemo(() => {
    const cardKeywords = new Set(
      formKeywordsForMatch.map((k) => k.toLowerCase())
    );
    if (cardKeywords.size === 0) return new Set<string>();
    return new Set(
      archQuestions
        .filter((q) =>
          q.keywordDisplay.some((k) => cardKeywords.has(k.toLowerCase()))
        )
        .map((q) => q.id)
    );
  }, [archQuestions, formKeywordsForMatch]);

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
    setSelectedArchIds((prev) => {
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

  const subjects = PRESET_SUBJECTS;

  // 篩選、排序改由 /api/skeleton-cards 依 subject/search/heat 處理
  const visibleCards = cards;

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
        setFormSubject("");
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

  const updateBatchRow = useCallback(
    (idx: number, patch: Partial<BatchRow>) => {
      setBatchRows((prev) =>
        prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
      );
    },
    []
  );

  const addBatchRow = useCallback(() => {
    setBatchRows((prev) => [
      ...prev,
      emptyBatchRow(
        batchMode === "simple" ? SIMPLE_DEFAULT_WORD_COUNT : ADVANCED_DEFAULT_WORD_COUNT
      ),
    ]);
  }, [batchMode]);

  const removeBatchRow = useCallback((idx: number) => {
    setBatchRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }, []);

  const switchBatchMode = useCallback((mode: BatchMode) => {
    setBatchMode(mode);
    setBatchRows([
      emptyBatchRow(mode === "simple" ? SIMPLE_DEFAULT_WORD_COUNT : ADVANCED_DEFAULT_WORD_COUNT),
    ]);
    setBatchResults([]);
  }, []);

  const applyBatchPasteText = useCallback(() => {
    const { spec, errors } = parseBatchSkeletonSpec(batchPasteText);
    setBatchPasteErrors(errors);
    if (!spec) return;
    setBatchMode("advanced");
    setBatchSubject(spec.subject);
    setBatchRows(
      spec.items.map((item) => ({
        topicZh: item.topicZh,
        topicEn: item.topicEn,
        keyword: item.keyword,
        aspectsText: item.aspects.join("，"),
        wordCountText:
          item.wordCount != null ? String(item.wordCount) : ADVANCED_DEFAULT_WORD_COUNT,
      }))
    );
    setBatchPasteOpen(false);
  }, [batchPasteText]);

  const validBatchRows = useMemo(
    () =>
      batchRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) =>
          batchMode === "advanced"
            ? row.topicZh.trim() && row.aspectsText.trim()
            : row.topicZh.trim()
        ),
    [batchRows, batchMode]
  );

  // 批量面板開啟時抓一份既有關鍵字，供逐列比對是否已有人用過同樣拼寫
  useEffect(() => {
    if (!batchOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/keywords?limit=200`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<{ keyword?: string }>;
        if (cancelled) return;
        setBatchKeywordOptions(
          dedupeKeywordsCaseInsensitive(
            data
              .map((item) => sanitizeKeyword(String(item.keyword ?? "")))
              .filter(Boolean)
          )
        );
      } catch {
        if (!cancelled) setBatchKeywordOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchOpen]);

  // 選定科目後抓該科既有骨架卡的關鍵字，逐列比對是否可能已有類似骨架卡
  useEffect(() => {
    if (!batchOpen || !batchSubject.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBatchExistingCards([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ subject: batchSubject.trim() });
        const response = await fetch(`/api/skeleton-cards?${params.toString()}`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<Record<string, unknown>>;
        if (cancelled) return;
        setBatchExistingCards(
          data.map((item) => ({
            id: String(item.id ?? ""),
            topic: String(item.topic ?? ""),
            keywords: Array.isArray(item.keywords)
              ? (item.keywords as unknown[]).filter(
                  (k): k is string => typeof k === "string"
                )
              : [],
          }))
        );
      } catch {
        if (!cancelled) setBatchExistingCards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchOpen, batchSubject]);

  // 逐列算出：關鍵字是否已存在、是否有科目關鍵字有交集的既有骨架卡
  const batchRowHints = useMemo(
    () =>
      batchRows.map((row) => {
        const keyword =
          sanitizeKeyword(row.keyword) ||
          deriveKeywordFromTopic(row.topicEn, row.topicZh);
        if (!keyword) {
          return { keyword: "", existingKeywordMatch: null as string | null, similarCards: [] as Array<{ id: string; topic: string }> };
        }
        const normalized = normalizeKeyword(keyword);
        const existingKeywordMatch =
          batchKeywordOptions.find((k) => normalizeKeyword(k) === normalized) ??
          null;
        const similarCards = batchExistingCards
          .filter((card) =>
            card.keywords.some((k) => normalizeKeyword(k) === normalized)
          )
          .map((card) => ({ id: card.id, topic: card.topic }));
        return { keyword, existingKeywordMatch, similarCards };
      }),
    [batchRows, batchKeywordOptions, batchExistingCards]
  );

  const runBatchGenerate = useCallback(async () => {
    if (!batchSubject.trim() || validBatchRows.length === 0) {
      setError("請選擇科目，並至少填寫一列完整的主題／關鍵字／內容重點");
      return;
    }
    setBatchBusy(true);
    setError(null);
    setBatchResults([]);
    try {
      const response = await fetch("/api/skeleton-cards/batch-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: batchSubject,
          items: validBatchRows.map(({ row }) => ({
            topicZh: row.topicZh.trim(),
            topicEn: row.topicEn.trim(),
            keyword: row.keyword.trim(),
            aspects: row.aspectsText
              .split(/[，,、]/)
              .map((s) => s.trim())
              .filter(Boolean),
            wordCount: row.wordCountText.trim()
              ? Number(row.wordCountText.trim())
              : Number(
                  batchMode === "simple"
                    ? SIMPLE_DEFAULT_WORD_COUNT
                    : ADVANCED_DEFAULT_WORD_COUNT
                ),
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            results?: Array<{
              index: number;
              topic: string;
              success: boolean;
              id?: string;
              isStub?: boolean;
              error?: string;
            }>;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "批量生成失敗");
      }
      setBatchResults(payload?.results ?? []);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量生成失敗");
    } finally {
      setBatchBusy(false);
    }
  }, [batchSubject, validBatchRows, batchMode, load]);

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
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      offsetRef.current = Math.max(0, offsetRef.current - 1);
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除骨架卡失敗");
    } finally {
      setDeleting(false);
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const allVisibleSelected =
    visibleCards.length > 0 &&
    visibleCards.every((card) => selectedIds.includes(card.id));

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const visibleIds = visibleCards.map((card) => card.id);
      if (visibleIds.every((id) => prev.includes(id))) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  }, [visibleCards]);

  const startSelectingForExport = useCallback(() => {
    setSelectingForExport(true);
    setSelectedIds([]);
  }, []);

  const cancelSelectingForExport = useCallback(() => {
    setSelectingForExport(false);
    setSelectedIds([]);
  }, []);

  const exportMarkdown = useCallback(async () => {
    if (selectingForExport && selectedIds.length === 0) {
      setError("請先選取要匯出的骨架卡");
      return;
    }
    let exportCards: SkeletonCard[];
    if (selectingForExport && selectedIds.length > 0) {
      exportCards = visibleCards.filter((card) => selectedIds.includes(card.id));
    } else {
      setExportingAll(true);
      try {
        const params = new URLSearchParams();
        if (subjectFilter !== "all") params.set("subject", subjectFilter);
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
        const response = await fetch(`/api/skeleton-cards?${params.toString()}`);
        const data = (await response.json().catch(() => [])) as Array<
          Record<string, unknown>
        >;
        if (!response.ok) throw new Error("讀取骨架卡失敗");
        exportCards = parseCards(data);
      } catch {
        setError("匯出失敗，請稍後再試");
        setExportingAll(false);
        return;
      }
      setExportingAll(false);
    }
    if (exportCards.length === 0) {
      setError("目前沒有可匯出的骨架卡");
      return;
    }
    const heading =
      subjectFilter === "all" ? "# 骨架卡" : `# 骨架卡（${subjectFilter}）`;
    const body = exportCards
      .map((card, idx) => {
        const blocksMd =
          card.blocks.length === 0
            ? "（尚無分類）"
            : card.blocks
                .map((block) => {
                  const points =
                    block.points.length === 0
                      ? "  - （尚未展開）"
                      : block.points
                          .map((point) => {
                            const key = point.key.trim();
                            const hint = (point.hint ?? "").trim();
                            if (key && hint) return `  - **${key}**：${hint}`;
                            if (key) return `  - **${key}**`;
                            return `  - → ${hint}`;
                          })
                          .join("\n");
                  return `### ${block.label}${
                    block.note ? `（${block.note}）` : ""
                  }（${block.count}）\n\n${points}`;
                })
                .join("\n\n");
        const promptsMd =
          card.prompts.length > 0
            ? card.prompts.map((p) => `- ${p}`).join("\n")
            : "（無）";
        return [
          `## ${idx + 1}. ${card.topic}${card.topicEn ? ` / ${card.topicEn}` : ""}`,
          "",
          `> 考科：${card.subject}${card.isStub ? "・卡樁" : "・完整"}`,
          card.keywordDisplay.length > 0
            ? `> 關鍵字：${card.keywordDisplay.map((k) => `#${k}`).join(" ")}`
            : null,
          "",
          "### ① 定義",
          "",
          card.definition || "（尚未填寫）",
          "",
          "### ② 分類架構與逐點展開",
          "",
          blocksMd,
          "",
          "### ③ 結論／實務",
          "",
          card.conclusion || "（尚未填寫）",
          "",
          "### 問法",
          "",
          promptsMd,
          "",
        ]
          .filter((line) => line !== null)
          .join("\n");
      })
      .join("\n---\n\n");
    const markdown = `${heading}\n\n${body}`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `knot-skeleton-cards-${now}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (selectingForExport) {
      setSelectingForExport(false);
      setSelectedIds([]);
    }
  }, [
    visibleCards,
    subjectFilter,
    debouncedSearch,
    selectingForExport,
    selectedIds,
  ]);

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
        <label className="text-sm text-stone-700">
          搜尋內容
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜尋主題／定義／關鍵字"
            className="ml-2 w-44 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        {!selectingForExport ? (
          <>
            <button
              type="button"
              onClick={startSelectingForExport}
              disabled={visibleCards.length === 0}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              選取匯出
            </button>
            <button
              type="button"
              onClick={() => void exportMarkdown()}
              disabled={visibleCards.length === 0 || exportingAll}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {exportingAll ? "匯出中…" : "匯出目前列表"}
            </button>
          </>
        ) : (
          <>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 rounded border-stone-300 accent-stone-700"
              />
              全選目前列表
            </label>
            <button
              type="button"
              onClick={() => void exportMarkdown()}
              disabled={selectedIds.length === 0}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                selectedIds.length > 0
                  ? "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                  : "border-stone-200 bg-stone-100 text-stone-500"
              }`}
            >
              {selectedIds.length > 0
                ? `匯出已選取（${selectedIds.length}）`
                : "請先選取骨架卡"}
            </button>
            <button
              type="button"
              onClick={cancelSelectingForExport}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
            >
              取消選取
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setFormOpen((prev) => !prev)}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-40"
        >
          {formOpen ? "取消新增" : "+ 新增骨架卡"}
        </button>
        <button
          type="button"
          onClick={() => setBatchOpen((prev) => !prev)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          {batchOpen ? "取消批量生成" : "批量生成骨架卡"}
        </button>
      </div>

      {batchOpen && (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-[#fffdf8] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-stone-700">批量半自動新增</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-stone-500">
                {batchMode === "simple"
                  ? "只需要中文主題／英文主題／關鍵字／目標字數，系統會用 Claude 自行規劃完整的定義／分類架構／結論並直接建立骨架卡。"
                  : "選科目、逐列填主題／關鍵字／內容重點與目標字數，系統會用 Claude 依內容重點自動生成定義／分類架構／結論並直接建立骨架卡。"}
                建立後可再進編輯頁微調。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBatchPasteOpen((prev) => !prev)}
              className="rounded-lg border border-dashed border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              {batchPasteOpen ? "關閉快速貼上" : "從文字快速貼上"}
            </button>
          </div>

          <div className="mt-3 inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => switchBatchMode("simple")}
              className={`rounded-md px-3 py-1.5 transition ${
                batchMode === "simple"
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-50"
              }`}
            >
              簡易批量生成
            </button>
            <button
              type="button"
              onClick={() => switchBatchMode("advanced")}
              className={`rounded-md px-3 py-1.5 transition ${
                batchMode === "advanced"
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-50"
              }`}
            >
              進階批量生成（指定內容重點）
            </button>
          </div>

          {batchPasteOpen && (
            <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-xs text-stone-500">
                第一行「科目：科目名稱」，接著逐行「中文主題，英文主題，關鍵字（內容重點...，字數）」，貼上後按「套用」會覆蓋下方欄位。
              </p>
              <textarea
                value={batchPasteText}
                onChange={(e) => setBatchPasteText(e.target.value)}
                rows={5}
                placeholder={
                  "科目：作業系統\n1. 特權指令，Privileged Instruction，Privileged-Instruction（定義，目的，七種分類 配套，400字）\n2. 雙模式運算，Dual Mode Operation，Dual-Mode-Operation（定義，目的，運作，優缺，400字）"
                }
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-xs text-stone-900 outline-none ring-stone-400 focus:ring-2"
              />
              {batchPasteErrors.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {batchPasteErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={applyBatchPasteText}
                  disabled={!batchPasteText.trim()}
                  className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  套用到下方欄位
                </button>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label className="text-sm font-medium text-stone-700">科目</label>
            <select
              value={batchSubject}
              onChange={(e) => setBatchSubject(e.target.value)}
              className="mt-1 w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2 sm:w-auto"
            >
              <option value="" disabled>
                請選擇
              </option>
              {SKELETON_SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 space-y-2">
            {batchRows.map((row, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-stone-200 bg-white p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-500">
                    第 {idx + 1} 張
                  </span>
                  <button
                    type="button"
                    onClick={() => removeBatchRow(idx)}
                    disabled={batchRows.length <= 1}
                    className="text-xs text-red-600 hover:underline disabled:opacity-30 disabled:no-underline"
                  >
                    移除這列
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_100px]">
                  <div>
                    <label className="text-xs text-stone-500">中文主題</label>
                    <input
                      value={row.topicZh}
                      onChange={(e) =>
                        updateBatchRow(idx, { topicZh: e.target.value })
                      }
                      placeholder="例如：特權指令"
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500">英文主題</label>
                    <input
                      value={row.topicEn}
                      onChange={(e) =>
                        updateBatchRow(idx, { topicEn: e.target.value })
                      }
                      placeholder="例如：Privileged Instruction"
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500">
                      關鍵字
                      <span className="ml-1 font-normal text-stone-400">
                        （留空自動衍生）
                      </span>
                    </label>
                    <input
                      value={row.keyword}
                      onChange={(e) =>
                        updateBatchRow(idx, { keyword: e.target.value })
                      }
                      placeholder={
                        deriveKeywordFromTopic(row.topicEn, row.topicZh) ||
                        "例如：Privileged-Instruction"
                      }
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                    />
                    {batchRowHints[idx]?.existingKeywordMatch && (
                      <p className="mt-1 text-xs text-sky-600">
                        已有關鍵字「{batchRowHints[idx].existingKeywordMatch}」，建議沿用相同拼寫
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-stone-500">目標字數</label>
                    <input
                      type="number"
                      min={0}
                      value={row.wordCountText}
                      onChange={(e) =>
                        updateBatchRow(idx, { wordCountText: e.target.value })
                      }
                      placeholder={
                        batchMode === "simple"
                          ? SIMPLE_DEFAULT_WORD_COUNT
                          : ADVANCED_DEFAULT_WORD_COUNT
                      }
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                    />
                  </div>
                </div>
                {batchMode === "advanced" && (
                  <div className="mt-2">
                    <label className="text-xs text-stone-500">
                      內容重點（逗號分隔）
                    </label>
                    <input
                      value={row.aspectsText}
                      onChange={(e) =>
                        updateBatchRow(idx, { aspectsText: e.target.value })
                      }
                      placeholder="例如：定義，目的，七種分類 配套"
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                    />
                  </div>
                )}
                {batchRowHints[idx] && batchRowHints[idx].similarCards.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    可能已存在類似骨架卡（同科目關鍵字有交集）：
                    {batchRowHints[idx].similarCards.map((c) => (
                      <Link
                        key={c.id}
                        href={`/skeleton-cards/${c.id}`}
                        target="_blank"
                        className="ml-1 underline hover:no-underline"
                      >
                        《{c.topic || "未命名"}》
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={addBatchRow}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
            >
              + 新增一列
            </button>
            <button
              type="button"
              onClick={() => void runBatchGenerate()}
              disabled={batchBusy || !batchSubject.trim() || validBatchRows.length === 0}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {batchBusy
                ? "生成中，請稍候…"
                : `開始生成並建立（${validBatchRows.length} 張）`}
            </button>
          </div>

          {batchResults.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {batchResults.map((r) => (
                <li
                  key={r.index}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    r.success
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-red-200 bg-red-50 text-red-900"
                  }`}
                >
                  {r.success ? (
                    <>
                      ✓ {r.topic}
                      {r.isStub ? "（卡樁）" : "（完整）"} 已建立
                      {r.id && (
                        <Link
                          href={`/skeleton-cards/${r.id}`}
                          className="ml-2 underline"
                        >
                          前往編輯
                        </Link>
                      )}
                    </>
                  ) : (
                    <>✗ {r.topic}：{r.error}</>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
                <option value="" disabled>
                  請選擇
                </option>
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

          {formSubject.trim() && linkableQuestions.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-stone-700">
                連結題目／問法（選填，佐證用）
              </p>
              <p className="mt-0.5 text-xs text-stone-500">
                關鍵字相符的題目會自動勾選；標記為考古的題目也可手動勾選。
              </p>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
                {linkableQuestions.map((q) => (
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

      {subjectFilter !== "all" && total > 0 && (
        <p className="mt-4 text-xs text-stone-500">
          {subjectFilter}：共 {total} 張（{stubTotal} 張待補完）
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {visibleCards.map((card) => {
          const selected = selectedIds.includes(card.id);
          return (
          <li
            key={card.id}
            className={`rounded-2xl border bg-[#fffdf8] p-4 shadow-sm ${
              selectingForExport && selected
                ? "border-stone-400 ring-2 ring-stone-300"
                : "border-stone-200"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {selectingForExport && (
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSelect(card.id)}
                  className="h-4 w-4 rounded border-stone-300 accent-stone-700"
                  aria-label={`選取骨架卡：${card.topic}`}
                />
              )}
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
          );
        })}
      </ul>

      {visibleCards.length === 0 && !error && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有骨架卡。
        </p>
      )}

      {!error && visibleCards.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs text-stone-500">
            已顯示 {visibleCards.length} / {total} 筆
          </p>
          {visibleCards.length < total && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {loadingMore ? "載入中…" : "載入更多"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
