import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEMAND_TEMPLATE_CSV, parseDate, parseDemandRows, readSpreadsheet } from "./demand-import";

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("parseDate", () => {
  it("reads ISO and day-first text", () => {
    expect(iso(parseDate("2026-11-05"))).toBe("2026-11-05");
    expect(iso(parseDate("05/11/2026"))).toBe("2026-11-05");
    expect(iso(parseDate("5-11-2026"))).toBe("2026-11-05");
    expect(iso(parseDate("05.11.2026"))).toBe("2026-11-05");
  });
  it("is day-first, so 03/04 is 3 April, never 4 March", () => expect(iso(parseDate("03/04/2026"))).toBe("2026-04-03"));
  it("reads Excel serial numbers and real Dates", () => {
    expect(iso(parseDate(46331))).toBe("2026-11-05"); // Excel serial for 5 Nov 2026
    expect(iso(parseDate(new Date("2026-11-05T18:30:00Z")))).toBe("2026-11-05");
  });
  it("rejects impossible or unreadable dates", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("next week")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(5)).toBeNull();
  });
});

describe("parseDemandRows", () => {
  it("accepts flexible headers and tidies codes", () => {
    const { ok, errors } = parseDemandRows([{ "Customer Code": " cust-auto ", "Part No": "fg-clip-001", "Due Date": "05/11/2026", Quantity: "5,000", Type: "firm" }]);
    expect(errors).toEqual([]);
    expect(ok[0]).toMatchObject({ customerCode: "CUST-AUTO", partCode: "FG-CLIP-001", qty: 5000, type: "FIRM", row: 2 });
    expect(iso(ok[0].dueDate)).toBe("2026-11-05");
  });

  it("defaults the type to FIRM", () => {
    expect(parseDemandRows([{ customer_code: "C", part_code: "P", due_date: "2026-11-05", qty: 10 }]).ok[0].type).toBe("FIRM");
  });

  it("reports every problem on a row with the right spreadsheet row number", () => {
    const { ok, errors } = parseDemandRows([
      { customer_code: "C", part_code: "P", due_date: "2026-11-05", qty: 10 },
      { customer_code: "", part_code: "P", due_date: "garbage", qty: 0, type: "MAYBE" },
    ]);
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toMatch(/customer code.*due date.*quantity.*type "MAYBE"/);
  });

  it("rejects fractional and negative quantities and skips blank lines", () => {
    const { ok, errors } = parseDemandRows([
      { customer_code: "C", part_code: "P", due_date: "2026-11-05", qty: 1.5 },
      { customer_code: "C", part_code: "P", due_date: "2026-11-05", qty: -3 },
      { customer_code: "", part_code: "", due_date: "", qty: "" },
    ]);
    expect(ok).toEqual([]);
    expect(errors.map((e) => e.row)).toEqual([2, 3]);
  });
});

describe("readSpreadsheet", () => {
  it("reads CSV, including a BOM and quoted values, and the shipped template parses cleanly", async () => {
    const csv = "﻿customer_code,part_code,due_date,qty\n\"CUST-AUTO\",FG-1,2026-11-05,100\n";
    const rows = await readSpreadsheet(Buffer.from(csv), "x.csv");
    expect(parseDemandRows(rows).ok).toHaveLength(1);
    const tpl = await readSpreadsheet(Buffer.from(DEMAND_TEMPLATE_CSV), "template.csv");
    const parsed = parseDemandRows(tpl);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ok.map((r) => r.type)).toEqual(["FIRM", "FORECAST", "SPOT"]);
  });

  it("reads an .xlsx with real dates and formula cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Schedule");
    ws.addRow(["Customer", "Part", "Due date", "Qty", "Type"]);
    ws.addRow(["CUST-AUTO", "FG-1", new Date(Date.UTC(2026, 10, 5)), 1200, "FORECAST"]);
    ws.addRow(["CUST-AUTO", "FG-1", "12/11/2026", { formula: "600*2", result: 1200 }, "FIRM"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { ok, errors } = parseDemandRows(await readSpreadsheet(buf, "plan.xlsx"));
    expect(errors).toEqual([]);
    expect(ok.map((r) => [iso(r.dueDate), r.qty, r.type])).toEqual([["2026-11-05", 1200, "FORECAST"], ["2026-11-12", 1200, "FIRM"]]);
  });

  it("refuses unsupported, corrupt and oversized files with a plain message", async () => {
    await expect(readSpreadsheet(Buffer.from("x"), "x.pdf")).rejects.toThrow(/\.csv or \.xlsx/);
    await expect(readSpreadsheet(Buffer.from("not a zip"), "x.xlsx")).rejects.toThrow(/could not be read/);
    await expect(readSpreadsheet(Buffer.alloc(5 * 1024 * 1024 + 1), "x.csv")).rejects.toThrow(/5 MB/);
  });
});
