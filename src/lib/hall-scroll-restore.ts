export const HALL_SCROLL_STORAGE_KEY = "knot:hall-scroll";

export type HallScrollState = {
  scrollTop: number;
  subjectFilter: string;
  keywordFilter: string;
  sortMode: "year-desc" | "year-asc" | "unfinished-first";
  archaeologyFilter?: "all" | "archaeology";
};

function usesMainScrollContainer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 768px)").matches;
}

export function getMainScrollEl(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("app-main-scroll");
}

export function readHallScrollState(): HallScrollState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HALL_SCROLL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HallScrollState>;
    if (typeof parsed.scrollTop !== "number" || !Number.isFinite(parsed.scrollTop)) {
      return null;
    }
    const sortMode = parsed.sortMode;
    const normalizedSortMode =
      sortMode === "year-desc" ||
      sortMode === "year-asc" ||
      sortMode === "unfinished-first"
        ? sortMode
        : "unfinished-first";
    const archaeologyFilter = parsed.archaeologyFilter;
    const normalizedArchaeologyFilter =
      archaeologyFilter === "archaeology" ? "archaeology" : "all";
    return {
      scrollTop: Math.max(0, parsed.scrollTop),
      subjectFilter:
        typeof parsed.subjectFilter === "string" ? parsed.subjectFilter : "all",
      keywordFilter:
        typeof parsed.keywordFilter === "string" ? parsed.keywordFilter : "",
      sortMode: normalizedSortMode,
      archaeologyFilter: normalizedArchaeologyFilter,
    };
  } catch {
    return null;
  }
}

export function getHallScrollTop(): number {
  if (usesMainScrollContainer()) {
    return getMainScrollEl()?.scrollTop ?? 0;
  }
  return window.scrollY;
}

export function saveHallScrollState(state: HallScrollState) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(HALL_SCROLL_STORAGE_KEY, JSON.stringify(state));
}

export function restoreHallScrollTop(scrollTop: number) {
  if (scrollTop <= 0) return;
  if (usesMainScrollContainer()) {
    const el = getMainScrollEl();
    if (el) el.scrollTop = scrollTop;
    return;
  }
  window.scrollTo(0, scrollTop);
}

export function bindHallScrollListener(onScroll: () => void): () => void {
  const el = getMainScrollEl();
  let timer: number | undefined;

  const handleScroll = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onScroll, 120);
  };

  if (usesMainScrollContainer() && el) {
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (timer != null) window.clearTimeout(timer);
    };
  }

  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => {
    window.removeEventListener("scroll", handleScroll);
    if (timer != null) window.clearTimeout(timer);
  };
}
