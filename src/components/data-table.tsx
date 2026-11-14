"use client";

import { useEffect, useRef } from "react";

/**
 * Table that turns into labelled cards on phones (see `.stack-table` in globals.css).
 * After render it copies each column header onto that column's cells as `data-label`,
 * and marks the first column with a header as the card title (`data-primary`).
 */
export function StackTable({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = [...table.querySelectorAll("thead tr:last-child th")].map((th) => th.textContent?.trim() ?? "");
    const primary = heads.findIndex((h) => h !== "");
    table.querySelectorAll("tbody tr").forEach((tr) => {
      let col = 0;
      for (const td of tr.children) {
        if (!(td instanceof HTMLTableCellElement)) continue;
        if (td.colSpan > 1) {
          td.dataset.label = "";
        } else {
          td.dataset.label = heads[col] ?? "";
          if (col === primary) td.dataset.primary = "";
          else delete td.dataset.primary;
        }
        col += td.colSpan;
      }
    });
  });

  return (
    <table
      ref={ref}
      className="stack-table w-full text-sm md:[&_td]:border-t md:[&_td]:border-line md:[&_td]:p-3 [&_th]:bg-canvas [&_th]:p-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ink-3"
    >
      {children}
    </table>
  );
}
