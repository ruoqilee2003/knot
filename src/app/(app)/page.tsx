"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AddQuestionModal } from "@/components/AddQuestionModal";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { EditQuestionModal } from "@/components/EditQuestionModal";

type Row = {
  id: string;
  subject: string;
  year: number;
  score: number;
  questionText: string;
  imageUrl: string | null;
  createdAt: unknown;
};

export default function HallPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Row | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [yearOrder, setYearOrder] = useState<"desc" | "asc">("desc");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch("/api/questions", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "無法讀取題庫");
      }
      const data = (await response.json()) as Array<Record<string, unknown>>;
      const next: Row[] = data.map((d) => ({
        id: String(d.id ?? ""),
        subject: String(d.subject ?? ""),
        year: Number(d.year ?? 0),
        score: Number(d.score ?? 100),
        questionText: String(d.questionText ?? d.title ?? ""),
        imageUrl: d.imageUrl ? String(d.imageUrl) : null,
        createdAt: d.createdAt ?? null,
      }));
      setRows(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "無法讀取題庫");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const subjects = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => row.subject.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filtered =
      subjectFilter === "all"
        ? rows
        : rows.filter((row) => row.subject === subjectFilter);
    return [...filtered].sort((a, b) => {
      const left = Number.isFinite(a.year) ? a.year : 0;
      const right = Number.isFinite(b.year) ? b.year : 0;
      return yearOrder === "asc" ? left - right : right - left;
    });
  }, [rows, subjectFilter, yearOrder]);

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
        setDeleteTargetId(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "刪除題目失敗");
      } finally {
        setDeleting(false);
      }
    },
    []
  );

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
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="relative z-20 cursor-pointer rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800"
        >
          新增題目
        </button>
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
          年份
          <select
            value={yearOrder}
            onChange={(e) => setYearOrder(e.target.value as "asc" | "desc")}
            className="ml-2 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            <option value="desc">新到舊</option>
            <option value="asc">舊到新</option>
          </select>
        </label>
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
                    {r.imageUrl && (
                      <span className="text-stone-400">含題目附圖</span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-stone-800">
                    {r.questionText}
                  </p>
                  <span className="mt-3 inline-block text-xs font-medium text-stone-500 group-hover:text-stone-800">
                    進入作答 →
                  </span>
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditTarget(r)}
                    className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    編輯
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!loadError && visibleRows.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有題目。
        </p>
      )}
    </div>
  );
}
