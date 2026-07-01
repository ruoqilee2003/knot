"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

const links = [
  { href: "/", label: "練習大廳" },
  { href: "/notes", label: "解答批改" },
  { href: "/flashcards", label: "關鍵字卡" },
  { href: "/keyword-notes", label: "重點筆記" },
];

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-[#faf8f5] md:h-screen md:w-52 md:border-b-0 md:border-r">
      <div className="border-b border-stone-200 px-4 py-4 md:px-5 md:py-6">
        <Link href="/" className="block">
          <span className="font-serif text-2xl font-semibold tracking-tight text-stone-900 md:text-3xl">
            Knot.
          </span>
        </Link>
      </div>
      <nav className="flex flex-1 gap-2 overflow-x-auto p-3 md:flex-col md:gap-1 md:overflow-x-visible">
        {links.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors md:whitespace-normal ${
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
      <div className="border-t border-stone-200 px-4 py-3">
        <p className="hidden text-xs leading-relaxed text-stone-500 md:block">
          草稿儲存在本機瀏覽器；正式送出由 Gemini 批改。
        </p>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
            router.refresh();
          }}
          className="mt-3 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
        >
          登出
        </button>
      </div>
    </aside>
  );
}
