"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseStorage } from "@/lib/firebase";
import type { AnalysisResult } from "@/types/analysis";

type Question = {
  subject: string;
  year: number;
  questionText: string;
  imageUrl: string | null;
};

type DraftSyncPayload = {
  text: string;
  imageUrl: string | null;
  status: "draft" | "analyzed" | "analyze_failed";
  errorMessage?: string | null;
  analysis?: AnalysisResult;
};

function draftKey(id: string) {
  return `exam-prep-draft:${id}`;
}

function makeNoteTitleFromQuestion(questionText: string): string {
  const normalized = questionText.replace(/\s+/g, " ").trim();
  if (!normalized) return "未命名題目";
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function countWithoutWhitespace(text: string): number {
  return text.replace(/\s/g, "").length;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export default function PracticePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [question, setQuestion] = useState<Question | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [answerPreview, setAnswerPreview] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [flashBusy, setFlashBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedWordCount, setSelectedWordCount] = useState(0);
  const answerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busyMessage = "系統忙碌中，請再試一次";

  useEffect(() => {
    if (!answerFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnswerPreview(null);
      return;
    }
    const url = URL.createObjectURL(answerFile);
    setAnswerPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [answerFile]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const response = await fetch(`/api/questions/${id}`, { method: "GET" });
        const payload = (await response.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        if (cancelled) return;
        if (!response.ok || !payload) {
          const errorMessage =
            typeof payload?.error === "string"
              ? payload.error
              : "讀取題目失敗";
          setQuestion(null);
          setLoadError(errorMessage);
          return;
        }
        const d = payload;
        setQuestion({
          subject: String(d.subject ?? ""),
          year: Number(d.year ?? 0),
          questionText: String(d.questionText ?? d.title ?? ""),
          imageUrl: d.imageUrl ? String(d.imageUrl) : null,
        });
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "讀取題目失敗");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/drafts/${id}`, { method: "GET" });
        if (response.ok) {
          const parsed = (await response.json()) as {
            text?: string;
            imageUrl?: string | null;
            analysis?: AnalysisResult;
          };
          if (cancelled) return;
          if (typeof parsed.text === "string") setAnswerText(parsed.text);
          if (parsed.imageUrl) setAnswerPreview(parsed.imageUrl);
          if (parsed.analysis) setAnalysis(parsed.analysis);
          return;
        }
      } catch {
        /* ignore and fallback to local */
      }

      try {
        const raw = localStorage.getItem(draftKey(id));
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as {
          text?: string;
          imageUrl?: string | null;
        };
        if (typeof parsed.text === "string") setAnswerText(parsed.text);
        if (parsed.imageUrl) setAnswerPreview(parsed.imageUrl);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const getPersistableImageUrl = useCallback(async () => {
    if (answerFile) {
      const storage = getFirebaseStorage();
      const path = `drafts/${id}/${crypto.randomUUID()}_${answerFile.name.replace(/[^\w.\-]/g, "_")}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, answerFile);
      return await getDownloadURL(storageRef);
    }
    if (answerPreview?.startsWith("http")) {
      return answerPreview;
    }
    return null;
  }, [id, answerFile, answerPreview]);

  const syncDraftToFirestore = useCallback(
    async (payload: DraftSyncPayload) => {
      const response = await fetch(`/api/drafts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || "Firestore 同步失敗");
      }
    },
    [id]
  );

  const saveDraft = useCallback(async () => {
    if (!id) return;
    setApiError(null);
    try {
      const imageUrl = await getPersistableImageUrl();
      const payload = { text: answerText, imageUrl };
      localStorage.setItem(draftKey(id), JSON.stringify(payload));

      await syncDraftToFirestore({
        ...payload,
        status: "draft",
        errorMessage: null,
      });

      setDraftSavedAt(new Date().toLocaleString());
      showToast("草稿已儲存");
    } catch (e) {
      setApiError(
        e instanceof Error
          ? `${e.message}（本機草稿仍已儲存）`
          : "草稿儲存失敗（本機草稿仍已儲存）"
      );
    }
  }, [id, answerText, getPersistableImageUrl, syncDraftToFirestore]);

  const submitAnalyze = useCallback(async () => {
    if (!question || !id) return;
    const hasText = answerText.trim().length > 0;
    const hasFile = !!answerFile;
    if (!hasText && !hasFile) {
      setApiError("請輸入文字或上傳手寫答案圖片");
      return;
    }
    setApiError(null);
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const imageUrl = await getPersistableImageUrl();
      let answerImageBase64: string | undefined;
      let answerImageMimeType: string | undefined;
      if (answerFile) {
        answerImageBase64 = await fileToBase64(answerFile);
        answerImageMimeType = answerFile.type || "image/png";
      }
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionText: question.questionText,
          answerText: hasText ? answerText : undefined,
          answerImageBase64,
          answerImageMimeType,
          subject: question.subject,
          year: question.year,
        }),
      });
      const data = (await res.json()) as AnalysisResult & { error?: string };
      if (!res.ok) {
        const errorMessage = data.error || "批改請求失敗";
        const isHighDemand =
          res.status === 503 || errorMessage.toLowerCase().includes("high demand");
        if (isHighDemand) {
          throw new Error(busyMessage);
        }
        throw new Error(errorMessage);
      }
      setAnalysis(data);
      localStorage.setItem(
        draftKey(id),
        JSON.stringify({
          text: answerText,
          imageUrl,
        })
      );
      await syncDraftToFirestore({
        text: answerText,
        imageUrl,
        status: "analyzed",
        analysis: data,
        errorMessage: null,
      });
      showToast("批改完成");
    } catch (e) {
      const message = e instanceof Error ? e.message : "批改失敗";
      setApiError(message);
      try {
        await syncDraftToFirestore({
          text: answerText,
          imageUrl:
            answerPreview && answerPreview.startsWith("http")
              ? answerPreview
              : null,
          status: "analyze_failed",
          errorMessage: message,
        });
      } catch {
        /* ignore secondary sync error */
      }
    } finally {
      setAnalyzing(false);
    }
  }, [
    question,
    answerText,
    answerFile,
    answerPreview,
    id,
    getPersistableImageUrl,
    syncDraftToFirestore,
  ]);

  const addFlashcards = useCallback(async () => {
    if (!analysis || !id) return;
    setFlashBusy(true);
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: id,
          subject: question?.subject ?? "",
          cards: analysis.flashcards,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "字卡寫入失敗");
      }
      showToast("已儲存字卡到 Firestore");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "字卡寫入失敗");
    } finally {
      setFlashBusy(false);
    }
  }, [analysis, id, question?.subject]);

  const saveAsNote = useCallback(async () => {
    if (!analysis || !question || !id) return;
    setNoteBusy(true);
    try {
      const normalizedAnswer = answerText.trim();
      const rawAnswerSection = normalizedAnswer
        ? normalizedAnswer
        : answerPreview
          ? "（本次作答未輸入文字，請參考上傳圖片作答）"
          : "（本次未填寫文字作答）";
      const body = [
        `【考題考點】\n- ${analysis.examKeyPoints.join("\n- ")}`,
        `【答案評語】\n${analysis.answerFeedback}`,
        `【補強建議】\n${analysis.improvementSuggestions}`,
        `【原始作答】\n${rawAnswerSection}`,
        `【複習字卡】\n${analysis.flashcards
          .map((card, idx) => `${idx + 1}. Q: ${card.front}\n   A: ${card.back}`)
          .join("\n")}`,
      ].join("\n\n");
      const response = await fetch("/api/study-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: makeNoteTitleFromQuestion(question.questionText),
          body,
          questionId: id,
          subject: question.subject,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "筆記儲存失敗");
      }
      showToast("已儲存筆記到 Firestore");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "筆記儲存失敗");
    } finally {
      setNoteBusy(false);
    }
  }, [analysis, question, id, answerText, answerPreview]);

  const answerWordCount = countWithoutWhitespace(answerText);
  const updateSelectedWordCount = useCallback(() => {
    const textarea = answerTextareaRef.current;
    if (!textarea) return;
    const selectedText = textarea.value.slice(
      textarea.selectionStart,
      textarea.selectionEnd
    );
    setSelectedWordCount(countWithoutWhitespace(selectedText));
  }, []);

  if (loadError && !question) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-stone-700">{loadError}</p>
        <Link href="/" className="mt-6 inline-block text-sm text-stone-900 underline">
          返回練習大廳
        </Link>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-sm text-stone-500">
        載入題目中…
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
      <div className="border-b border-stone-200 bg-[#faf8f5]/90 px-6 py-3 backdrop-blur">
        <Link href="/" className="text-sm text-stone-600 hover:text-stone-900">
          ← 練習大廳
        </Link>
      </div>
      <section className="border-b border-stone-200 bg-[#fffdf8] px-6 py-5">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
            {question.subject}
          </span>
          <span>{question.year} 年</span>
        </div>
        <h1 className="font-serif text-xl font-semibold text-stone-900">題目</h1>
        <article className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
          {question.questionText}
        </article>
        {question.imageUrl && (
          <div className="relative mt-4 aspect-video w-full max-w-xl overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
            <Image
              src={question.imageUrl}
              alt="題目附圖"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        )}
      </section>

      <div className="grid flex-1 grid-cols-1 xl:grid-cols-2 xl:divide-x xl:divide-stone-200">
        <section className="flex min-w-0 flex-col bg-[#f4f1eb] p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-semibold text-stone-900">作答</h2>
            <div className="text-right text-xs text-stone-600">
              <p>作答時間：{formatDuration(elapsedSeconds)}</p>
              <div className="mt-1 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setTimerRunning(true)}
                  disabled={timerRunning}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  開始
                </button>
                <button
                  type="button"
                  onClick={() => setTimerRunning(false)}
                  disabled={!timerRunning}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  暫停
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTimerRunning(false);
                    setElapsedSeconds(0);
                  }}
                  disabled={!timerRunning && elapsedSeconds === 0}
                  className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  重來
                </button>
              </div>
            </div>
          </div>

          <textarea
            ref={answerTextareaRef}
            className="mt-4 min-h-[420px] w-full overflow-y-auto rounded-xl border border-stone-300 bg-white/95 p-4 text-sm leading-relaxed text-stone-900 shadow-inner outline-none ring-stone-400 focus:ring-2"
            placeholder="在此輸入申論草稿..."
            value={answerText}
            onChange={(e) => {
              setAnswerText(e.target.value);
              const selectedText = e.target.value.slice(
                e.target.selectionStart,
                e.target.selectionEnd
              );
              setSelectedWordCount(countWithoutWhitespace(selectedText));
            }}
            onSelect={updateSelectedWordCount}
            onKeyDownCapture={(e) => {
              const key = e.key.toLowerCase();
              if ((e.ctrlKey || e.metaKey) && key === "s") {
                e.preventDefault();
                e.stopPropagation();
                if (!analyzing) {
                  void saveDraft();
                }
                return;
              }
              if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
                e.stopPropagation();
              }
            }}
            disabled={analyzing}
          />
          <p className="mt-2 text-xs text-stone-600">
            總計字數｜{answerWordCount}　選取範圍｜{selectedWordCount}
          </p>

          <div className="mt-4">
            <label className="text-sm font-medium text-stone-700">
              手寫答案圖片（選填）
            </label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm text-stone-600"
              disabled={analyzing}
              onChange={(e) => setAnswerFile(e.target.files?.[0] ?? null)}
            />
            {answerPreview && (
              <div className="relative mt-3 h-40 w-full max-w-md overflow-hidden rounded-lg border border-stone-200 bg-white">
                <Image
                  src={answerPreview}
                  alt="作答預覽"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={analyzing}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              草稿儲存
            </button>
            <button
              type="button"
              onClick={() => void submitAnalyze()}
              disabled={analyzing}
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
            >
              {analyzing ? "AI 批改中…" : "正式送出批改"}
            </button>
          </div>
          {draftSavedAt && (
            <p className="mt-2 text-xs text-stone-500">上次草稿時間：{draftSavedAt}</p>
          )}
          {apiError && (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {apiError}
            </p>
          )}
        </section>

        <section className="flex min-w-0 flex-col border-t border-stone-200 bg-[#faf8f5] p-6 xl:border-t-0">
          <h2 className="font-serif text-xl font-semibold text-stone-900">批改</h2>

          {analyzing && (
            <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-white/60 py-12">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
              <p className="mt-4 text-sm font-medium text-stone-700">Gemini 正在閱卷…</p>
              <p className="mt-1 max-w-sm text-center text-xs text-stone-500">
                若含手寫圖片，會先進行 OCR 再產出結構化評論與複習字卡。
              </p>
            </div>
          )}

          {!analyzing && !analysis && (
            <div className="mt-6 rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm text-stone-600">
              送出批改後，這裡會顯示考題考點、答案評語、補強建議與複習字卡。
            </div>
          )}

          {analysis && !analyzing && (
            <div className="mt-6 space-y-6 rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void addFlashcards()}
                  disabled={flashBusy}
                  className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                >
                  {flashBusy ? "寫入中…" : "轉為字卡"}
                </button>
                <button
                  type="button"
                  onClick={() => void saveAsNote()}
                  disabled={noteBusy}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60"
                >
                  {noteBusy ? "儲存中…" : "儲存為筆記"}
                </button>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  考題考點
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-800">
                  {analysis.examKeyPoints.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </div>
              <Block title="答案評語" body={analysis.answerFeedback} />
              <Block title="補強建議" body={analysis.improvementSuggestions} />
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  複習字卡
                </h3>
                <ul className="mt-2 space-y-2 text-sm text-stone-800">
                  {analysis.flashcards.map((card) => (
                    <li
                      key={`${card.front}-${card.back}`}
                      className="rounded-lg border border-stone-200 bg-white p-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                        Q
                      </p>
                      <p className="mt-1 font-medium text-stone-900">{card.front}</p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        A
                      </p>
                      <p className="mt-1 text-stone-800">{card.back}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
        {body}
      </p>
    </div>
  );
}
