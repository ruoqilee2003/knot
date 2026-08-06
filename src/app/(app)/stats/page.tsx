"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  totals: {
    questions: number;
    completed: number;
    analyzed: number;
    flashcards: number;
    skeletonCards: number;
    flashcardReviews: number;
    skeletonReviews: number;
    quizQuestions: number;
    quizReviews: number;
    quizCorrect: number;
    quizWrong: number;
  };
  subjects: Array<{
    subject: string;
    total: number;
    completed: number;
    analyzed: number;
    flashcards: number;
    skeletonCards: number;
  }>;
  topActivity: Array<{ date: string; count: number }>;
  topKeywords: Array<{ keyword: string; usageCount: number }>;
};

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/stats", { method: "GET" });
        const payload = (await response.json().catch(() => null)) as
          | (Stats & { error?: string })
          | null;
        if (cancelled) return;
        if (!response.ok || !payload) {
          throw new Error(payload?.error || "讀取統計資料失敗");
        }
        setStats(payload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "讀取統計資料失敗");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxDailyCount = stats
    ? Math.max(1, ...stats.topActivity.map((day) => day.count))
    : 1;

  return (
    <div className="w-full px-4 py-8 md:px-6">
      <p className="text-sm font-medium text-stone-500">學習概況</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-stone-900">
        統計儀表板
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
        依題庫與作答紀錄彙整的整體進度、各科完成度與練習節奏。
      </p>

      {error && (
        <div
          className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}

      {!stats && !error && (
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-stone-200/80 bg-stone-100/70"
            />
          ))}
        </div>
      )}

      {stats && (
        <>
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryCard label="題目總數" value={stats.totals.questions} />
            <SummaryCard
              label="已完成"
              value={stats.totals.completed}
              hint={`${percent(stats.totals.completed, stats.totals.questions)}%`}
            />
            <SummaryCard
              label="已批改"
              value={stats.totals.analyzed}
              hint={`${percent(stats.totals.analyzed, stats.totals.questions)}%`}
            />
            <SummaryCard label="字卡總數" value={stats.totals.flashcards} />
            <SummaryCard label="骨架卡總數" value={stats.totals.skeletonCards} />
            <SummaryCard
              label="字卡複習次數"
              value={stats.totals.flashcardReviews}
            />
            <SummaryCard
              label="骨架複習次數"
              value={stats.totals.skeletonReviews}
            />
            <SummaryCard label="選擇題總數" value={stats.totals.quizQuestions} />
            <SummaryCard
              label="選擇題複習次數"
              value={stats.totals.quizReviews}
              hint={
                stats.totals.quizReviews > 0
                  ? `答對率 ${percent(stats.totals.quizCorrect, stats.totals.quizReviews)}%`
                  : undefined
              }
            />
          </div>

          <section className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              各科進度
            </h2>
            {stats.subjects.length === 0 ? (
              <p className="mt-4 text-sm text-stone-500">目前尚無題目。</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {stats.subjects.map((subject) => (
                  <li
                    key={subject.subject}
                    className="rounded-2xl border border-stone-200/80 bg-[#fffdf8] p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-stone-800">
                        {subject.subject}
                      </p>
                      <p className="text-xs text-stone-500">
                        共 {subject.total} 題・已完成 {subject.completed}・已批改{" "}
                        {subject.analyzed}・字卡 {subject.flashcards} 張・骨架卡{" "}
                        {subject.skeletonCards} 張
                      </p>
                    </div>
                    <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
                      <div className="relative h-full">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-emerald-300"
                          style={{
                            width: `${percent(subject.completed, subject.total)}%`,
                          }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-sky-400/80"
                          style={{
                            width: `${percent(subject.analyzed, subject.total)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-stone-500">
                      完成率 {percent(subject.completed, subject.total)}%・批改率{" "}
                      {percent(subject.analyzed, subject.total)}%
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              近期最活躍前 5 天
            </h2>
            <div className="mt-4 rounded-2xl border border-stone-200/80 bg-[#fffdf8] p-5 shadow-sm">
              {stats.topActivity.length === 0 ? (
                <p className="text-sm text-stone-500">尚無練習紀錄。</p>
              ) : (
                <>
                  <div className="flex h-36 items-end justify-center gap-6">
                    {stats.topActivity.map((day) => (
                      <div
                        key={day.date}
                        className="flex flex-col items-center gap-1"
                      >
                        <span className="text-xs text-stone-600">
                          {day.count}
                        </span>
                        <div
                          className="w-16 rounded-t-md bg-stone-700/80"
                          style={{
                            height: `${Math.max(
                              day.count > 0 ? 8 : 2,
                              (day.count / maxDailyCount) * 100
                            )}px`,
                          }}
                        />
                        <span className="text-[10px] text-stone-400">
                          {day.date}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-stone-500">
                    以作答紀錄與骨架卡的更新時間統計，顯示活動次數最多的前 5 天。
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              常用關鍵字
            </h2>
            {stats.topKeywords.length === 0 ? (
              <p className="mt-4 text-sm text-stone-500">尚無關鍵字紀錄。</p>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {stats.topKeywords.map((item) => (
                    <Link
                      key={item.keyword}
                      href={`/?keyword=${encodeURIComponent(item.keyword)}`}
                      className="rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-700 transition hover:bg-stone-900 hover:text-white"
                    >
                      #{item.keyword}
                      <span className="ml-1.5 text-xs opacity-60">
                        ×{item.usageCount}
                      </span>
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-xs text-stone-500">
                  點選關鍵字可跳到練習大廳查看相關題目。
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200/80 bg-[#fffdf8] p-5 shadow-sm">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold text-stone-900">
        {value}
        {hint && (
          <span className="ml-2 align-middle text-sm font-normal text-stone-400">
            {hint}
          </span>
        )}
      </p>
    </div>
  );
}
