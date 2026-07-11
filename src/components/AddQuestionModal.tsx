"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseStorage } from "@/lib/firebase";

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const commaIndex = result.indexOf(",");
      resolve({
        base64: commaIndex >= 0 ? result.slice(commaIndex + 1) : result,
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("讀取圖片失敗"));
    reader.readAsDataURL(file);
  });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

const PRESET_SUBJECTS = ["資通網路", "資通安全", "資料庫應用", "作業系統"];

type DuplicateMatch = {
  id: string;
  year: number | null;
  questionText: string;
  similarity: number;
};

export function AddQuestionModal({ open, onClose, onCreated }: Props) {
  const [questionId, setQuestionId] = useState("");
  const [subject, setSubject] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [score, setScore] = useState(100);
  const [questionText, setQuestionText] = useState("");
  const [isArchaeology, setIsArchaeology] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  if (!open || typeof window === "undefined") return null;

  async function handleOcrFile(file: File) {
    setError(null);
    setOcrBusy(true);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; text?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "OCR 辨識失敗");
      }
      const text = String(payload?.text ?? "").trim();
      if (!text) {
        throw new Error("無法從圖片辨識出文字，請換一張更清晰的圖片");
      }
      // 圖片僅用於辨識，不會儲存；辨識結果填入題目內容供校對
      setQuestionText((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR 辨識失敗");
    } finally {
      setOcrBusy(false);
      if (ocrInputRef.current) {
        ocrInputRef.current.value = "";
      }
    }
  }

  async function submitQuestion(allowDuplicate: boolean) {
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
          questionId: questionId.trim() || undefined,
          subject: subject.trim(),
          year: Number(year) || new Date().getFullYear(),
          score: Number(score) > 0 ? Number(score) : 100,
          questionText: questionText.trim(),
          imageUrl,
          isArchaeology,
          allowDuplicate,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; duplicates?: DuplicateMatch[] }
          | null;
        if (
          response.status === 409 &&
          Array.isArray(payload?.duplicates) &&
          payload.duplicates.length > 0
        ) {
          setDuplicates(payload.duplicates);
          return;
        }
        throw new Error(payload?.error || "新增失敗");
      }
      setSubject("");
      setQuestionId("");
      setYear(new Date().getFullYear());
      setScore(100);
      setQuestionText("");
      setIsArchaeology(false);
      setFile(null);
      setDuplicates([]);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicates([]);
    await submitQuestion(false);
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
            <label className="text-sm font-medium text-stone-700">題目 ID（選填）</label>
            <input
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={questionId}
              onChange={(e) => setQuestionId(e.target.value)}
              placeholder="例如：net-2026-q1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-stone-700">科目</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PRESET_SUBJECTS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSubject(preset)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    subject.trim() === preset
                      ? "bg-stone-900 text-white"
                      : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="點選上方類科，或輸入新類科名稱"
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
            <label className="text-sm font-medium text-stone-700">配分</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
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
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-stone-700">
                題目內容
              </label>
              <button
                type="button"
                onClick={() => ocrInputRef.current?.click()}
                disabled={ocrBusy || busy}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                {ocrBusy ? "辨識中…" : "掃描圖片辨識文字"}
              </button>
              <input
                ref={ocrInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleOcrFile(file);
                }}
              />
            </div>
            <textarea
              className="mt-1 min-h-[140px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none ring-stone-400 focus:ring-2"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="貼上申論題幹，或用右上角按鈕掃描圖片…"
            />
            <p className="mt-1 text-xs text-stone-500">
              掃描的圖片只用來辨識文字，不會被儲存；辨識結果會填入上方欄位供校對。
            </p>
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
          {duplicates.length > 0 && (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="alert"
            >
              <p className="font-medium">偵測到相似題目，可能已經存在：</p>
              <ul className="mt-2 space-y-2">
                {duplicates.map((d) => (
                  <li key={d.id} className="rounded-lg bg-white/70 p-2">
                    <p className="text-xs text-amber-800">
                      {d.year ? `${d.year} 年・` : ""}相似度{" "}
                      {Math.round(d.similarity * 100)}%
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-700">
                      {d.questionText}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-800">
                若確認不是同一題，可按「仍要建立」繼續新增。
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
            >
              取消
            </button>
            {duplicates.length > 0 && (
              <button
                type="button"
                onClick={() => void submitQuestion(true)}
                disabled={busy}
                className="rounded-lg border border-amber-400 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-60"
              >
                {busy ? "儲存中…" : "仍要建立"}
              </button>
            )}
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
