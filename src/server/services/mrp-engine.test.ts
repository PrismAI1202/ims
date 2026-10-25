import { describe, expect, it } from "vitest";
import { orderByDate, replenishment, roundUp, runMrp, type MrpBom, type MrpDemand, type MrpItem } from "./mrp-engine";

const item = (over: Partial<MrpItem> & Pick<MrpItem, "id" | "code" | "category">): MrpItem => ({
  name: over.code, uom: "KG", minStock: 0, reorderPoint: 0, maxStock: 0, safetyStock: 0, onHand: 0, incoming: 0, ...over,
});

describe("roundUp", () => {
  it("rounds counted goods to whole units and weights to 0.1, always up", () => {
    expect(roundUp(10.01, "NOS")).toBe(11);
    expect(roundUp(10.0, "NOS")).toBe(10);
    expect(roundUp(33.61, "KG")).toBe(33.7);
    expect(roundUp(33.6, "KG")).toBe(33.6);
    expect(roundUp(-5, "KG")).toBe(0);
  });
});

describe("replenishment", () => {
  const lv = { minStock: 100, reorderPoint: 200, maxStock: 1000, safetyStock: 0 };

  it("KANBAN refills to the reorder level only when the strict minimum is breached", () => {
    expect(replenishment("KANBAN", 150, lv)).toBe(0); // above min: leave it
    expect(replenishment("KANBAN", 100, lv)).toBe(0); // exactly at min is not a breach
    expect(replenishment("KANBAN", 60, lv)).toBe(140); // refill to ROP 200
    expect(replenishment("KANBAN", -50, lv)).toBe(250); // shortfall covered too
  });

  it("ROP orders up to max once at or below the reorder point", () => {
    expect(replenishment("ROP", 201, lv)).toBe(0);
    expect(replenishment("ROP", 200, lv)).toBe(800);
    expect(replenishment("ROP", 50, lv)).toBe(950);
  });

  it("ROP with no max orders up to twice the reorder point", () => {
    expect(replenishment("ROP", 100, { ...lv, maxStock: 0 })).toBe(300);
  });

  it("safety stock raises both triggers", () => {
    expect(replenishment("KANBAN", 150, { ...lv, safetyStock: 180 })).toBe(50);
    expect(replenishment("ROP", 250, { ...lv, safetyStock: 300 })).toBe(750);
  });

  it("does nothing for an item with no levels set and no shortfall", () => {
    const none = { minStock: 0, reorderPoint: 0, maxStock: 0, safetyStock: 0 };
    expect(replenishment("ROP", 0, none)).toBe(0);
    expect(replenishment("KANBAN", 0, none)).toBe(0);
    expect(replenishment("ROP", -10, none)).toBeGreaterThan(0);
  });
});

describe("orderByDate", () => {
  const today = new Date("2026-10-20T10:00:00Z");
  it("subtracts supplier lead time from the earliest need and flags late orders", () => {
    const ok = orderByDate(new Date("2026-11-30"), 10, today);
    expect(ok.orderBy.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(ok.late).toBe(false);
    expect(orderByDate(new Date("2026-10-25"), 14, today).late).toBe(true);
  });
  it("says order now, never late, when nothing specific is due", () => {
    const r = orderByDate(null, 30, today);
    expect(r.late).toBe(false);
    expect(r.orderBy.toISOString().slice(0, 10)).toBe("2026-10-20");
  });
});

describe("runMrp", () => {
  const items = [
    item({ id: "fg", code: "FG-CLIP", category: "FG", uom: "NOS", minStock: 1000, reorderPoint: 2000, maxStock: 10000, onHand: 500 }),
    item({ id: "pp", code: "RM-PP", category: "RM_RESIN", minStock: 100, reorderPoint: 200, maxStock: 2000, onHand: 50 }),
    item({ id: "mb", code: "MB", category: "RM_MASTERBATCH", reorderPoint: 10, maxStock: 100, onHand: 500 }),
    item({ id: "rg", code: "RG-PP", category: "REGRIND", onHand: 0 }),
    item({ id: "ins", code: "INS", category: "BOP", uom: "NOS", reorderPoint: 5000, maxStock: 20000, onHand: 100000 }),
    item({ id: "idle", code: "IDLE-BOX", category: "PACKAGING", uom: "NOS", reorderPoint: 100, maxStock: 500, onHand: 40 }),
    item({ id: "fine", code: "FINE", category: "PACKAGING", uom: "NOS", reorderPoint: 100, maxStock: 500, onHand: 300 }),
  ];
  // 4 cavities × 10 g + 8 g runner = 48 g per shot
  const bom: MrpBom = {
    fgItemId: "fg", cavities: 4, partWeightG: 10, runnerWeightG: 8, scrapPct: 0,
    lines: [
      { itemId: "pp", kind: "RESIN", pct: 70 }, { itemId: "mb", kind: "MASTERBATCH", pct: 5 },
      { itemId: "rg", kind: "REGRIND", pct: 25 }, { itemId: "ins", kind: "BOP", qtyPerPart: 2 },
    ],
  };
  const d = (qty: number, segment: MrpDemand["segment"] = "NON_AUTOMOTIVE", date = "2026-11-10"): MrpDemand =>
    ({ segment, fgItemId: "fg", dueDate: new Date(date), qty });
  const horizon = new Date("2026-12-31");
  const by = (rows: ReturnType<typeof runMrp>, id: string) => rows.find((r) => r.itemId === id)!;

  it("nets demand against stock, then explodes only the shortfall through the BOM", () => {
    const rows = runMrp({ items, boms: [bom], demand: [d(5000)], horizonEnd: horizon });
    const fg = by(rows, "fg");
    expect(fg.gross).toBe(5000);
    expect(fg.projected).toBe(-4500); // 500 on hand − 5000
    expect(fg.suggested).toBe(14500); // ROP policy: order up to max 10000 from −4500
    // 14500 parts → 3625 shots × 48 g = 174 kg through the machine
    expect(by(rows, "pp").gross).toBeCloseTo(121.8, 3); // 70%
    expect(by(rows, "ins").gross).toBe(29000);
  });

  it("buys resin to cover its own shortfall and tops up to the policy maximum", () => {
    const rows = runMrp({ items, boms: [bom], demand: [d(5000)], horizonEnd: horizon });
    const pp = by(rows, "pp");
    expect(pp.projected).toBeCloseTo(50 - 121.8, 3);
    expect(pp.suggested).toBeCloseTo(2000 + 71.8, 0); // up to max 2000 from −71.8
    expect(pp.reason).toMatch(/Needs/);
  });

  it("leaves components alone when stock already covers them", () => {
    const rows = runMrp({ items, boms: [bom], demand: [d(5000)], horizonEnd: horizon });
    expect(by(rows, "mb").suggested).toBe(0);
    expect(by(rows, "ins").suggested).toBe(0);
    expect(by(rows, "mb").reason).toBe("Covered by stock");
  });

  it("marks regrind as made in-house", () => {
    expect(by(runMrp({ items, boms: [bom], demand: [d(5000)], horizonEnd: horizon }), "rg").inHouse).toBe(true);
  });

  it("applies the strict KANBAN policy when any automotive customer wants the part", () => {
    const rows = runMrp({ items, boms: [bom], demand: [d(200, "NON_AUTOMOTIVE"), d(100, "AUTOMOTIVE")], horizonEnd: horizon });
    const fg = by(rows, "fg");
    expect(fg.policy).toBe("KANBAN");
    expect(fg.gross).toBe(300);
    expect(fg.projected).toBe(200); // 500 − 300, below the 1000 minimum
    expect(fg.suggested).toBe(1800); // refill to ROP 2000
    expect(by(rows, "pp").policy).toBe("KANBAN");
  });

  it("does not plan production when stock covers demand and the buffer holds", () => {
    const rich = items.map((i) => (i.id === "fg" ? { ...i, onHand: 50000 } : i));
    const rows = runMrp({ items: rich, boms: [bom], demand: [d(5000)], horizonEnd: horizon });
    expect(by(rows, "fg").suggested).toBe(0);
    expect(rows.find((r) => r.itemId === "pp" && r.role === "COMPONENT")).toBeUndefined();
  });

  it("counts open purchase orders as supply", () => {
    const withPo = items.map((i) => (i.id === "pp" ? { ...i, incoming: 5000 } : i));
    expect(by(runMrp({ items: withPo, boms: [bom], demand: [d(5000)], horizonEnd: horizon }), "pp").suggested).toBe(0);
  });

  it("ignores demand beyond the planning horizon", () => {
    const rows = runMrp({ items, boms: [bom], demand: [d(5000, "NON_AUTOMOTIVE", "2027-06-01")], horizonEnd: horizon });
    expect(rows.find((r) => r.itemId === "fg")).toBeUndefined();
  });

  it("adds scrap allowance to the parts planned", () => {
    const base = runMrp({ items, boms: [bom], demand: [d(5000)], horizonEnd: horizon });
    const scrappy = runMrp({ items, boms: [{ ...bom, scrapPct: 10 }], demand: [d(5000)], horizonEnd: horizon });
    expect(by(scrappy, "ins").gross).toBeGreaterThan(by(base, "ins").gross);
  });

  it("flags finished goods that have no BOM instead of silently skipping components", () => {
    const rows = runMrp({ items, boms: [], demand: [d(5000)], horizonEnd: horizon });
    expect(by(rows, "fg").reason).toMatch(/no BOM/);
  });

  it("also suggests plain reorders for stocked materials with no demand", () => {
    const rows = runMrp({ items, boms: [bom], demand: [], horizonEnd: horizon });
    const idle = by(rows, "idle");
    expect(idle.role).toBe("STOCK");
    expect(idle.suggested).toBe(460); // up to max 500 from 40
    expect(rows.find((r) => r.itemId === "fine")).toBeUndefined();
  });

  it("sorts rows needing action first", () => {
    const rows = runMrp({ items, boms: [bom], demand: [d(5000)], horizonEnd: horizon });
    const firstZero = rows.findIndex((r) => r.suggested === 0);
    expect(rows.slice(0, firstZero).every((r) => r.suggested > 0)).toBe(true);
  });
});
