"use client";

import { createPortal } from "react-dom";

type ConfirmDeleteDialogProps = {
  open: boolean;
  title?: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDeleteDialog({
  open,
  title = "確認刪除",
  description,
  confirmLabel = "刪除",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-stone-200 bg-[#fffdf8] p-6 shadow-2xl"
      >
        <h2 className="font-serif text-xl font-semibold text-stone-900">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {busy ? "刪除中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
