"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseStorage } from "@/lib/firebase";
import type { AnalysisResult } from "@/types/analysis";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  parseKeywordInput,
  sanitizeKeyword,
} from "@/lib/keywords";
import {
  isPersistableImageUrl,
  normalizeLocalImagePath,
} from "@/lib/local-image";

type Question = {
  subject: string;
  year: number;
  score: number;
  questionText: string;
  imageUrl: string | null;
  archived: boolean;
};

type PersonalNote = {
  id: string;
  body: string;
  keywordDisplay: string[];
};

type DraftSyncPayload = {
  text: string;
  imageUrl: string | null;
  status:
    | "draft"
    | "completed"
    | "analyzed"
    | "analyze_failed"
    | "flashcards_ready";
  errorMessage?: string | null;
  analysis?: AnalysisResult;
  keywords: string[];
  keywordDisplay: string[];
  clearAnalysis?: boolean;
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
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordOptions, setKeywordOptions] = useState<string[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [answerImagePath, setAnswerImagePath] = useState("");
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [remoteImageUrl, setRemoteImageUrl] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [flashBusy, setFlashBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [personalNoteText, setPersonalNoteText] = useState("");
  const [personalNoteBusy, setPersonalNoteBusy] = useState(false);
  const [addingPersonalNote, setAddingPersonalNote] = useState(false);
  const [personalNotes, setPersonalNotes] = useState<PersonalNote[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [attemptStatus, setAttemptStatus] = useState<
    "draft" | "completed" | "analyzed" | "analyze_failed" | "flashcards_ready"
  >("draft");
  // 已完成/已批改的題目預設唯讀，避免回顧時誤改內容
  const [readOnly, setReadOnly] = useState(false);
  const [clearTarget, setClearTarget] = useState<
    "analysis" | "flashcards" | null
  >(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedWordCount, setSelectedWordCount] = useState(0);
  const answerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initialLoadedRef = useRef(false);
  const lastSyncedSnapshotRef = useRef("");
  const busyMessage = "系統忙碌中，請再試一次";
  const attemptStatusTextMap: Record<
    "draft" | "completed" | "analyzed" | "analyze_failed" | "flashcards_ready",
    string
  > = {
    draft: "暫存中",
    completed: "已完成",
    analyzed: "已批改",
    analyze_failed: "批改失敗",
    flashcards_ready: "已生成字卡",
  };

  const normalizedAnswerImagePath = useMemo(
    () => normalizeLocalImagePath(answerImagePath),
    [answerImagePath]
  );
  const displayPreview =
    filePreviewUrl ?? normalizedAnswerImagePath ?? remoteImageUrl;

  useEffect(() => {
    if (!answerFile) {
      setFilePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(answerFile);
    setFilePreviewUrl(url);
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
          score: Number(d.score ?? 100),
          questionText: String(d.questionText ?? d.title ?? ""),
          imageUrl: d.imageUrl ? String(d.imageUrl) : null,
          archived: d.archived === true,
        });
        if (d.archived === true) {
          setReadOnly(true);
        }
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
        const response = await fetch(`/api/attempts/${id}`, { method: "GET" });
        if (response.ok) {
          const parsed = (await response.json()) as {
            text?: string;
            imageUrl?: string | null;
            analysis?: AnalysisResult;
            status?:
              | "draft"
              | "completed"
              | "analyzed"
              | "analyze_failed"
              | "flashcards_ready";
            keywords?: string[];
            keywordDisplay?: string[];
          };
          if (cancelled) return;
          if (typeof parsed.text === "string") setAnswerText(parsed.text);
          if (typeof parsed.imageUrl === "string" && parsed.imageUrl) {
            if (parsed.imageUrl.startsWith("/")) {
              setAnswerImagePath(parsed.imageUrl);
            } else if (parsed.imageUrl.startsWith("http")) {
              setRemoteImageUrl(parsed.imageUrl);
            }
          }
          if (parsed.analysis) setAnalysis(parsed.analysis);
          if (parsed.status) {
            setAttemptStatus(parsed.status);
            if (
              parsed.status === "completed" ||
              parsed.status === "analyzed" ||
              parsed.status === "flashcards_ready"
            ) {
              setReadOnly(true);
            }
          }
          const nextKeywords = dedupeKeywordsCaseInsensitive(
            Array.isArray(parsed.keywordDisplay)
              ? parsed.keywordDisplay
              : parsed.keywords ?? []
          );
          setKeywords(nextKeywords);
          setKeywordInput("");
          lastSyncedSnapshotRef.current = JSON.stringify({
            text: typeof parsed.text === "string" ? parsed.text : "",
            keywords: nextKeywords,
          });
          initialLoadedRef.current = true;
          return;
        }
      } catch {
        /* ignore and fallback to local */
      }

      try {
        const raw = localStorage.getItem(draftKey(id));
        if (!raw || cancelled) {
          initialLoadedRef.current = true;
          return;
        }
        const parsed = JSON.parse(raw) as {
          text?: string;
          imageUrl?: string | null;
        };
        if (typeof parsed.text === "string") setAnswerText(parsed.text);
        if (typeof parsed.imageUrl === "string" && parsed.imageUrl) {
          if (parsed.imageUrl.startsWith("/")) {
            setAnswerImagePath(parsed.imageUrl);
          } else if (parsed.imageUrl.startsWith("http")) {
            setRemoteImageUrl(parsed.imageUrl);
          }
        }
      } catch {
        /* ignore */
      }
      initialLoadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/personal-notes?questionId=${encodeURIComponent(id)}`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<Record<string, unknown>>;
        if (cancelled) return;
        const notes = data.map((item) => ({
          id: String(item.id ?? ""),
          body: String(item.body ?? ""),
          keywordDisplay: Array.isArray(item.keywordDisplay)
            ? item.keywordDisplay.map((keyword) => String(keyword))
            : [],
        }));
        setPersonalNotes(notes);
      } catch {
        /* ignore personal note load errors */
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

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setKeywordLoading(true);
        const params = new URLSearchParams();
        if (keywordInput.trim()) {
          params.set("query", keywordInput.trim());
        }
        params.set("limit", "30");
        const response = await fetch(`/api/keywords?${params.toString()}`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<{ keyword?: string }>;
        if (cancelled) return;
        const options = data
          .map((item) => sanitizeKeyword(String(item.keyword ?? "")))
          .filter(Boolean);
        setKeywordOptions(dedupeKeywordsCaseInsensitive(options));
      } finally {
        if (!cancelled) setKeywordLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keywordInput]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const ensureKeywordCollection = useCallback(async (items: string[]) => {
    if (items.length === 0) return;
    await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: items }),
    });
  }, []);

  const mergeKeywords = useCallback((base: string[], extra: string[]) => {
    return dedupeKeywordsCaseInsensitive([...base, ...extra]);
  }, []);

  const applyPendingKeywords = useCallback(() => {
    const pending = parseKeywordInput(keywordInput);
    const merged = mergeKeywords(keywords, pending);
    setKeywords(merged);
    setKeywordInput("");
    return merged;
  }, [keywordInput, keywords, mergeKeywords]);

  const addSingleKeyword = useCallback(
    async (value: string) => {
      const nextKeyword = sanitizeKeyword(value);
      if (!nextKeyword) return;
      const exists = keywords.some(
        (item) => normalizeKeyword(item) === normalizeKeyword(nextKeyword)
      );
      if (exists) {
        setKeywordInput("");
        return;
      }
      const merged = mergeKeywords(keywords, [nextKeyword]);
      setKeywords(merged);
      setKeywordInput("");
      void ensureKeywordCollection([nextKeyword]);
    },
    [ensureKeywordCollection, keywords, mergeKeywords]
  );

  const removeKeyword = useCallback((value: string) => {
    setKeywords((prev) => prev.filter((item) => item !== value));
  }, []);

  // 建議關鍵字：既有關鍵字扣掉已選的，最多顯示 12 個
  const suggestedKeywords = useMemo(() => {
    return keywordOptions
      .filter(
        (item) =>
          !keywords.some(
            (chosen) => normalizeKeyword(chosen) === normalizeKeyword(item)
          )
      )
      .slice(0, 12);
  }, [keywordOptions, keywords]);

  const savePersonalNote = useCallback(async () => {
    if (!id || !question) return;
    const body = personalNoteText.trim();
    if (!body) {
      setApiError("請先輸入重點筆記內容");
      return;
    }

    setApiError(null);
    setPersonalNoteBusy(true);
    try {
      const payloadKeywords = mergeKeywords(keywords, parseKeywordInput(keywordInput));
      const response = await fetch("/api/personal-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          questionId: id,
          subject: question.subject,
          keywords: payloadKeywords,
          keywordDisplay: payloadKeywords,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; id?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "儲存重點筆記失敗");
      }
      setPersonalNotes((prev) => [
        {
          id: String(payload?.id ?? crypto.randomUUID()),
          body,
          keywordDisplay: payloadKeywords,
        },
        ...prev,
      ]);
      setPersonalNoteText("");
      setAddingPersonalNote(false);
      showToast("已儲存重點筆記");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "儲存重點筆記失敗");
    } finally {
      setPersonalNoteBusy(false);
    }
  }, [id, question, personalNoteText, mergeKeywords, keywords, keywordInput]);

  const getPersistableImageUrl = useCallback(async () => {
    const local = normalizeLocalImagePath(answerImagePath);
    if (local) return local;
    if (answerFile) {
      const storage = getFirebaseStorage();
      const path = `drafts/${id}/${crypto.randomUUID()}_${answerFile.name.replace(/[^\w.\-]/g, "_")}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, answerFile);
      return await getDownloadURL(storageRef);
    }
    if (isPersistableImageUrl(remoteImageUrl)) {
      return remoteImageUrl;
    }
    return null;
  }, [id, answerFile, answerImagePath, remoteImageUrl]);

  const getDraftImageUrl = useCallback(() => {
    return normalizedAnswerImagePath ?? remoteImageUrl;
  }, [normalizedAnswerImagePath, remoteImageUrl]);

  const syncDraftToFirestore = useCallback(
    async (payload: DraftSyncPayload) => {
      const response = await fetch(`/api/attempts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; status?: DraftSyncPayload["status"] }
        | null;
      if (!response.ok) {
        throw new Error(data?.error || "Firestore 同步失敗");
      }
      lastSyncedSnapshotRef.current = JSON.stringify({
        text: payload.text,
        keywords: payload.keywordDisplay,
      });
      // 伺服器有狀態防護（有批改結果時不會降回 draft/completed），以回傳值為準
      return data?.status ?? payload.status;
    },
    [id]
  );

  // 草稿自動儲存：本機（0.8 秒）+ Firestore（4 秒），沿用目前狀態避免覆蓋批改結果
  useEffect(() => {
    if (!id || !initialLoadedRef.current || readOnly) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        draftKey(id),
        JSON.stringify({
          text: answerText,
          imageUrl: getDraftImageUrl(),
        })
      );
    }, 800);
    return () => window.clearTimeout(timer);
  }, [id, answerText, getDraftImageUrl, readOnly]);

  useEffect(() => {
    if (!id || !initialLoadedRef.current || analyzing || readOnly) return;
    const snapshot = JSON.stringify({ text: answerText, keywords });
    if (snapshot === lastSyncedSnapshotRef.current) return;
    const timer = window.setTimeout(async () => {
      try {
        await syncDraftToFirestore({
          text: answerText,
          imageUrl: getDraftImageUrl(),
          status: attemptStatus,
          errorMessage: null,
          keywords,
          keywordDisplay: keywords,
        });
        setDraftSavedAt(new Date().toLocaleString());
      } catch {
        /* 自動儲存失敗保持安靜，手動儲存時才顯示錯誤 */
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [
    id,
    answerText,
    keywords,
    attemptStatus,
    analyzing,
    getDraftImageUrl,
    readOnly,
    syncDraftToFirestore,
  ]);

  const saveDraft = useCallback(async () => {
    if (!id) return;
    setApiError(null);
    try {
      const imageUrl = await getPersistableImageUrl();
      const normalizedKeywords = applyPendingKeywords();
      const payload = { text: answerText, imageUrl };
      localStorage.setItem(draftKey(id), JSON.stringify(payload));

      const savedStatus = await syncDraftToFirestore({
        ...payload,
        status: "draft",
        errorMessage: null,
        keywords: normalizedKeywords,
        keywordDisplay: normalizedKeywords,
      });

      setDraftSavedAt(new Date().toLocaleString());
      setKeywords(normalizedKeywords);
      await ensureKeywordCollection(normalizedKeywords);
      setAttemptStatus(savedStatus);
      showToast("草稿已儲存");
    } catch (e) {
      setApiError(
        e instanceof Error
          ? `${e.message}（本機草稿仍已儲存）`
          : "草稿儲存失敗（本機草稿仍已儲存）"
      );
    }
  }, [
    id,
    answerText,
    applyPendingKeywords,
    ensureKeywordCollection,
    getPersistableImageUrl,
    syncDraftToFirestore,
  ]);

  const markCompleted = useCallback(async () => {
    if (!id) return;
    setApiError(null);
    try {
      const imageUrl = await getPersistableImageUrl();
      const normalizedKeywords = applyPendingKeywords();
      const savedStatus = await syncDraftToFirestore({
        text: answerText,
        imageUrl,
        status: "completed",
        errorMessage: null,
        keywords: normalizedKeywords,
        keywordDisplay: normalizedKeywords,
      });
      setKeywords(normalizedKeywords);
      await ensureKeywordCollection(normalizedKeywords);
      setAttemptStatus(savedStatus);
      showToast("已標記完成（仍可繼續修改）");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "標記完成失敗");
    }
  }, [
    id,
    answerText,
    applyPendingKeywords,
    ensureKeywordCollection,
    getPersistableImageUrl,
    syncDraftToFirestore,
  ]);

  const submitAnalyze = useCallback(async () => {
    if (!question || !id) return;
    const hasText = answerText.trim().length > 0;
    const hasFile = !!answerFile;
    const localAnswerImage = normalizeLocalImagePath(answerImagePath);
    if (!hasText && !hasFile && !localAnswerImage) {
      setApiError("請輸入文字、填寫作答附圖路徑，或上傳手寫答案圖片");
      return;
    }
    setApiError(null);
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const imageUrl = await getPersistableImageUrl();
      const normalizedKeywords = applyPendingKeywords();
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
          answerImageUrl: localAnswerImage ?? undefined,
          answerImageBase64,
          answerImageMimeType,
          subject: question.subject,
          year: question.year,
          score: question.score,
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
        keywords: normalizedKeywords,
        keywordDisplay: normalizedKeywords,
      });
      setKeywords(normalizedKeywords);
      await ensureKeywordCollection(normalizedKeywords);
      setAttemptStatus("analyzed");
      showToast("批改完成");
    } catch (e) {
      const message = e instanceof Error ? e.message : "批改失敗";
      setApiError(message);
      try {
        await syncDraftToFirestore({
          text: answerText,
          imageUrl:
            (await getPersistableImageUrl()) ?? getDraftImageUrl(),
          status: "analyze_failed",
          errorMessage: message,
          keywords: mergeKeywords(keywords, parseKeywordInput(keywordInput)),
          keywordDisplay: mergeKeywords(keywords, parseKeywordInput(keywordInput)),
        });
      } catch {
        /* ignore secondary sync error */
      }
      setAttemptStatus("analyze_failed");
    } finally {
      setAnalyzing(false);
    }
  }, [
    question,
    answerText,
    answerFile,
    answerImagePath,
    id,
    applyPendingKeywords,
    ensureKeywordCollection,
    mergeKeywords,
    keywords,
    keywordInput,
    getPersistableImageUrl,
    getDraftImageUrl,
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
          attemptId: id,
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
      await syncDraftToFirestore({
        text: answerText,
        imageUrl: getDraftImageUrl(),
        status: "flashcards_ready",
        errorMessage: null,
        analysis,
        keywords: mergeKeywords(keywords, parseKeywordInput(keywordInput)),
        keywordDisplay: mergeKeywords(keywords, parseKeywordInput(keywordInput)),
      });
      setAttemptStatus("flashcards_ready");
      showToast("已儲存字卡到 Firestore");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "字卡寫入失敗");
    } finally {
      setFlashBusy(false);
    }
  }, [
    analysis,
    id,
    question?.subject,
    answerText,
    getDraftImageUrl,
    mergeKeywords,
    keywords,
    keywordInput,
    syncDraftToFirestore,
  ]);

  const clearAnalysisResult = useCallback(async () => {
    if (!id) return;
    setClearBusy(true);
    setApiError(null);
    try {
      await syncDraftToFirestore({
        text: answerText,
        imageUrl: getDraftImageUrl(),
        status: "completed",
        errorMessage: null,
        keywords,
        keywordDisplay: keywords,
        clearAnalysis: true,
      });
      setAnalysis(null);
      setAttemptStatus("completed");
      setClearTarget(null);
      showToast("已清除批改結果");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "清除批改結果失敗");
    } finally {
      setClearBusy(false);
    }
  }, [id, answerText, getDraftImageUrl, keywords, syncDraftToFirestore]);

  const clearQuestionFlashcards = useCallback(async () => {
    if (!id) return;
    setClearBusy(true);
    setApiError(null);
    try {
      const response = await fetch(
        `/api/flashcards?questionId=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; deleted?: number }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "清除字卡失敗");
      }
      const deleted = Number(payload?.deleted ?? 0);
      if (attemptStatus === "flashcards_ready") {
        const nextStatus = analysis ? "analyzed" : "completed";
        await syncDraftToFirestore({
          text: answerText,
          imageUrl: getDraftImageUrl(),
          status: nextStatus,
          errorMessage: null,
          keywords,
          keywordDisplay: keywords,
        });
        setAttemptStatus(nextStatus);
      }
      setClearTarget(null);
      showToast(deleted > 0 ? `已刪除 ${deleted} 張字卡` : "此題目前沒有字卡");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "清除字卡失敗");
    } finally {
      setClearBusy(false);
    }
  }, [
    id,
    attemptStatus,
    analysis,
    answerText,
    getDraftImageUrl,
    keywords,
    syncDraftToFirestore,
  ]);

  const saveAsNote = useCallback(async () => {
    if (!analysis || !question || !id) return;
    setNoteBusy(true);
    try {
      const normalizedAnswer = answerText.trim();
      const rawAnswerSection = normalizedAnswer
        ? normalizedAnswer
        : displayPreview
          ? "（本次作答未輸入文字，請參考附圖作答）"
          : "（本次未填寫文字作答）";
      const sections = [`【考題重點】\n- ${analysis.examKeyPoints.join("\n- ")}`];
      if (analysis.answerFeedback) {
        sections.push(`【答案評語】\n${analysis.answerFeedback}`);
      }
      if (analysis.improvementSuggestions) {
        sections.push(`【補強建議】\n${analysis.improvementSuggestions}`);
      }
      sections.push(
        `【原始作答】\n${rawAnswerSection}`,
        `【複習字卡】\n${analysis.flashcards
          .map((card, idx) => `${idx + 1}. Q: ${card.front}\n   A: ${card.back}`)
          .join("\n")}`
      );
      const body = sections.join("\n\n");
      const response = await fetch("/api/study-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: makeNoteTitleFromQuestion(question.questionText),
          body,
          questionId: id,
          attemptId: id,
          subject: question.subject,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "解答批改儲存失敗");
      }
      showToast("已儲存解答批改到 Firestore");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "解答批改儲存失敗");
    } finally {
      setNoteBusy(false);
    }
  }, [analysis, question, id, answerText, displayPreview]);

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
      {question.archived && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
          此題已封存，僅供查閱。若要繼續練習，請至
          <Link href="/" className="mx-1 font-medium underline">
            練習大廳
          </Link>
          還原封存題庫。
        </div>
      )}
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
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl font-semibold text-stone-900">作答</h2>
                {readOnly && (
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">
                    檢視模式
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-stone-600">
                狀態：{attemptStatusTextMap[attemptStatus]}
              </p>
            </div>
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

          <div className="mt-4">
            <label className="text-sm font-medium text-stone-700">
              關鍵字（可新建，也可選擇既有關鍵字）
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => {
                  setKeywordInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === "，") {
                    e.preventDefault();
                    void addSingleKeyword(keywordInput);
                  }
                }}
                placeholder="#DDoS"
                className="min-w-[220px] flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2 disabled:bg-stone-100"
                disabled={analyzing || readOnly}
              />
              <button
                type="button"
                onClick={() => void addSingleKeyword(keywordInput)}
                disabled={analyzing || readOnly || !keywordInput.trim()}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                新增關鍵字
              </button>
            </div>
            {!readOnly && keywordInput.trim() && suggestedKeywords.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-stone-500">
                  符合的既有關鍵字
                  {keywordLoading && "（讀取中…）"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {suggestedKeywords.map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => void addSingleKeyword(item)}
                      disabled={analyzing}
                      className="rounded-full border border-dashed border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-600 transition hover:border-stone-500 hover:bg-stone-50 hover:text-stone-900 disabled:opacity-50"
                    >
                      + #{item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {keywords.map((item) =>
                  readOnly ? (
                    <span
                      key={item}
                      className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700"
                    >
                      #{item}
                    </span>
                  ) : (
                    <button
                      type="button"
                      key={item}
                      onClick={() => removeKeyword(item)}
                      className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-300"
                    >
                      #{item} ×
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          <textarea
            ref={answerTextareaRef}
            className={`mt-4 min-h-[420px] w-full overflow-y-auto rounded-xl border border-stone-300 p-4 text-sm leading-relaxed text-stone-900 shadow-inner outline-none ring-stone-400 focus:ring-2 ${
              readOnly ? "bg-stone-50" : "bg-white/95"
            }`}
            placeholder="在此輸入申論草稿..."
            value={answerText}
            readOnly={readOnly}
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
                if (!analyzing && !readOnly) {
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
              作答附圖（選填，本機 ERD / 架構圖）
            </label>
            <input
              type="text"
              value={answerImagePath}
              onChange={(e) => setAnswerImagePath(e.target.value)}
              placeholder="例如：/answer-images/db-2026-erd.png"
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2 disabled:bg-stone-100"
              disabled={analyzing || readOnly}
            />
            <p className="mt-1 text-xs text-stone-500">
              把圖片放進專案的 public/answer-images/ 資料夾後填入路徑。AI 批改時會讀取這張圖（不需 Firebase Storage）。
            </p>
            {displayPreview && !filePreviewUrl && (
              <div className="relative mt-3 h-48 w-full max-w-md overflow-hidden rounded-lg border border-stone-200 bg-white">
                <Image
                  src={displayPreview}
                  alt="作答附圖預覽"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            )}
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-stone-700">
              手寫答案圖片（選填）
            </label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm text-stone-600 disabled:opacity-50"
              disabled={analyzing || readOnly}
              onChange={(e) => setAnswerFile(e.target.files?.[0] ?? null)}
            />
            {filePreviewUrl && (
              <div className="relative mt-3 h-40 w-full max-w-md overflow-hidden rounded-lg border border-stone-200 bg-white">
                <Image
                  src={filePreviewUrl}
                  alt="手寫答案預覽"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            )}
          </div>

          {readOnly ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white/80 px-4 py-3">
              <p className="text-sm text-stone-600">
                目前為檢視模式，內容唯讀，可安心回顧不怕誤改。
              </p>
              <button
                type="button"
                onClick={() => setReadOnly(false)}
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
              >
                編輯作答
              </button>
            </div>
          ) : (
          <div className="mt-4 grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={analyzing}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              暫存
            </button>
            <button
              type="button"
              onClick={() => void markCompleted()}
              disabled={analyzing}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              完成
            </button>
            <button
              type="button"
              onClick={() => void submitAnalyze()}
              disabled={analyzing}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              {analyzing ? "AI 批改中…" : "批改"}
            </button>
            <button
              type="button"
              onClick={() => void addFlashcards()}
              disabled={analyzing || flashBusy || !analysis}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              {flashBusy ? "生成中…" : "字卡"}
            </button>
          </div>
          )}

          <div className="mt-3 rounded-xl border border-stone-200 bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-stone-700">重點筆記</label>
              {!addingPersonalNote ? (
                <button
                  type="button"
                  onClick={() => setAddingPersonalNote(true)}
                  disabled={analyzing}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  新增重點筆記
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingPersonalNote(false);
                      setPersonalNoteText("");
                    }}
                    disabled={personalNoteBusy}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void savePersonalNote()}
                    disabled={personalNoteBusy || analyzing}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                  >
                    {personalNoteBusy ? "儲存中…" : "儲存重點筆記"}
                  </button>
                </div>
              )}
            </div>
            {addingPersonalNote && (
              <textarea
                value={personalNoteText}
                onChange={(e) => setPersonalNoteText(e.target.value)}
                placeholder="例如：DDoS防禦口訣、題目常見陷阱、答題框架..."
                className="mt-2 min-h-[90px] w-full rounded-lg border border-stone-300 bg-white p-3 text-sm leading-relaxed text-stone-900 outline-none ring-stone-400 focus:ring-2"
                disabled={analyzing}
              />
            )}
            {personalNotes.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {personalNotes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-stone-200 bg-[#fffdf8] p-2">
                    {note.keywordDisplay.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1">
                        {note.keywordDisplay.map((item) => (
                          <span
                            key={`${note.id}-${item}`}
                            className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="line-clamp-3 whitespace-pre-wrap text-xs text-stone-700">
                      {note.body}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-stone-500">目前尚無重點筆記。</p>
            )}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-semibold text-stone-900">批改</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setClearTarget("analysis")}
                disabled={!analysis || analyzing || clearBusy}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                清除批改結果
              </button>
              <button
                type="button"
                onClick={() => setClearTarget("flashcards")}
                disabled={analyzing || clearBusy}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                清除此題字卡
              </button>
            </div>
          </div>

          <ConfirmDeleteDialog
            open={clearTarget === "analysis"}
            title="清除批改結果"
            description="會刪除這題儲存的考題重點與複習字卡建議（已另存的解答批改筆記與已寫入的字卡不受影響）。之後可以再按「批改」重新生成，確定要清除嗎？"
            confirmLabel="確認清除"
            busy={clearBusy}
            onCancel={() => setClearTarget(null)}
            onConfirm={() => {
              if (clearBusy) return;
              void clearAnalysisResult();
            }}
          />
          <ConfirmDeleteDialog
            open={clearTarget === "flashcards"}
            title="清除此題字卡"
            description="會刪除這一題寫入字卡庫的所有字卡（關鍵字卡總覽同步移除），此動作無法復原。之後可重新批改再生成新字卡，確定要清除嗎？"
            confirmLabel="確認清除"
            busy={clearBusy}
            onCancel={() => setClearTarget(null)}
            onConfirm={() => {
              if (clearBusy) return;
              void clearQuestionFlashcards();
            }}
          />

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
              送出批改後，這裡會顯示考題重點與複習字卡。
            </div>
          )}

          {analysis && !analyzing && (
            <div className="mt-6 space-y-6 rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveAsNote()}
                  disabled={noteBusy}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60"
                >
                  {noteBusy ? "儲存中…" : "儲存為解答批改"}
                </button>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  考題重點
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-800">
                  {analysis.examKeyPoints.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </div>
              {analysis.answerFeedback && (
                <Block title="答案評語" body={analysis.answerFeedback} />
              )}
              {analysis.improvementSuggestions && (
                <Block title="補強建議" body={analysis.improvementSuggestions} />
              )}
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
