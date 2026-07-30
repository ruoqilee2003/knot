"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { PRESET_SUBJECTS, subjectsMatch } from "@/lib/subjects";

type PersonalNote = {
  id: string;
  body: string;
  subject: string;
  questionId: string;
  keywordDisplay?: string[];
};

export default function KeywordNotesPage() {
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/personal-notes", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取重點筆記失敗");
      }
      const data = (await response.json()) as Array<Record<string, unknown>>;
      const list: PersonalNote[] = data.map((x) => ({
        id: String(x.id ?? ""),
        body: String(x.body ?? ""),
        subject: String(x.subject ?? ""),
        questionId: String(x.questionId ?? ""),
        keywordDisplay: Array.isArray(x.keywordDisplay)
          ? x.keywordDisplay.map((item) => String(item))
          : [],
      }));
      setNotes(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取重點筆記失敗");
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const subjects = PRESET_SUBJECTS;

  const visibleNotes = useMemo(() => {
    const normalizedKeyword = keywordFilter.trim().toLowerCase();
    return notes.filter((note) => {
      if (
        subjectFilter !== "all" &&
        !subjectsMatch(note.subject, subjectFilter)
      ) {
        return false;
      }
      if (!normalizedKeyword) return true;
      return (note.keywordDisplay ?? []).some((kw) =>
        kw.toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [notes, subjectFilter, keywordFilter]);

  const deleteNote = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/personal-notes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "刪除重點筆記失敗");
      }
      setNotes((prev) => prev.filter((note) => note.id !== id));
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除重點筆記失敗");
    } finally {
      setDeleting(false);
    }
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/personal-notes/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editingBody }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "儲存重點筆記失敗");
      }
      setNotes((prev) =>
        prev.map((note) =>
          note.id === editingId ? { ...note, body: editingBody.trim() } : note
        )
      );
      setEditingId(null);
      setEditingBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存重點筆記失敗");
    } finally {
      setSaving(false);
    }
  }, [editingBody, editingId]);

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">個人筆記</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">重點筆記</h1>
      <p className="mt-2 text-sm text-stone-600">
        由作答區自行紀錄的口訣與重點，依考題與關鍵字整理。
      </p>

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
          關鍵字
          <input
            type="text"
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            className="ml-2 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          />
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
        title="刪除重點筆記"
        description="此動作無法復原，確定要刪除這筆筆記嗎？"
        confirmLabel="確認刪除"
        busy={deleting}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (!deleteTargetId || deleting) return;
          void deleteNote(deleteTargetId);
        }}
      />

      <ul className="mt-10 space-y-4">
        {visibleNotes.map((note) => (
          <li
            key={note.id}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              {note.subject && (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
                  {note.subject}
                </span>
              )}
              {(note.keywordDisplay ?? []).map((kw) => (
                <span key={`${note.id}-${kw}`} className="rounded-full bg-stone-100 px-2 py-0.5">
                  {kw}
                </span>
              ))}
            </div>
            <div className="min-w-0">
              {editingId === note.id ? (
                <textarea
                  value={editingBody}
                  onChange={(e) => setEditingBody(e.target.value)}
                  className="min-h-[120px] w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-stone-800 outline-none ring-stone-400 focus:ring-2"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
                  {note.body}
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {editingId !== note.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(note.id);
                    setEditingBody(note.body);
                  }}
                  className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  編輯
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setEditingBody("");
                    }}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdit()}
                    disabled={saving}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setDeleteTargetId(note.id)}
                className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                刪除
              </button>
              {note.questionId && (
                <Link
                  href={`/practice/${note.questionId}`}
                  className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  回到原題
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!error && visibleNotes.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前沒有重點筆記。
        </p>
      )}
    </div>
  );
}
