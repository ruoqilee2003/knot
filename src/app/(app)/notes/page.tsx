"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { PRESET_SUBJECTS, subjectsMatch } from "@/lib/subjects";

type Note = {
  id: string;
  title: string;
  body: string;
  bodyHtml?: string;
  subject: string;
  score: number | null;
  questionId: string | null;
  createdAt: unknown;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function htmlToPlainText(html: string): string {
  if (typeof window === "undefined") return html;
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.innerText.trim();
}

function applyMarkWithRange(editor: HTMLDivElement, mark: "underline" | "highlight") {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return;

  if (mark === "underline") {
    const applied = document.execCommand("underline");
    if (applied) return;
  } else {
    const applied =
      document.execCommand("hiliteColor", false, "#fde68a") ||
      document.execCommand("backColor", false, "#fde68a");
    if (applied) return;
  }

  const wrapper = document.createElement("span");
  if (mark === "underline") {
    wrapper.style.textDecoration = "underline";
  } else {
    wrapper.style.backgroundColor = "#fde68a";
  }
  const fragment = range.extractContents();
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
}

function clearMarkWithRange(editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return;
  const applied = document.execCommand("removeFormat");
  if (applied) return;

  const fragment = range.extractContents();
  const wrapper = document.createElement("span");
  wrapper.appendChild(fragment);
  wrapper.querySelectorAll<HTMLElement>("span, u, mark").forEach((node) => {
    node.style.textDecoration = "";
    node.style.backgroundColor = "";
  });
  range.insertNode(wrapper);
}

function clearAllMarks(editor: HTMLDivElement) {
  const clone = editor.cloneNode(true) as HTMLDivElement;
  clone.querySelectorAll<HTMLElement>("*").forEach((node) => {
    if (node.style.textDecoration.includes("underline")) {
      node.style.textDecoration = "";
    }
    if (node.style.backgroundColor) {
      node.style.backgroundColor = "";
    }
  });
  editor.innerHTML = clone.innerHTML;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBodyHtml, setDraftBodyHtml] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectionActiveId, setSelectionActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/study-notes", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取解答批改失敗");
      }
      const data = (await response.json()) as Array<Record<string, unknown>>;
      const list: Note[] = data.map((x) => ({
        id: String(x.id ?? ""),
        title: String(x.title ?? "未命名"),
        body: String(x.body ?? ""),
        bodyHtml: typeof x.bodyHtml === "string" ? x.bodyHtml : undefined,
        subject: String(x.subject ?? ""),
        score:
          typeof x.score === "number" && Number.isFinite(x.score)
            ? x.score
            : null,
        questionId: x.questionId ? String(x.questionId) : null,
        createdAt: x.createdAt ?? null,
      }));
      setNotes(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取解答批改失敗");
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const subjects = PRESET_SUBJECTS;

  const visibleNotes = useMemo(() => {
    if (subjectFilter === "all") return notes;
    return notes.filter((note) => subjectsMatch(note.subject, subjectFilter));
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
          throw new Error(payload?.error || "刪除解答批改失敗");
      }
      setNotes((prev) => prev.filter((note) => note.id !== id));
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除解答批改失敗");
    } finally {
      setDeleting(false);
    }
  }, []);

  const applyFormatting = useCallback((command: "underline" | "highlight") => {
    if (editingId == null) return;
    const editor = document.getElementById(`note-editor-${editingId}`);
    if (editor instanceof HTMLDivElement) {
      applyMarkWithRange(editor, command);
      setDraftBodyHtml(editor.innerHTML);
    }
  }, [editingId]);

  const clearSelectedMark = useCallback(() => {
    if (editingId == null) return;
    const editor = document.getElementById(`note-editor-${editingId}`);
    if (editor instanceof HTMLDivElement) {
      clearMarkWithRange(editor);
      setDraftBodyHtml(editor.innerHTML);
    }
  }, [editingId]);

  const clearAllEditorMarks = useCallback(() => {
    if (editingId == null) return;
    const editor = document.getElementById(`note-editor-${editingId}`);
    if (editor instanceof HTMLDivElement) {
      clearAllMarks(editor);
      setDraftBodyHtml(editor.innerHTML);
    }
  }, [editingId]);

  const updateSelectionState = useCallback((id: string) => {
    const editor = document.getElementById(`note-editor-${id}`);
    const selection = window.getSelection();
    if (!(editor instanceof HTMLDivElement) || !selection || selection.rangeCount === 0) {
      setSelectionActiveId(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const inEditor = editor.contains(range.commonAncestorContainer);
    const active = inEditor && !range.collapsed;
    setSelectionActiveId(active ? id : null);
  }, []);

  const saveNoteMarkup = useCallback(
    async (id: string) => {
      const editor = document.getElementById(`note-editor-${id}`);
      const currentHtml =
        editor instanceof HTMLDivElement ? editor.innerHTML : draftBodyHtml;
      if (!currentHtml) return;
      setSavingId(id);
      setError(null);
      try {
        const body = htmlToPlainText(currentHtml);
        const response = await fetch(`/api/study-notes/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            bodyHtml: currentHtml,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "儲存解答批改失敗");
        }
        setNotes((prev) =>
          prev.map((note) =>
            note.id === id ? { ...note, body, bodyHtml: currentHtml } : note
          )
        );
        setEditingId(null);
        setDraftBodyHtml("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "儲存解答批改失敗");
      } finally {
        setSavingId(null);
      }
    },
    [draftBodyHtml]
  );

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">解答批改</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">
        解答批改
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        由答題頁「儲存為解答批改」寫入的 AI 批改摘要會出現在這裡。
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
        title="刪除解答批改"
        description="此動作無法復原，確定要刪除此筆解答批改嗎？"
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
            {(() => {
              const noteHtml = n.bodyHtml || textToHtml(n.body);
              const isEditing = editingId === n.id;
              return (
                <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {n.subject && (
                    <p className="font-medium text-stone-500">{n.subject}</p>
                  )}
                  {n.score != null && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                      {n.score} 分
                    </span>
                  )}
                </div>
                <h2 className="font-medium text-stone-900">{n.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(n.id);
                      setDraftBodyHtml(noteHtml);
                    }}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    編輯劃記
                  </button>
                )}
              </div>
            </div>
            <div className="relative mt-3">
              {isEditing && (
                <div className="pointer-events-auto absolute bottom-2 left-1/2 z-10 -translate-x-1/2">
                  <div className="w-fit rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-md">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFormatting("underline")}
                        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        底線
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFormatting("highlight")}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        螢光筆
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={clearSelectedMark}
                        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        取消劃記
                      </button>
                      <button
                        type="button"
                        onClick={clearAllEditorMarks}
                        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        清除全部劃記
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div
                className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border p-2 font-sans text-sm leading-relaxed text-stone-700 ${
                  isEditing
                    ? selectionActiveId === n.id
                      ? "border-amber-400 bg-amber-50/30 pb-16 pt-3"
                      : "border-stone-300 bg-white pb-16 pt-3"
                    : "border-transparent"
                }`}
                contentEditable={isEditing}
                suppressContentEditableWarning
                id={`note-editor-${n.id}`}
                onInput={(e) => {
                  if (isEditing) {
                    setDraftBodyHtml((e.currentTarget as HTMLDivElement).innerHTML);
                  }
                }}
                onMouseUp={() => updateSelectionState(n.id)}
                onKeyUp={() => updateSelectionState(n.id)}
                onKeyDownCapture={(e) => {
                  if (!isEditing) return;
                  const key = e.key.toLowerCase();
                  if ((e.ctrlKey || e.metaKey) && key === "s") {
                    e.preventDefault();
                    void saveNoteMarkup(n.id);
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && key === "u") {
                    e.preventDefault();
                    applyFormatting("underline");
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "h") {
                    e.preventDefault();
                    applyFormatting("highlight");
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "x") {
                    e.preventDefault();
                    clearSelectedMark();
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "backspace") {
                    e.preventDefault();
                    clearAllEditorMarks();
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "d") {
                    e.preventDefault();
                    setEditingId(null);
                    setDraftBodyHtml("");
                    setSelectionActiveId(null);
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
                    // Keep browser native undo/redo within the editable region.
                    e.stopPropagation();
                  }
                }}
                dangerouslySetInnerHTML={{
                  __html: isEditing ? draftBodyHtml : noteHtml,
                }}
              />
            </div>
            {isEditing && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {n.questionId && (
                  <Link
                    href={`/practice/${n.questionId}`}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
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
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setDraftBodyHtml("");
                    setSelectionActiveId(null);
                  }}
                  className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  捨棄編輯
                </button>
                <button
                  type="button"
                  onClick={() => void saveNoteMarkup(n.id)}
                  disabled={savingId === n.id}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {savingId === n.id ? "儲存中…" : "儲存"}
                </button>
              </div>
            )}
            {!isEditing && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {n.questionId && (
                  <Link
                    href={`/practice/${n.questionId}`}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    回到原題
                  </Link>
                )}
              </div>
            )}
                </>
              );
            })()}
          </li>
        ))}
      </ul>

      {!error && visibleNotes.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有解答批改。
        </p>
      )}
    </div>
  );
}
