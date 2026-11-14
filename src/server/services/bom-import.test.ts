import { describe, expect, it } from "vitest";
import { BOM_TEMPLATE_CSV, parseBomRows } from "./bom-import";

const r = (o: Record<string, unknown>) => o;

describe("parseBomRows", () => {
  it("groups rows into one BOM per finished part, accepting common header names", () => {
    const { groups, errors } = parseBomRows([
      r({ "FG Code": "fg-a", Mould: "mld-1", "Part weight (g)": "8.5", Material: "rm-pp", "Pct": "70" }),
      r({ "FG Code": "FG-A", Mould: "MLD-1", Material: "MB-BLK", Percentage: "5%" }),
      r({ "FG Code": "FG-A", Mould: "MLD-1", Material: "BOP-INS", "Qty per part": 2 }),
      r({ "FG Code": "FG-B", Mould: "MLD-2", "Part weight (g)": 12, Material: "RM-PP", Value: 100 }),
    ]);
    expect(errors).toEqual([]);
    expect(groups.map((g) => [g.fg, g.mould, g.weight, g.lines.length])).toEqual([["FG-A", "MLD-1", 8.5, 3], ["FG-B", "MLD-2", 12, 1]]);
    expect(groups[0].lines.map((l) => [l.material, l.amount, l.via])).toEqual([["RM-PP", 70, "pct"], ["MB-BLK", 5, "pct"], ["BOP-INS", 2, "qty"]]);
    expect(groups[1].lines[0].via).toBe("value");
  });

  it("reads the optional columns that describe a new material", () => {
    const { groups, errors } = parseBomRows([r({
      fg_code: "FG-N", fg_name: "New bracket", mould_code: "M1", part_weight_g: 12, material_code: "rm-new", pct: 90, material_name: "PA6 GF30",
      material_type: "Resin", uom: "kg", polymer_grade: "PA6", max_regrind_pct: 15, min_stock: 500, reorder_point: 1000, max_stock: 3000, supplier_code: "sup-poly", price: 310,
    })]);
    expect(errors).toEqual([]);
    expect(groups[0].fgName).toBe("New bracket");
    expect(groups[0].lines[0].create).toEqual({ name: "PA6 GF30", category: "RM_RESIN", uom: "KG", grade: "PA6", maxRegrind: 15, min: 500, rop: 1000, max: 3000, supplier: "SUP-POLY", price: 310 });
  });

  it("maps the words people use for a material's type", () => {
    const type = (t: string) => parseBomRows([r({ fg_code: "F", mould_code: "M", part_weight_g: 1, material_code: "X", pct: 1, material_name: "x", material_type: t })]).groups[0]?.lines[0].create?.category;
    expect([type("masterbatch"), type("MB"), type("Regrind"), type("insert"), type("Bought-out"), type("packaging")]).toEqual(["RM_MASTERBATCH", "RM_MASTERBATCH", "REGRIND", "BOP", "BOP", "PACKAGING"]);
    expect(type("steel")).toBeUndefined();
  });

  it("reports every bad row with its spreadsheet row number", () => {
    const { errors } = parseBomRows([
      r({ fg_code: "A", mould_code: "M", part_weight_g: 5, material_code: "X", pct: 50 }),
      r({ fg_code: "", mould_code: "M", material_code: "X", pct: 50 }),
      r({ fg_code: "A", mould_code: "M", material_code: "Y" }),
      r({ fg_code: "A", mould_code: "M", material_code: "Z", pct: 5, qty_per_part: 2 }),
      r({ fg_code: "A", mould_code: "M", material_code: "W", pct: -5 }),
      r({ fg_code: "A", mould_code: "M", material_code: "V", pct: 5, material_type: "steel" }),
    ]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0].message).toMatch(/fg_code is missing/);
    expect(errors[1].message).toMatch(/give the amount/);
    expect(errors[2].message).toMatch(/not both/);
    expect(errors[3].message).toMatch(/above 0/);
    expect(errors[4].message).toMatch(/material_type "steel"/);
  });

  it("rejects two moulds or two weights for one part, a repeated material, and a part with no weight", () => {
    const { errors } = parseBomRows([
      r({ fg_code: "A", mould_code: "M1", part_weight_g: 5, material_code: "X", pct: 50 }),
      r({ fg_code: "A", mould_code: "M2", material_code: "Y", pct: 50 }),
      r({ fg_code: "A", mould_code: "M1", part_weight_g: 6, material_code: "Z", pct: 5 }),
      r({ fg_code: "A", mould_code: "M1", material_code: "X", pct: 5 }),
      r({ fg_code: "B", mould_code: "M1", material_code: "X", pct: 100 }),
    ]);
    expect(errors.map((e) => e.message).join(" | ")).toMatch(/two moulds[\s\S]*two part weights[\s\S]*appears twice[\s\S]*B has no part_weight_g/);
  });

  it("ignores blank lines, complains about an empty file, and ships a template it accepts", async () => {
    expect(parseBomRows([r({ fg_code: "", material_code: "" })]).errors[0].message).toMatch(/no rows/);
    const Papa = (await import("papaparse")).default;
    const rows = Papa.parse<Record<string, unknown>>(BOM_TEMPLATE_CSV, { header: true, skipEmptyLines: true }).data;
    const { groups, errors } = parseBomRows(rows);
    expect(errors).toEqual([]);
    expect(groups.map((g) => [g.fg, g.lines.length])).toEqual([["FG-CLIP-001", 4], ["FG-NEW-010", 3]]);
  });
});
