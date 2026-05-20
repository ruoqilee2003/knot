"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

type Card = {
  id: string;
  front: string;
  back: string;
  frontHtml?: string;
  backHtml?: string;
  subject: string;
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

export default function FlashcardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftFrontHtml, setDraftFrontHtml] = useState("");
  const [draftBackHtml, setDraftBackHtml] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectionActiveField, setSelectionActiveField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/flashcards", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "讀取字卡失敗");
      }
      const data = (await response.json()) as Array<Record<string, unknown>>;
      const list: Card[] = data.map((x) => ({
        id: String(x.id ?? ""),
        front: String(x.front ?? ""),
        back: String(x.back ?? ""),
        frontHtml: typeof x.frontHtml === "string" ? x.frontHtml : undefined,
        backHtml: typeof x.backHtml === "string" ? x.backHtml : undefined,
        subject: String(x.subject ?? ""),
        questionId: x.questionId ? String(x.questionId) : null,
        createdAt: x.createdAt ?? null,
      }));
      setCards(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取字卡失敗");
      setCards([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const subjects = useMemo(() => {
    return Array.from(
      new Set(cards.map((card) => card.subject.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [cards]);

  const visibleCards = useMemo(() => {
    if (subjectFilter === "all") return cards;
    return cards.filter((card) => card.subject === subjectFilter);
  }, [cards, subjectFilter]);

  const deleteCard = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/flashcards/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "刪除字卡失敗");
      }
      setCards((prev) => prev.filter((card) => card.id !== id));
      setDeleteTargetId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除字卡失敗");
    } finally {
      setDeleting(false);
    }
  }, []);

  const toggleAnswer = useCallback((id: string) => {
    setOpenedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const applyFormatting = useCallback((command: "underline" | "highlight") => {
    if (!editingId) return;
    const active = document.activeElement;
    if (active instanceof HTMLDivElement) {
      applyMarkWithRange(active, command);
      if (active.id === `flashcard-front-editor-${editingId}`) {
        setDraftFrontHtml(active.innerHTML);
      } else if (active.id === `flashcard-back-editor-${editingId}`) {
        setDraftBackHtml(active.innerHTML);
      }
    }
  }, [editingId]);

  const clearSelectedMark = useCallback(() => {
    if (!editingId) return;
    const active = document.activeElement;
    if (active instanceof HTMLDivElement) {
      clearMarkWithRange(active);
      if (active.id === `flashcard-front-editor-${editingId}`) {
        setDraftFrontHtml(active.innerHTML);
      } else if (active.id === `flashcard-back-editor-${editingId}`) {
        setDraftBackHtml(active.innerHTML);
      }
    }
  }, [editingId]);

  const clearAllEditorMarks = useCallback(() => {
    if (!editingId) return;
    const frontEditor = document.getElementById(`flashcard-front-editor-${editingId}`);
    const backEditor = document.getElementById(`flashcard-back-editor-${editingId}`);
    if (frontEditor instanceof HTMLDivElement) {
      clearAllMarks(frontEditor);
      setDraftFrontHtml(frontEditor.innerHTML);
    }
    if (backEditor instanceof HTMLDivElement) {
      clearAllMarks(backEditor);
      setDraftBackHtml(backEditor.innerHTML);
    }
  }, [editingId]);

  const updateSelectionState = useCallback((editorId: string) => {
    const editor = document.getElementById(editorId);
    const selection = window.getSelection();
    if (!(editor instanceof HTMLDivElement) || !selection || selection.rangeCount === 0) {
      setSelectionActiveField(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const inEditor = editor.contains(range.commonAncestorContainer);
    setSelectionActiveField(inEditor && !range.collapsed ? editorId : null);
  }, []);

  const saveCard = useCallback(
    async (id: string) => {
      const frontEditor = document.getElementById(`flashcard-front-editor-${id}`);
      const backEditor = document.getElementById(`flashcard-back-editor-${id}`);
      const currentFrontHtml =
        frontEditor instanceof HTMLDivElement ? frontEditor.innerHTML : draftFrontHtml;
      const currentBackHtml =
        backEditor instanceof HTMLDivElement ? backEditor.innerHTML : draftBackHtml;
      if (!currentFrontHtml || !currentBackHtml) return;
      setSavingId(id);
      setError(null);
      try {
        const front = htmlToPlainText(currentFrontHtml);
        const back = htmlToPlainText(currentBackHtml);
        const response = await fetch(`/api/flashcards/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            front,
            back,
            frontHtml: currentFrontHtml,
            backHtml: currentBackHtml,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "儲存字卡失敗");
        }
        setCards((prev) =>
          prev.map((card) =>
            card.id === id
              ? {
                  ...card,
                  front,
                  back,
                  frontHtml: currentFrontHtml,
                  backHtml: currentBackHtml,
                }
              : card
          )
        );
        setEditingId(null);
        setDraftFrontHtml("");
        setDraftBackHtml("");
        setSelectionActiveField(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "儲存字卡失敗");
      } finally {
        setSavingId(null);
      }
    },
    [draftFrontHtml, draftBackHtml]
  );

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">所有字卡</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">關鍵字卡</h1>
      <p className="mt-2 text-sm text-stone-600">
        批改完成後於答題頁按下「轉為字卡」，會將 AI 產生的複習字卡寫入此處。
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
        title="刪除字卡"
        description="此動作無法復原，確定要刪除此張關鍵字卡嗎？"
        confirmLabel="確認刪除"
        busy={deleting}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (!deleteTargetId || deleting) return;
          void deleteCard(deleteTargetId);
        }}
      />

      <ul className="mt-10 space-y-4">
        {visibleCards.map((c) => (
          <li
            key={c.id}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm"
          >
            {(() => {
              const frontHtml = c.frontHtml || textToHtml(c.front);
              const backHtml = c.backHtml || textToHtml(c.back);
              const isEditing = editingId === c.id;
              const opened = openedIds.includes(c.id);
              return (
                <>
            {c.subject && <p className="text-xs font-medium text-stone-500">{c.subject}</p>}
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Q</p>
            <div className="relative mt-1">
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
                className={`whitespace-pre-wrap text-sm font-medium leading-relaxed text-stone-900 ${
                  isEditing
                    ? selectionActiveField === `flashcard-front-editor-${c.id}`
                      ? "rounded-lg border border-amber-400 bg-amber-50/30 p-2 pb-16"
                      : "rounded-lg border border-stone-300 bg-white p-2 pb-16"
                    : ""
                }`}
                contentEditable={isEditing}
                suppressContentEditableWarning
                id={`flashcard-front-editor-${c.id}`}
                onInput={(e) => {
                  if (isEditing) {
                    setDraftFrontHtml((e.currentTarget as HTMLDivElement).innerHTML);
                  }
                }}
                onMouseUp={() => updateSelectionState(`flashcard-front-editor-${c.id}`)}
                onKeyUp={() => updateSelectionState(`flashcard-front-editor-${c.id}`)}
                onKeyDownCapture={(e) => {
                  if (!isEditing) return;
                  const key = e.key.toLowerCase();
                  if ((e.ctrlKey || e.metaKey) && key === "s") {
                    e.preventDefault();
                    void saveCard(c.id);
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
                    setDraftFrontHtml("");
                    setDraftBackHtml("");
                    setSelectionActiveField(null);
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
                    e.stopPropagation();
                  }
                }}
                dangerouslySetInnerHTML={{ __html: isEditing ? draftFrontHtml : frontHtml }}
              />
            </div>
            {opened && (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  A
                </p>
                <div
                  className={`mt-1 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-800 ${
                    isEditing
                      ? selectionActiveField === `flashcard-back-editor-${c.id}`
                        ? "rounded-lg border border-amber-400 bg-amber-50/30 p-2"
                        : "rounded-lg border border-stone-300 bg-white p-2"
                      : ""
                  }`}
                  contentEditable={isEditing}
                  suppressContentEditableWarning
                  id={`flashcard-back-editor-${c.id}`}
                  onInput={(e) => {
                    if (isEditing) {
                      setDraftBackHtml((e.currentTarget as HTMLDivElement).innerHTML);
                    }
                  }}
                  onMouseUp={() => updateSelectionState(`flashcard-back-editor-${c.id}`)}
                  onKeyUp={() => updateSelectionState(`flashcard-back-editor-${c.id}`)}
                  onKeyDownCapture={(e) => {
                    if (!isEditing) return;
                    const key = e.key.toLowerCase();
                    if ((e.ctrlKey || e.metaKey) && key === "s") {
                      e.preventDefault();
                      void saveCard(c.id);
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
                      setDraftFrontHtml("");
                      setDraftBackHtml("");
                      setSelectionActiveField(null);
                      return;
                    }
                    if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
                      e.stopPropagation();
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: isEditing ? draftBackHtml : backHtml }}
                />
              </>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {c.questionId && (
                  <Link
                    href={`/practice/${c.questionId}`}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    檢視原題
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => toggleAnswer(c.id)}
                  aria-label={openedIds.includes(c.id) ? "收起答案" : "展開答案"}
                  className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  {opened ? "收起答案" : "展開答案"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setDraftFrontHtml(frontHtml);
                      setDraftBackHtml(backHtml);
                      if (!opened) {
                        setOpenedIds((prev) => [...prev, c.id]);
                      }
                    }}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    編輯字卡
                  </button>
                )}
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => setDeleteTargetId(c.id)}
                    className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    刪除
                  </button>
                )}
              {isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setDraftFrontHtml("");
                    setDraftBackHtml("");
                    setSelectionActiveField(null);
                  }}
                  className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  捨棄編輯
                </button>
              )}
              {isEditing && (
                <button
                  type="button"
                  onClick={() => void saveCard(c.id)}
                  disabled={savingId === c.id}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {savingId === c.id ? "儲存中…" : "儲存"}
                </button>
              )}
              </div>
            </div>
                </>
              );
            })()}
          </li>
        ))}
      </ul>

      {!error && visibleCards.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有字卡。
        </p>
      )}
    </div>
  );
}
