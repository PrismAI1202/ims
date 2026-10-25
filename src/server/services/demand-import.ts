import ExcelJS from "exceljs";
import Papa from "papaparse";

export type DemandKind = "FORECAST" | "FIRM" | "SPOT";

export interface DemandRow {
  row: number; // spreadsheet row number (the header is row 1)
  customerCode: string; partCode: string; dueDate: Date; qty: number; type: DemandKind;
}
export interface RowError { row: number; message: string }

const HEADERS: Record<string, string[]> = {
  customer: ["customercode", "customer", "custcode", "customerid"],
  part: ["partcode", "part", "partno", "partnumber", "itemcode", "item", "material"],
  date: ["duedate", "date", "deliverydate", "requireddate", "needdate"],
  qty: ["qty", "quantity", "requiredqty", "orderqty"],
  type: ["type", "demandtype", "scheduletype", "ordertype"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function field(row: Record<string, unknown>, key: keyof typeof HEADERS): unknown {
  for (const [h, v] of Object.entries(row)) if (HEADERS[key].includes(norm(h))) return v;
  return undefined;
}

const MS_DAY = 86_400_000;

// Accepts real dates, Excel serial numbers, ISO (2026-11-30) and day-first text (30/11/2026, 30-11-2026, 30.11.2026).
// Day-first is deliberate: it is how Indian plants write dates, and a silent month/day swap would plan the wrong week.
export function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * MS_DAY);
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null; // rejects 31/02
}

function parseQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n < 1e9 ? n : null;
}

export function parseDemandRows(rows: Record<string, unknown>[]): { ok: DemandRow[]; errors: RowError[] } {
  const ok: DemandRow[] = [];
  const errors: RowError[] = [];
  rows.forEach((raw, i) => {
    const row = i + 2;
    if (Object.values(raw).every((v) => v === null || v === undefined || String(v).trim() === "")) return; // blank line

    const customer = String(field(raw, "customer") ?? "").trim().toUpperCase();
    const part = String(field(raw, "part") ?? "").trim().toUpperCase();
    const date = parseDate(field(raw, "date"));
    const qty = parseQty(field(raw, "qty"));
    const typeRaw = String(field(raw, "type") ?? "").trim().toUpperCase();
    const type = (typeRaw === "" ? "FIRM" : typeRaw) as DemandKind;

    const problems: string[] = [];
    if (!customer) problems.push("customer code is missing");
    if (!part) problems.push("part code is missing");
    if (!date) problems.push("due date is missing or not a valid date (use YYYY-MM-DD or DD/MM/YYYY)");
    if (qty === null) problems.push("quantity must be a whole number above 0");
    if (!["FORECAST", "FIRM", "SPOT"].includes(type)) problems.push(`type "${typeRaw}" must be FORECAST, FIRM or SPOT`);
    if (problems.length) errors.push({ row, message: problems.join("; ") });
    else ok.push({ row, customerCode: customer, partCode: part, dueDate: date!, qty: qty!, type });
  });
  return { ok, errors };
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

// Reads the first sheet of an .xlsx, or a .csv, into plain row objects keyed by the header row.
export async function readSpreadsheet(buffer: Buffer, fileName: string): Promise<Record<string, unknown>[]> {
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("File is larger than 5 MB.");
  const name = fileName.toLowerCase();

  let rows: Record<string, unknown>[];
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const parsed = Papa.parse<Record<string, unknown>>(buffer.toString("utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
    if (parsed.errors.some((e) => e.type === "Delimiter" || e.type === "Quotes")) throw new Error("The CSV could not be read. Check it is comma-separated.");
    rows = parsed.data;
  } else if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new Error("The Excel file could not be read. Save it as .xlsx and try again.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("The Excel file has no sheets.");
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? "").trim());
    rows = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const obj: Record<string, unknown> = {};
      header.forEach((h, idx) => {
        if (!h) return;
        let v = r.getCell(idx + 1).value as unknown;
        if (v && typeof v === "object" && !(v instanceof Date)) {
          const o = v as { result?: unknown; text?: unknown }; // formula cell or rich text
          v = o.result ?? o.text ?? "";
        }
        obj[h] = v;
      });
      rows.push(obj);
    });
  } else {
    throw new Error("Upload a .csv or .xlsx file.");
  }
  if (rows.length > MAX_ROWS) throw new Error(`Too many rows (limit ${MAX_ROWS.toLocaleString()}). Split the file.`);
  return rows;
}

export const DEMAND_TEMPLATE_CSV = [
  "customer_code,part_code,due_date,qty,type",
  "CUST-AUTO,FG-CLIP-001,2026-11-05,5000,FIRM",
  "CUST-AUTO,FG-CLIP-001,2026-11-26,8000,FORECAST",
  "CUST-IND,FG-CLIP-001,2026-11-12,1500,SPOT",
].join("\n") + "\n";
