"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

type Note = {
  id: string;
  title: string;
  body: string;
  subject: string;
  questionId: string | null;
  createdAt: unknown;
};

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/study-notes", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取筆記失敗");
      }
      const data = (await response.json()) as Array<Record<string, unknown>>;
      const list: Note[] = data.map((x) => ({
        id: String(x.id ?? ""),
        title: String(x.title ?? "未命名"),
        body: String(x.body ?? ""),
        subject: String(x.subject ?? ""),
        questionId: x.questionId ? String(x.questionId) : null,
        createdAt: x.createdAt ?? null,
      }));
      setNotes(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取筆記失敗");
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const subjects = useMemo(() => {
    return Array.from(
      new Set(notes.map((note) => note.subject.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [notes]);

  const visibleNotes = useMemo(() => {
    if (subjectFilter === "all") return notes;
    return notes.filter((note) => note.subject === subjectFilter);
  }, [notes, subjectFilter]);

  const deleteNote = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/study-notes/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "刪除筆記失敗");
      }
      setNotes((prev) => prev.filter((note) => note.id !== id));
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除筆記失敗");
    } finally {
      setDeleting(false);
    }
  }, []);

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">所有筆記</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">
        研讀筆記
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        由答題頁「儲存為筆記」寫入的 AI 摘要會出現在這裡。
      </p>

      <div className="mt-6">
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
      </div>

      {error && (
        <div
          className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}
      <ConfirmDeleteDialog
        open={Boolean(deleteTargetId)}
        title="刪除筆記"
        description="此動作無法復原，確定要刪除此筆筆記嗎？"
        confirmLabel="確認刪除"
        busy={deleting}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (!deleteTargetId || deleting) return;
          void deleteNote(deleteTargetId);
        }}
      />

      <ul className="mt-10 space-y-4">
        {visibleNotes.map((n) => (
          <li
            key={n.id}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                {n.subject && (
                  <p className="text-xs font-medium text-stone-500">{n.subject}</p>
                )}
                <h2 className="font-medium text-stone-900">{n.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                {n.questionId && (
                  <Link
                    href={`/practice/${n.questionId}`}
                    className="text-xs text-stone-600 underline hover:text-stone-900"
                  >
                    回到原題
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(n.id)}
                  className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  刪除
                </button>
              </div>
            </div>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-stone-700">
              {n.body}
            </pre>
          </li>
        ))}
      </ul>

      {!error && visibleNotes.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有筆記。
        </p>
      )}
    </div>
  );
}
