"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

const links = [
  { href: "/", label: "練習大廳" },
  { href: "/notes", label: "解答批改" },
  { href: "/flashcards", label: "關鍵字卡" },
  { href: "/review", label: "字卡複習" },
  { href: "/quiz-review", label: "選擇題複習" },
  { href: "/skeleton-cards", label: "骨架卡" },
  { href: "/skeleton-review", label: "骨架複習" },
  { href: "/skeleton-mindmap", label: "骨架心智圖" },
  { href: "/keypoints", label: "速讀重點" },
  { href: "/keyword-notes", label: "重點筆記" },
  { href: "/common-subjects", label: "共同科目" },
  { href: "/stats", label: "統計儀表板" },
];

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeIndex = links.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  );
  const safeActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const prevItem = links[(safeActiveIndex - 1 + links.length) % links.length];
  const nextItem = links[(safeActiveIndex + 1) % links.length];
  const currentItem = links[safeActiveIndex];
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-[#faf8f5] md:h-screen md:w-52 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-4 md:block md:px-5 md:py-6">
        <Link href="/" className="block">
          <span className="font-serif text-2xl font-semibold tracking-tight text-stone-900 md:text-3xl">
            Knot.
          </span>
        </Link>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="rounded-md bg-transparent px-2 py-1 text-sm font-medium text-stone-700 hover:bg-stone-200/40 md:hidden"
        >
          登出
        </button>
      </div>
      <div className="px-3 pt-3 md:hidden">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 bg-transparent px-2 py-1.5">
          <Link
            href={prevItem.href}
            className="rounded-md bg-transparent px-2 py-1 text-sm text-stone-700 hover:bg-stone-200/40"
            aria-label={`切換到上一個頁面：${prevItem.label}`}
          >
            {"←"}
          </Link>
          <span className="text-center text-sm font-medium text-stone-700">
            {currentItem.label}
          </span>
          <Link
            href={nextItem.href}
            className="rounded-md bg-transparent px-2 py-1 text-sm text-stone-700 hover:bg-stone-200/40"
            aria-label={`切換到下一個頁面：${nextItem.label}`}
          >
            {"→"}
          </Link>
        </div>
      </div>
      <nav className="hidden flex-1 gap-2 overflow-x-auto p-3 md:flex md:flex-col md:gap-1 md:overflow-x-visible md:pt-3">
        {links.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`basis-[calc((100%-0.5rem)/2)] shrink-0 snap-start whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm transition-colors sm:basis-[calc((100%-1rem)/3)] md:basis-auto md:whitespace-normal ${
                active
                  ? "bg-stone-900 text-stone-50 shadow-sm"
                  : "text-stone-700 hover:bg-stone-200/60"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-stone-200 px-4 py-3 md:block">
        <p className="text-xs leading-relaxed text-stone-500">
          作答內容會自動儲存；正式送出由 Gemini 批改。
        </p>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-3 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
        >
          登出
        </button>
      </div>
    </aside>
  );
}
