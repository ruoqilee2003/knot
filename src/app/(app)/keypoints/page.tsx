"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type KeyPointItem = {
  questionId: string;
  subject: string;
  questionText: string;
  keyPoints: string[];
  analyzedAt: string | null;
};

export default function KeyPointsPage() {
  const [items, setItems] = useState<KeyPointItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/keypoints", { method: "GET" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "讀取考題重點失敗");
        }
        const data = (await response.json()) as KeyPointItem[];
        if (!cancelled) setItems(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "讀取考題重點失敗");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subjects = useMemo(() => {
    return Array.from(
      new Set(items.map((item) => item.subject.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [items]);

  const visibleItems = useMemo(() => {
    if (subjectFilter === "all") return items;
    return items.filter((item) => item.subject === subjectFilter);
  }, [items, subjectFilter]);

  const totalPoints = useMemo(
    () => visibleItems.reduce((sum, item) => sum + item.keyPoints.length, 0),
    [visibleItems]
  );

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">速讀重點</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
        考題重點速讀
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
        彙整所有批改結果的考題重點，通勤時往下滑就能快速過一遍。
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
        {!loading && !error && (
          <p className="text-sm text-stone-500">
            共 {visibleItems.length} 題、{totalPoints} 條重點
          </p>
        )}
      </div>

      {error && (
        <div
          className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="mt-16 text-center text-sm text-stone-500">
          讀取考題重點中…
        </div>
      )}

      {!loading && !error && visibleItems.length === 0 && (
        <p className="mt-16 text-center text-sm text-stone-500">
          目前沒有批改過的題目，先去作答並批改後再回來看看。
        </p>
      )}

      <ul className="mt-8 space-y-4">
        {visibleItems.map((item) => (
          <li
            key={item.questionId}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {item.subject && (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                    {item.subject}
                  </span>
                )}
                {item.analyzedAt && (
                  <span className="text-xs text-stone-400">
                    {new Date(item.analyzedAt).toLocaleDateString("zh-TW")} 批改
                  </span>
                )}
              </div>
              <Link
                href={`/practice/${item.questionId}`}
                className="text-xs text-stone-500 underline hover:text-stone-800"
              >
                檢視原題
              </Link>
            </div>

            {item.questionText && (
              <p className="mt-3 line-clamp-2 text-sm text-stone-500">
                {item.questionText}
              </p>
            )}

            <ul className="mt-3 space-y-2">
              {item.keyPoints.map((point, idx) => (
                <li key={idx} className="flex gap-2 text-sm leading-relaxed">
                  <span className="mt-0.5 shrink-0 text-amber-600">◆</span>
                  <span className="text-stone-800">{point}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
