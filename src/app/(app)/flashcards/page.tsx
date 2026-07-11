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
  rememberCount: number;
  forgetCount: number;
  important: boolean;
};

function flashcardsToMarkdown(cards: Card[]): string {
  return cards
    .map((card, idx) => {
      return [
        `## ${idx + 1}. ${card.front}`,
        "",
        card.subject ? `> 考科：${card.subject}` : null,
        card.important ? "> 重要（考古題字卡）" : null,
        card.subject || card.important ? "" : null,
        card.back,
        "",
      ]
        .filter((line) => line !== null)
        .join("\n");
    })
    .join("\n---\n\n");
}

export default function FlashcardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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
        rememberCount: typeof x.rememberCount === "number" ? x.rememberCount : 0,
        forgetCount: typeof x.forgetCount === "number" ? x.forgetCount : 0,
        important: x.important === true,
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

  const startEditing = useCallback((card: Card) => {
    setEditingId(card.id);
    setDraftFront(card.front);
    setDraftBack(card.back);
    setOpenedIds((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setDraftFront("");
    setDraftBack("");
  }, []);

  const saveCard = useCallback(
    async (id: string) => {
      const front = draftFront.trim();
      const back = draftBack.trim();
      if (!front || !back) {
        setError("字卡正反面內容不可為空");
        return;
      }
      setSavingId(id);
      setError(null);
      try {
        const response = await fetch(`/api/flashcards/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ front, back }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "儲存字卡失敗");
        }
        setCards((prev) =>
          prev.map((card) => (card.id === id ? { ...card, front, back } : card))
        );
        cancelEditing();
      } catch (e) {
        setError(e instanceof Error ? e.message : "儲存字卡失敗");
      } finally {
        setSavingId(null);
      }
    },
    [draftFront, draftBack, cancelEditing]
  );

  const exportMarkdown = useCallback(() => {
    if (visibleCards.length === 0) {
      setError("目前沒有可匯出的字卡");
      return;
    }
    const heading =
      subjectFilter === "all" ? "# 關鍵字卡" : `# 關鍵字卡（${subjectFilter}）`;
    const markdown = `${heading}\n\n${flashcardsToMarkdown(visibleCards)}`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `knot-flashcards-${now}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [visibleCards, subjectFilter]);

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">所有字卡</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">關鍵字卡</h1>
      <p className="mt-2 text-sm text-stone-600">
        批改完成後於答題頁按下「轉為字卡」，會將 AI 產生的複習字卡寫入此處。
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

        <button
          type="button"
          onClick={exportMarkdown}
          disabled={visibleCards.length === 0}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          匯出 Markdown
        </button>

        <Link
          href="/review"
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          進入字卡複習 →
        </Link>
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
        {visibleCards.map((c) => {
          const isEditing = editingId === c.id;
          const opened = openedIds.includes(c.id);
          return (
            <li
              key={c.id}
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                {c.subject && (
                  <p className="text-xs font-medium text-stone-500">
                    {c.subject}
                  </p>
                )}
                {c.important && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">
                    重要
                  </span>
                )}
                {(c.rememberCount > 0 || c.forgetCount > 0) && (
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                      記得 ×{c.rememberCount}
                    </span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                      不記得 ×{c.forgetCount}
                    </span>
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Q
              </p>
              {isEditing ? (
                <textarea
                  value={draftFront}
                  onChange={(e) => setDraftFront(e.target.value)}
                  className="mt-1 min-h-[64px] w-full rounded-lg border border-stone-300 bg-white p-2 text-sm font-medium leading-relaxed text-stone-900 outline-none ring-stone-400 focus:ring-2"
                />
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-stone-900">
                  {c.front}
                </p>
              )}
              {opened && (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    A
                  </p>
                  {isEditing ? (
                    <textarea
                      value={draftBack}
                      onChange={(e) => setDraftBack(e.target.value)}
                      className="mt-1 min-h-[96px] w-full rounded-lg border border-stone-300 bg-white p-2 text-sm leading-relaxed text-stone-800 outline-none ring-stone-400 focus:ring-2"
                    />
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
                      {c.back}
                    </p>
                  )}
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
                    aria-label={opened ? "收起答案" : "展開答案"}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    {opened ? "收起答案" : "展開答案"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => startEditing(c)}
                      className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      編輯字卡
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(c.id)}
                        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        刪除
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        捨棄編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveCard(c.id)}
                        disabled={savingId === c.id}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {savingId === c.id ? "儲存中…" : "儲存"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!error && visibleCards.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前篩選條件下沒有字卡。
        </p>
      )}
    </div>
  );
}
