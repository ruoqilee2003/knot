"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AddQuestionModal } from "@/components/AddQuestionModal";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { EditQuestionModal } from "@/components/EditQuestionModal";
import {
  bindHallScrollListener,
  getHallScrollTop,
  readHallScrollState,
  restoreHallScrollTop,
  saveHallScrollState,
  type HallScrollState,
} from "@/lib/hall-scroll-restore";
import { PRESET_SUBJECTS } from "@/lib/subjects";

type Row = {
  id: string;
  subject: string;
  year: number;
  score: number;
  questionText: string;
  imageUrl: string | null;
  isArchaeology: boolean;
  latestAttemptStatus:
    | "draft"
    | "completed"
    | "analyzed"
    | "analyze_failed"
    | "flashcards_ready"
    | null;
  latestKeywords: string[];
  latestKeywordDisplay: string[];
  createdAt: unknown;
};

function HallPageContent() {
  const searchParams = useSearchParams();
  const keywordParam = searchParams.get("keyword") ?? "";
  const savedHallStateRef = useRef(readHallScrollState());

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Row | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState(
    () => savedHallStateRef.current?.subjectFilter ?? "all"
  );
  const [keywordFilter, setKeywordFilter] = useState(
    () => keywordParam || savedHallStateRef.current?.keywordFilter || ""
  );
  const [archaeologyFilter, setArchaeologyFilter] = useState<"all" | "archaeology">(
    () => savedHallStateRef.current?.archaeologyFilter ?? "all"
  );
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const PAGE_SIZE = 10;
  const restoredScrollRef = useRef(false);

  // 從其他頁（例如統計儀表板的關鍵字）帶著 ?keyword= 連過來時同步篩選條件
  useEffect(() => {
    if (keywordParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKeywordFilter(keywordParam);
    }
  }, [keywordParam]);
  const [sortMode, setSortMode] = useState<
    "year-desc" | "year-asc" | "unfinished-first"
  >(() => savedHallStateRef.current?.sortMode ?? "unfinished-first");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectingForExport, setSelectingForExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState<{
    activeCount: number;
    archivedCount: number;
  } | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [deleteArchivedDialogOpen, setDeleteArchivedDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const loadArchiveStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/archive", { method: "GET" });
      const payload = (await response.json().catch(() => null)) as
        | { activeCount?: number; archivedCount?: number; error?: string }
        | null;
      if (!response.ok) return;
      setArchiveStatus({
        activeCount: Number(payload?.activeCount ?? 0),
        archivedCount: Number(payload?.archivedCount ?? 0),
      });
    } catch {
      // ignore
    }
  }, []);

  const parseRows = (data: Array<Record<string, unknown>>): Row[] =>
    data.map((d) => ({
      id: String(d.id ?? ""),
      subject: String(d.subject ?? ""),
      year: Number(d.year ?? 0),
      score: Number(d.score ?? 100),
      questionText: String(d.questionText ?? d.title ?? ""),
      imageUrl: d.imageUrl ? String(d.imageUrl) : null,
      isArchaeology: d.isArchaeology === true,
      latestAttemptStatus:
        typeof d.latestAttemptStatus === "string"
          ? (d.latestAttemptStatus as Row["latestAttemptStatus"])
          : null,
      latestKeywords: Array.isArray(d.latestKeywords)
        ? d.latestKeywords
            .map((item) => String(item).trim().toLowerCase())
            .filter(Boolean)
        : [],
      latestKeywordDisplay: Array.isArray(d.latestKeywordDisplay)
        ? d.latestKeywordDisplay
            .map((item) => String(item).trim())
            .filter(Boolean)
        : [],
      createdAt: d.createdAt ?? null,
    }));

  const load = useCallback(
    async (options?: { append?: boolean }) => {
      const append = options?.append ?? false;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setLoadError(null);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      const nextOffset = append ? offsetRef.current : 0;
      try {
        const params = new URLSearchParams();
        if (subjectFilter !== "all") {
          params.set("subject", subjectFilter);
        }
        if (keywordFilter.trim()) {
          params.set("keyword", keywordFilter.trim());
        }
        if (archaeologyFilter === "archaeology") {
          params.set("archaeology", "1");
        }
        if (debouncedSearch.trim()) {
          params.set("search", debouncedSearch.trim());
        }
        params.set("sort", sortMode);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(nextOffset));
        const response = await fetch(`/api/questions?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "無法讀取題庫");
        }
        const payload = (await response.json()) as {
          items: Array<Record<string, unknown>>;
          total: number;
        };
        const next = parseRows(payload.items);
        setRows((prev) => (append ? [...prev, ...next] : next));
        setTotal(payload.total);
        offsetRef.current = nextOffset + next.length;
        if (!append) {
          setSelectedIds([]);
          setSelectingForExport(false);
        }
        setLoading(false);
        setLoadingMore(false);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setLoadError(e instanceof Error ? e.message : "無法讀取題庫");
        if (!append) setRows([]);
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [subjectFilter, keywordFilter, archaeologyFilter, debouncedSearch, sortMode]
  );

  const loadMore = useCallback(() => {
    void load({ append: true });
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const runArchiveAction = useCallback(
    async (action: "archiveAll" | "restoreAll" | "deleteAllArchived") => {
      setArchiving(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.error || "封存操作失敗");
        }
        setArchiveDialogOpen(false);
        setRestoreDialogOpen(false);
        setDeleteArchivedDialogOpen(false);
        await Promise.all([load(), loadArchiveStatus()]);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "封存操作失敗");
      } finally {
        setArchiving(false);
      }
    },
    [load, loadArchiveStatus]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadArchiveStatus();
  }, [loadArchiveStatus]);

  const persistHallScroll = useCallback(() => {
    const nextState: HallScrollState = {
      scrollTop: getHallScrollTop(),
      subjectFilter,
      keywordFilter,
      sortMode,
      archaeologyFilter,
    };
    saveHallScrollState(nextState);
  }, [subjectFilter, keywordFilter, sortMode, archaeologyFilter]);

  // 在大廳捲動或調整篩選時記住位置，從作答頁返回時可還原
  useEffect(() => bindHallScrollListener(persistHallScroll), [persistHallScroll]);

  useEffect(() => {
    persistHallScroll();
  }, [persistHallScroll]);

  const subjects = PRESET_SUBJECTS;

  // 排序改由 /api/questions 依 sortMode 處理，這裡直接使用伺服器回傳順序
  const visibleRows = rows;

  useEffect(() => {
    if (loading || restoredScrollRef.current) return;
    const scrollTop = savedHallStateRef.current?.scrollTop ?? 0;
    if (scrollTop <= 0) {
      restoredScrollRef.current = true;
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreHallScrollTop(scrollTop);
        restoredScrollRef.current = true;
      });
    });
  }, [loading, visibleRows.length]);

  const completedVisibleRows = useMemo(() => {
    return visibleRows.filter(
      (row) =>
        row.latestAttemptStatus === "completed" ||
        row.latestAttemptStatus === "analyzed" ||
        row.latestAttemptStatus === "flashcards_ready"
    );
  }, [visibleRows]);

  const deleteQuestion = useCallback(
    async (id: string) => {
      setDeleting(true);
      try {
        const response = await fetch(`/api/questions/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "刪除題目失敗");
        }
        setRows((prev) => prev.filter((row) => row.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
        offsetRef.current = Math.max(0, offsetRef.current - 1);
        setDeleteTargetId(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "刪除題目失敗");
      } finally {
        setDeleting(false);
      }
    },
    []
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const allCompletedSelected =
    completedVisibleRows.length > 0 &&
    completedVisibleRows.every((row) => selectedIds.includes(row.id));

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const completedIds = completedVisibleRows.map((row) => row.id);
      if (completedIds.every((id) => prev.includes(id))) {
        return prev.filter((id) => !completedIds.includes(id));
      }
      return Array.from(new Set([...prev, ...completedIds]));
    });
  }, [completedVisibleRows]);

  const exportSelected = useCallback(async () => {
    if (selectingForExport && selectedIds.length === 0) {
      setLoadError("請先選取要匯出的題目");
      return;
    }
    const exportIds =
      selectedIds.length > 0
        ? selectedIds
        : completedVisibleRows.map((row) => row.id);
    if (exportIds.length === 0) {
      setLoadError("目前沒有可匯出的題目");
      return;
    }

    setExporting(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/export/questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          questionIds: exportIds,
          subject: subjectFilter === "all" ? undefined : subjectFilter,
          keyword: keywordFilter.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; records?: Array<{ question: string; answer: string }> }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "匯出失敗");
      }
      const records = Array.isArray(payload?.records) ? payload.records : [];
      const markdown = records
        .map((record, idx) => {
          const question = String(record.question ?? "").trim();
          const answer = String(record.answer ?? "").trim();
          return [
            `# 題目 ${idx + 1}`,
            "",
            "## 題目",
            question || "（無題目內容）",
            "",
            "## 作答",
            answer || "（無作答內容）",
            "",
          ].join("\n");
        })
        .join("\n---\n\n");

      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `knot-export-${now}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setExporting(false);
    }
  }, [
    selectingForExport,
    selectedIds,
    completedVisibleRows,
    subjectFilter,
    keywordFilter,
  ]);

  const startSelectingForExport = useCallback(() => {
    setSelectingForExport(true);
    setSelectedIds([]);
  }, []);

  const cancelSelectingForExport = useCallback(() => {
    setSelectingForExport(false);
    setSelectedIds([]);
  }, []);

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <header className="relative z-20 isolate flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">練習大廳</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
            題目列表
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            選擇一題開始作答。可輸入文字或上傳手寫稿，先儲存草稿再正式送出 AI 批改。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {archiveStatus && archiveStatus.archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setRestoreDialogOpen(true)}
              disabled={archiving}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              還原封存（{archiveStatus.archivedCount}）
            </button>
          )}
          {archiveStatus && archiveStatus.archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setDeleteArchivedDialogOpen(true)}
              disabled={archiving}
              className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              刪除所有封存（{archiveStatus.archivedCount}）
            </button>
          )}
          {archiveStatus && archiveStatus.activeCount > 0 && (
            <button
              type="button"
              onClick={() => setArchiveDialogOpen(true)}
              disabled={archiving}
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              封存目前題庫
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="relative z-20 cursor-pointer rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800"
          >
            新增題目
          </button>
        </div>
      </header>

      <AddQuestionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void load()}
      />
      <EditQuestionModal
        key={editTarget?.id ?? "edit-none"}
        open={Boolean(editTarget)}
        question={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => void load()}
        onDelete={(id) => setDeleteTargetId(id)}
      />
      <ConfirmDeleteDialog
        open={Boolean(deleteTargetId)}
        title="刪除題目"
        description="此動作無法復原，確定要刪除這題嗎？"
        confirmLabel="確認刪除"
        busy={deleting}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (!deleteTargetId || deleting) return;
          void deleteQuestion(deleteTargetId);
        }}
      />
      <ConfirmDeleteDialog
        open={archiveDialogOpen}
        title="封存目前題庫"
        description={`將隱藏目前 ${archiveStatus?.activeCount ?? 0} 題及其字卡、批改、筆記（資料不會刪除）。封存後可從空白題庫開始練習其他科目，日後可一鍵還原。`}
        confirmLabel={archiving ? "封存中…" : "確認封存"}
        busy={archiving}
        onCancel={() => setArchiveDialogOpen(false)}
        onConfirm={() => {
          if (archiving) return;
          void runArchiveAction("archiveAll");
        }}
      />
      <ConfirmDeleteDialog
        open={restoreDialogOpen}
        title="還原封存題庫"
        description={`將還原 ${archiveStatus?.archivedCount ?? 0} 題封存資料，與目前題目一併顯示。`}
        confirmLabel={archiving ? "還原中…" : "確認還原"}
        busy={archiving}
        onCancel={() => setRestoreDialogOpen(false)}
        onConfirm={() => {
          if (archiving) return;
          void runArchiveAction("restoreAll");
        }}
      />
      <ConfirmDeleteDialog
        open={deleteArchivedDialogOpen}
        title="刪除所有封存題目"
        description={`此動作無法復原，將永久刪除 ${archiveStatus?.archivedCount ?? 0} 題封存題目，以及對應的作答紀錄、字卡、批改與筆記。`}
        confirmLabel={archiving ? "刪除中…" : "確認永久刪除"}
        busy={archiving}
        onCancel={() => setDeleteArchivedDialogOpen(false)}
        onConfirm={() => {
          if (archiving) return;
          void runArchiveAction("deleteAllArchived");
        }}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
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

        <label className="text-sm text-stone-700">
          搜尋內容
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜尋題目文字"
            className="ml-2 w-40 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          />
        </label>

        <label className="text-sm text-stone-700">
          關鍵字
          <input
            type="text"
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void load();
              }
            }}
            placeholder="#DDoS"
            className="ml-2 w-32 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          />
        </label>

        <label className="text-sm text-stone-700">
          類型
          <select
            value={archaeologyFilter}
            onChange={(e) =>
              setArchaeologyFilter(e.target.value as "all" | "archaeology")
            }
            className="ml-2 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            <option value="all">全部題目</option>
            <option value="archaeology">僅考古</option>
          </select>
        </label>

        <label className="text-sm text-stone-700">
          排序
          <select
            value={sortMode}
            onChange={(e) =>
              setSortMode(
                e.target.value as "year-desc" | "year-asc" | "unfinished-first"
              )
            }
            className="ml-2 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            <option value="year-desc">年份新到舊</option>
            <option value="year-asc">年份舊到新</option>
            <option value="unfinished-first">未完成優先</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
        >
          套用條件
        </button>

        {!selectingForExport ? (
          <>
            <button
              type="button"
              onClick={startSelectingForExport}
              disabled={completedVisibleRows.length === 0}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              選取已完成列表
            </button>
            <button
              type="button"
              onClick={() => void exportSelected()}
              disabled={exporting || completedVisibleRows.length === 0}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {exporting ? "匯出中…" : "匯出已完成列表"}
            </button>
          </>
        ) : (
          <>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={allCompletedSelected}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 rounded border-stone-300 accent-stone-700"
              />
              選取已完成列表
            </label>
            <button
              type="button"
              onClick={() => void exportSelected()}
              disabled={exporting || completedVisibleRows.length === 0}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                selectedIds.length > 0
                  ? "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                  : "border-stone-200 bg-stone-100 text-stone-500"
              }`}
            >
              {exporting
                ? "匯出中…"
                : selectedIds.length > 0
                  ? `匯出已選取（${selectedIds.length}）`
                  : "請先選取題目"}
            </button>
            <button
              type="button"
              onClick={cancelSelectingForExport}
              disabled={exporting}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              取消選取
            </button>
          </>
        )}
      </div>

      {loadError && (
        <div
          className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="alert"
        >
          <p className="font-medium">無法連線 Firestore</p>
          <p className="mt-1 text-amber-800/90">{loadError}</p>
        </div>
      )}

      <ul className="mt-10 space-y-3">
        {visibleRows.map((r) => (
          <li key={r.id}>
            <div className="rounded-2xl border border-stone-200/80 bg-[#fffdf8] p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/practice/${r.id}`}
                  onClick={() => persistHallScroll()}
                  className="group flex-1 transition hover:opacity-90"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
                      {r.subject || "未分類"}
                    </span>
                    <span>{r.year || "—"} 年</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                      {r.score || 0} 分
                    </span>
                    {r.isArchaeology && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800">
                        考古
                      </span>
                    )}
                    {r.imageUrl && (
                      <span className="text-stone-400">含題目附圖</span>
                    )}
                    {r.latestAttemptStatus === "completed" && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                        已完成
                      </span>
                    )}
                    {(r.latestAttemptStatus === "analyzed" ||
                      r.latestAttemptStatus === "flashcards_ready") && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                        已批改
                      </span>
                    )}
                    {r.latestAttemptStatus === "flashcards_ready" && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-800">
                        已生成字卡
                      </span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-stone-800">
                    {r.questionText}
                  </p>
                  {r.latestKeywordDisplay.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 text-xs text-stone-500">
                      {r.latestKeywordDisplay.map((kw) => (
                        <span
                          key={`${r.id}-${kw}`}
                          className="rounded-full bg-stone-100 px-2 py-0.5"
                        >
                          #{kw}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="mt-3 inline-block text-xs font-medium text-stone-500 group-hover:text-stone-800">
                    進入作答 →
                  </span>
                </Link>
                <div className="flex items-center gap-2">
                  {!selectingForExport ? (
                    <button
                      type="button"
                      onClick={() => setEditTarget(r)}
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      編輯
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSelect(r.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                        selectedIds.includes(r.id)
                          ? "border border-stone-900 bg-stone-900 text-white"
                          : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      {selectedIds.includes(r.id) ? "已選取" : "選取"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {loading && !loadError && visibleRows.length === 0 && (
        <div className="mt-10 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-stone-200/80 bg-stone-100/70"
            />
          ))}
        </div>
      )}

      {!loading && !loadError && visibleRows.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有題目。
        </p>
      )}

      {!loading && !loadError && visibleRows.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs text-stone-500">
            已顯示 {visibleRows.length} / {total} 筆
          </p>
          {visibleRows.length < total && (
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

export default function HallPage() {
  return (
    <Suspense fallback={null}>
      <HallPageContent />
    </Suspense>
  );
}
