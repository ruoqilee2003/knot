"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

type Card = {
  id: string;
  front: string;
  back: string;
  subject: string;
  questionId: string | null;
  createdAt: unknown;
};

export default function FlashcardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [openedIds, setOpenedIds] = useState<string[]>([]);

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
            {c.subject && <p className="text-xs font-medium text-stone-500">{c.subject}</p>}
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Q</p>
            <p className="mt-1 text-sm font-medium leading-relaxed text-stone-900">
              {c.front}
            </p>
            {openedIds.includes(c.id) && (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  A
                </p>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-stone-800">
                  {c.back}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {c.questionId ? (
                    <Link
                      href={`/practice/${c.questionId}`}
                      className="text-xs text-stone-600 underline hover:text-stone-900"
                    >
                      檢視原題
                    </Link>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteTargetId(c.id)}
                    className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    刪除
                  </button>
                </div>
              </>
            )}
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => toggleAnswer(c.id)}
                aria-label={openedIds.includes(c.id) ? "收起答案" : "展開答案"}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
              >
                {openedIds.includes(c.id) ? "收起答案" : "展開答案"}
              </button>
            </div>
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
