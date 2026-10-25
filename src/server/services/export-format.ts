import ExcelJS from "exceljs";

export type Cell = string | number | null | undefined;
export interface Table { title: string; columns: string[]; rows: Cell[][] }

// A cell that starts with = + - @ (or a tab/CR) is run as a formula by Excel and LibreOffice. Item names, customer
// names and notes are typed by users, so they must never be able to carry =HYPERLINK(...) into someone's spreadsheet.
// Real numbers are left alone; only text is neutralised, by a leading apostrophe.
export function safeCell(v: Cell): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(t: Table): string {
  const esc = (v: Cell) => {
    const s = String(safeCell(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(t.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report");
  ws.addRow(t.columns).font = { bold: true };
  for (const r of t.rows) ws.addRow(r.map(safeCell));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns.forEach((c, i) => {
    const longest = Math.max(t.columns[i]?.length ?? 8, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
    c.width = Math.min(Math.max(longest + 2, 8), 50);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
