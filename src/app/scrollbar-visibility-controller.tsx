"use client";

import { useEffect } from "react";

const SCROLL_IDLE_MS = 700;

export default function ScrollbarVisibilityController() {
  useEffect(() => {
    const root = document.documentElement;
    let hideTimer: number | null = null;

    const showWhileScrolling = () => {
      root.classList.add("is-scrolling");

      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }

      hideTimer = window.setTimeout(() => {
        root.classList.remove("is-scrolling");
        hideTimer = null;
      }, SCROLL_IDLE_MS);
    };

    document.addEventListener("scroll", showWhileScrolling, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("scroll", showWhileScrolling, true);

      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
    };
  }, []);

  return null;
}
