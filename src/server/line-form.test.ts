import { describe, expect, it } from "vitest";
import { dateField, readLines } from "./line-form";

const form = (pairs: [string, string][]) => { const f = new FormData(); for (const [k, v] of pairs) f.append(k, v); return f; };

describe("readLines", () => {
  it("reads any number of rows from repeated fields, in order", () => {
    const f = form([
      ["itemId", "a"], ["qty", "5"], ["price", ""], ["date", ""],
      ["itemId", "b"], ["qty", "2.5"], ["price", "10.5"], ["date", "2026-12-01"],
      ["itemId", "c"], ["qty", "1"], ["price", "0"], ["date", ""],
    ]);
    expect(readLines(f)).toEqual([
      { itemId: "a", qty: 5, price: undefined, date: undefined },
      { itemId: "b", qty: 2.5, price: 10.5, date: "2026-12-01" },
      { itemId: "c", qty: 1, price: 0, date: undefined }, // a price of 0 is a price, not blank
    ]);
  });
  it("copes with forms that have no price or date columns (pick lists)", () => {
    expect(readLines(form([["itemId", "x"], ["qty", "40"], ["itemId", "y"], ["qty", "60"]]))).toEqual([
      { itemId: "x", qty: 40, price: undefined, date: undefined }, { itemId: "y", qty: 60, price: undefined, date: undefined },
    ]);
  });
  it("skips rows with no item and returns nothing for an empty form", () => {
    expect(readLines(form([["itemId", ""], ["qty", "9"], ["itemId", "z"], ["qty", "1"]])).map((l) => l.itemId)).toEqual(["z"]);
    expect(readLines(new FormData())).toEqual([]);
  });
});

describe("dateField", () => {
  it("accepts YYYY-MM-DD as UTC midnight and rejects everything else", () => {
    expect(dateField("2026-12-15")?.toISOString()).toBe("2026-12-15T00:00:00.000Z");
    for (const bad of ["", "  ", "15/12/2026", "2026-13-40", "soon", null, undefined]) expect(dateField(bad)).toBeUndefined();
  });
});
