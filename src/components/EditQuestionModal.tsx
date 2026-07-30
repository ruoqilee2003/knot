"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PRESET_SUBJECTS, normalizeSubject } from "@/lib/subjects";

type QuestionDraft = {
  id: string;
  subject: string;
  year: number;
  score: number;
  questionText: string;
  isArchaeology?: boolean;
};

type Props = {
  open: boolean;
  question: QuestionDraft | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
};

export function EditQuestionModal({
  open,
  question,
  onClose,
  onSaved,
  onDelete,
}: Props) {
  const [questionId, setQuestionId] = useState(question?.id ?? "");
  const [subject, setSubject] = useState(() => {
    const normalized = normalizeSubject(question?.subject ?? "");
    return PRESET_SUBJECTS.includes(normalized as (typeof PRESET_SUBJECTS)[number])
      ? normalized
      : PRESET_SUBJECTS[0];
  });
  const [year, setYear] = useState(question?.year ?? new Date().getFullYear());
  const [score, setScore] = useState(question?.score ?? 100);
  const [questionText, setQuestionText] = useState(question?.questionText ?? "");
  const [isArchaeology, setIsArchaeology] = useState(question?.isArchaeology === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !question || typeof window === "undefined") return null;
  const activeQuestion = question;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !questionText.trim()) {
      setError("請填寫科目與題目內容");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/questions/${activeQuestion.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newId: questionId.trim() || activeQuestion.id,
          subject: subject.trim(),
          year: Number(year) || new Date().getFullYear(),
          score: Number(score) > 0 ? Number(score) : 100,
          questionText: questionText.trim(),
          isArchaeology,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "更新失敗");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-[#fffdf8] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl font-semibold text-stone-900">編輯題目</h2>
            <p className="mt-1 text-sm text-stone-600">可修改題目內容、年份與分數。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
          >
            關閉
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-stone-700">題目 ID</label>
            <input
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={questionId}
              onChange={(e) => setQuestionId(e.target.value)}
              placeholder="例如：net-2026-q1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-stone-700">科目</label>
            <select
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              {PRESET_SUBJECTS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-stone-700">年份</label>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-stone-700">配分</label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={isArchaeology}
              onChange={(e) => setIsArchaeology(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 accent-stone-800"
            />
            考古（歷屆考題）
          </label>
          <div>
            <label className="text-sm font-medium text-stone-700">題目內容</label>
            <textarea
              className="mt-1 min-h-[160px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="貼上申論題幹…"
            />
          </div>
          {error && (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onDelete(activeQuestion.id);
                onClose();
              }}
              className="mr-auto rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              刪除
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
            >
              {busy ? "儲存中…" : "儲存修改"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
