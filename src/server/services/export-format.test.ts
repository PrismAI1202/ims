import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { safeCell, toCsv, toXlsx, type Table } from "./export-format";

const table: Table = {
  title: "Stock: Live/Dashboard?", columns: ["Item", "Qty", "Note"],
  rows: [["RM-PP-001", 1500, "ok"], ["=HYPERLINK(\"http://evil\",\"x\")", 2, "line1\nline2"], ["Acme, Inc", -5, 'say "hi"']],
};

describe("safeCell", () => {
  it("neutralises text that a spreadsheet would run as a formula", () => {
    for (const bad of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(safeCell(bad)).toBe(`'${bad}`);
  });
  it("leaves ordinary text and real numbers (including negatives) untouched", () => {
    expect(safeCell("RM-PP-001")).toBe("RM-PP-001");
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell(0)).toBe(0);
  });
  it("turns null, undefined and non-finite numbers into blanks", () => {
    expect(safeCell(null)).toBe("");
    expect(safeCell(undefined)).toBe("");
    expect(safeCell(NaN)).toBe("");
    expect(safeCell(Infinity)).toBe("");
  });
});

describe("toCsv", () => {
  const csv = toCsv(table);
  it("starts with a BOM and a header row, using CRLF line ends", () => {
    expect(csv.startsWith("﻿Item,Qty,Note\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("quotes commas, quotes and newlines correctly", () => {
    expect(csv).toContain('"Acme, Inc",-5,"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });
  it("does not let a formula through", () => {
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).not.toMatch(/(^|,|\r\n)=HYPERLINK/);
  });
  it("keeps numbers as plain numbers", () => expect(csv).toContain("RM-PP-001,1500,ok"));
});

describe("toXlsx", () => {
  it("produces a workbook that round-trips, with a safe sheet name, bold header and neutralised formulas", async () => {
    const buf = await toXlsx(table);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).not.toMatch(/[\\/?*[\]:]/);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.getCell("B2").value).toBe(1500);
    expect(typeof ws.getCell("B2").value).toBe("number");
    expect(ws.getCell("A3").value).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(ws.getCell("B4").value).toBe(-5);
    expect(ws.rowCount).toBe(4);
  });
});
