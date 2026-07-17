"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

type TableEditorModalProps = {
  open: boolean;
  onCancel: () => void;
  onInsert: (markdown: string) => void;
};

const DEFAULT_GRID: string[][] = [
  ["項目", "A", "B"],
  ["", "", ""],
  ["", "", ""],
];

function escapeCell(value: string): string {
  return value.trim().replace(/\|/g, "\\|") || " ";
}

function gridToMarkdown(grid: string[][]): string {
  const [header, ...body] = grid;
  const separatorRow = header.map(() => "---");
  const rowToLine = (row: string[]) => `| ${row.map(escapeCell).join(" | ")} |`;
  const lines = [rowToLine(header), rowToLine(separatorRow), ...body.map(rowToLine)];
  return `${lines.join("\n")}\n`;
}

export function TableEditorModal({ open, onCancel, onInsert }: TableEditorModalProps) {
  const [grid, setGrid] = useState<string[][]>(DEFAULT_GRID);

  if (!open || typeof window === "undefined") return null;

  const columnCount = grid[0]?.length ?? 0;
  const rowCount = grid.length;

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    setGrid((prev) =>
      prev.map((row, r) =>
        r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row
      )
    );
  };

  const addColumn = () => {
    setGrid((prev) => prev.map((row) => [...row, ""]));
  };

  const removeColumn = () => {
    if (columnCount <= 2) return;
    setGrid((prev) => prev.map((row) => row.slice(0, -1)));
  };

  const addRow = () => {
    setGrid((prev) => [...prev, Array.from({ length: columnCount }, () => "")]);
  };

  const removeRow = () => {
    if (rowCount <= 2) return;
    setGrid((prev) => prev.slice(0, -1));
  };

  const handleInsert = () => {
    onInsert(gridToMarkdown(grid));
    setGrid(DEFAULT_GRID);
  };

  const handleCancel = () => {
    setGrid(DEFAULT_GRID);
    onCancel();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-[#fffdf8] p-6 shadow-2xl"
      >
        <h2 className="font-serif text-xl font-semibold text-stone-900">插入比較表格</h2>
        <p className="mt-1 text-xs text-stone-500">
          第一列是標題，直接在格子裡打字即可，不用手打 | 符號。
        </p>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={addColumn}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
          >
            ＋ 欄
          </button>
          <button
            type="button"
            onClick={removeColumn}
            disabled={columnCount <= 2}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
          >
            － 欄
          </button>
          <span className="mx-1 h-4 w-px bg-stone-300" />
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
          >
            ＋ 列
          </button>
          <button
            type="button"
            onClick={removeRow}
            disabled={rowCount <= 2}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
          >
            － 列
          </button>
        </div>

        <div className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-stone-200">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {grid.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, colIndex) => (
                    <td key={colIndex} className="border border-stone-200 p-0">
                      <input
                        type="text"
                        value={cell}
                        onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                        placeholder={rowIndex === 0 ? "標題" : ""}
                        className={`w-full min-w-[100px] px-2 py-1.5 text-stone-900 outline-none ring-inset ring-stone-400 focus:ring-2 ${
                          rowIndex === 0 ? "bg-stone-100 font-medium" : "bg-white"
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleInsert}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            插入表格
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
