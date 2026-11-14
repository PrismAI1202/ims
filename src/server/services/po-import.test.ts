import { describe, expect, it } from "vitest";
import { parsePoRows, PO_TEMPLATE_CSV } from "./po-import";

const r = (o: Record<string, unknown>) => o;

describe("parsePoRows", () => {
  it("groups rows into POs by supplier and reference, and reads optional columns", () => {
    const { groups, errors } = parsePoRows([
      r({ po_ref: "A-1", supplier_code: "sup-poly", item_code: "rm-pp-001", qty: "2,000", price: 112, expected_date: "20/11/2026", segment: "automotive" }),
      r({ po_ref: "A-1", supplier_code: "SUP-POLY", item_code: "MB-BLK-001", qty: 100 }),
      r({ po_ref: "A-2", supplier_code: "SUP-POLY", item_code: "RM-PP-001", qty: 50.5 }),
      r({ "PO Number": "", Supplier: "SUP-PACK", Part: "PK-BOX-5P", Quantity: 10 }),
      r({ Supplier: "SUP-PACK", Part: "PK-FILM-01", Quantity: 4 }),
    ]);
    expect(errors).toEqual([]);
    expect(groups.map((g) => [g.supplierCode, g.ref, g.segment, g.lines.length])).toEqual([
      ["SUP-POLY", "A-1", "AUTOMOTIVE", 2], ["SUP-POLY", "A-2", "NON_AUTOMOTIVE", 1], ["SUP-PACK", null, "NON_AUTOMOTIVE", 2],
    ]);
    expect(groups[0].lines[0]).toMatchObject({ row: 2, itemCode: "RM-PP-001", qty: 2000, price: 112, expectedDate: new Date("2026-11-20T00:00:00Z") });
    expect(groups[0].lines[1].price).toBeUndefined(); // blank: the price master is used
  });

  it("reports every bad row with its spreadsheet row number", () => {
    const { errors } = parsePoRows([
      r({ supplier_code: "S1", item_code: "I1", qty: 5 }),
      r({ supplier_code: "", item_code: "I1", qty: 5 }),
      r({ supplier_code: "S1", item_code: "I2", qty: 0 }),
      r({ supplier_code: "S1", item_code: "I3", qty: 5, price: -1 }),
      r({ supplier_code: "S1", item_code: "I4", qty: 5, expected_date: "31/02/2026" }),
      r({ supplier_code: "S1", item_code: "I5", qty: 5, segment: "weird" }),
    ]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0].message).toMatch(/supplier code is missing/);
    expect(errors[1].message).toMatch(/quantity/);
    expect(errors[2].message).toMatch(/price/);
    expect(errors[3].message).toMatch(/expected date/);
    expect(errors[4].message).toMatch(/segment/);
  });

  it("rejects a repeated item and a mixed segment within one PO", () => {
    const { errors } = parsePoRows([
      r({ po_ref: "X", supplier_code: "S1", item_code: "I1", qty: 1, segment: "AUTOMOTIVE" }),
      r({ po_ref: "X", supplier_code: "S1", item_code: "I1", qty: 2, segment: "AUTOMOTIVE" }),
      r({ po_ref: "X", supplier_code: "S1", item_code: "I2", qty: 2, segment: "NON_AUTOMOTIVE" }),
    ]);
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
    expect(errors[0].message).toMatch(/appears twice/);
    expect(errors[1].message).toMatch(/one PO has one segment/);
  });

  it("ignores blank lines and complains about an empty file", () => {
    expect(parsePoRows([r({ supplier_code: "", item_code: "", qty: "" })]).errors[0].message).toMatch(/no rows/);
    expect(parsePoRows([]).errors[0].message).toMatch(/no rows/);
  });

  it("ships a template that the parser accepts", async () => {
    const Papa = (await import("papaparse")).default;
    const rows = Papa.parse<Record<string, unknown>>(PO_TEMPLATE_CSV, { header: true, skipEmptyLines: true }).data;
    const { groups, errors } = parsePoRows(rows);
    expect(errors).toEqual([]);
    expect(groups.map((g) => g.ref)).toEqual(["ABC-1001", "ABC-1002"]);
  });
});
