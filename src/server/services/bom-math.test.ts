import { describe, expect, it } from "vitest";
import { expectedConsumption, runnerKg, validateBomLines, validateBooking, type BomLineInput } from "./bom-math";

const good: BomLineInput[] = [
  { itemId: "pp", kind: "RESIN", pct: 70 },
  { itemId: "mb", kind: "MASTERBATCH", pct: 5 },
  { itemId: "rg", kind: "REGRIND", pct: 25 },
  { itemId: "insert", kind: "BOP", qtyPerPart: 2 },
  { itemId: "box", kind: "PACKAGING", qtyPerPart: 0.01 },
];

describe("validateBomLines", () => {
  it("accepts a blend that adds to 100 within the regrind limit", () => {
    expect(validateBomLines(good, 25)).toEqual([]);
  });

  it("rejects a blend that does not add to 100", () => {
    const bad = good.map((l) => (l.kind === "RESIN" ? { ...l, pct: 60 } : l));
    expect(validateBomLines(bad)[0]).toMatch(/100%.*currently 90%/);
  });

  it("tolerates rounding noise but not a real gap", () => {
    const ok = [{ itemId: "pp", kind: "RESIN" as const, pct: 99.995 }, { itemId: "mb", kind: "MASTERBATCH" as const, pct: 0.0 + 0.005 }];
    expect(validateBomLines(ok)).toEqual([]);
  });

  it("enforces the max regrind ratio", () => {
    const e = validateBomLines(good, 20);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/Regrind is 25%.*at most 20%/);
  });

  it("does not limit regrind when the resin has no limit configured", () => {
    expect(validateBomLines(good, undefined)).toEqual([]);
  });

  it("requires a resin line and positive quantities", () => {
    expect(validateBomLines([{ itemId: "mb", kind: "MASTERBATCH", pct: 100 }])).toContain("A BOM needs at least one resin line.");
    expect(validateBomLines([...good.slice(0, 3), { itemId: "i", kind: "BOP", qtyPerPart: 0 }]).join()).toMatch(/quantity per part/);
    expect(validateBomLines([])).toEqual(["Add at least one material line."]);
  });

  it("flags a repeated item", () => {
    expect(validateBomLines([...good, { itemId: "pp", kind: "BOP", qtyPerPart: 1 }]).join()).toMatch(/more than one line/);
  });
});

describe("expectedConsumption", () => {
  // 4 cavities × 10 g parts + 8 g runner = 48 g per shot; 1000 shots = 48 kg through the machine.
  const base = { lines: good, cavities: 4, partWeightG: 10, runnerWeightG: 8, shots: 1000, goodParts: 3900, rejectParts: 50 };
  const by = (r: ReturnType<typeof expectedConsumption>, id: string) => r.find((x) => x.itemId === id)!.expectedQty;

  it("splits the material through the machine by blend percentage", () => {
    const r = expectedConsumption(base);
    expect(by(r, "pp")).toBeCloseTo(33.6, 4); // 70% of 48 kg
    expect(by(r, "mb")).toBeCloseTo(2.4, 4);
    expect(by(r, "rg")).toBeCloseTo(12, 4);
  });

  it("counts inserts on good + rejected parts and packaging on good parts only", () => {
    const r = expectedConsumption(base);
    expect(by(r, "insert")).toBe(2 * (3900 + 50));
    expect(by(r, "box")).toBeCloseTo(39, 4);
  });

  it("scales linearly with shots", () => {
    const double = expectedConsumption({ ...base, shots: 2000, goodParts: 7800, rejectParts: 100 });
    expect(by(double, "pp")).toBeCloseTo(67.2, 4);
  });
});

describe("runnerKg", () => {
  it("converts per-shot grams to kg for the run", () => expect(runnerKg(1000, 8)).toBe(8));
  it("is zero for a runnerless (hot-runner) mould", () => expect(runnerKg(1000, 0)).toBe(0));
});

describe("validateBooking", () => {
  it("accepts parts within shots × cavities", () => {
    expect(validateBooking({ shots: 1000, goodParts: 3900, rejectParts: 100, cavities: 4 })).toEqual([]);
  });
  it("rejects more parts than the mould can make", () => {
    expect(validateBooking({ shots: 1000, goodParts: 3950, rejectParts: 100, cavities: 4 })[0]).toMatch(/exceed.*4000/);
  });
  it("rejects zero shots, negatives and fractions", () => {
    expect(validateBooking({ shots: 0, goodParts: 0, rejectParts: 0, cavities: 4 })).not.toEqual([]);
    expect(validateBooking({ shots: 10, goodParts: -1, rejectParts: 0, cavities: 4 })).not.toEqual([]);
    expect(validateBooking({ shots: 1.5, goodParts: 1, rejectParts: 0, cavities: 4 })).not.toEqual([]);
  });
});
