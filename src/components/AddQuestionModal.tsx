"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseStorage } from "@/lib/firebase";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddQuestionModal({ open, onClose, onCreated }: Props) {
  const [subject, setSubject] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [questionText, setQuestionText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || typeof window === "undefined") return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !questionText.trim()) {
      setError("請填寫科目與題目內容");
      return;
    }
    setBusy(true);
    try {
      const storage = getFirebaseStorage();
      let imageUrl: string | null = null;
      if (file) {
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const path = `questions/${crypto.randomUUID()}_${safeName}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        imageUrl = await getDownloadURL(storageRef);
      }
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: subject.trim(),
          year: Number(year) || new Date().getFullYear(),
          questionText: questionText.trim(),
          imageUrl,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "新增失敗");
      }
      setSubject("");
      setYear(new Date().getFullYear());
      setQuestionText("");
      setFile(null);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失敗");
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
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              新增題目
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              題目與選用圖片會寫入 Firestore / Storage。
            </p>
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
            <label className="text-sm font-medium text-stone-700">科目</label>
            <input
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="例如：行政法"
            />
          </div>
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
            <label className="text-sm font-medium text-stone-700">
              題目內容
            </label>
            <textarea
              className="mt-1 min-h-[140px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="貼上申論題幹…"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-stone-700">
              題目附圖（選填，上傳至 Storage）
            </label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm text-stone-600"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
              {busy ? "儲存中…" : "建立題目"}
            </button>
          </div>
        </form>
      </div>
    </div>
    ,
    document.body
  );
}
