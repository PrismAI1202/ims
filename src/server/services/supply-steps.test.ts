import { describe, expect, it } from "vitest";
import { needsPo, supplySteps, type SupplyRow } from "./supply-steps";

const row = (over: Partial<SupplyRow> = {}): SupplyRow => ({
  code: "RM-PP-001", category: "RM_RESIN", status: "RED", onHand: 500, pendingQc: 0, reorderPoint: 4000, maxStock: 12000, ...over,
});
const none = { openPoQty: 0, toPutAway: 0 };
const kinds = (r: SupplyRow, s = none) => supplySteps(r, s).map((x) => x.kind);

describe("supplySteps", () => {
  it("asks for a PO, sized up to max, when nothing is coming", () => {
    const [step] = supplySteps(row(), none);
    expect(step).toMatchObject({ kind: "raise-po", todo: true });
    expect(step.links[0]).toMatchObject({ view: "orders", perm: "po.manage", href: "/orders?new=po&item=RM-PP-001&qty=11500" });
  });
  it("shows a placed PO that covers the reorder point, and no new PO", () => {
    expect(kinds(row(), { openPoQty: 6000, toPutAway: 0 })).toEqual(["po-due"]);
  });
  it("still asks for another PO when what is coming leaves it at or below ROP", () => {
    expect(kinds(row(), { openPoQty: 1000, toPutAway: 0 })).toEqual(["po-due", "raise-po"]);
    expect(supplySteps(row(), { openPoQty: 1000, toPutAway: 0 })[1].label).toBe("Raise another PO");
  });
  it("counts stock in QC as coming, and flags approved stock still in staging", () => {
    expect(kinds(row({ pendingQc: 5000 }))).toEqual(["qc"]);
    expect(kinds(row({ status: "GREEN", onHand: 9000 }), { openPoQty: 0, toPutAway: 300 })).toEqual(["putaway"]);
  });
  it("plans production for FG instead of buying, and never buys regrind", () => {
    expect(kinds(row({ category: "FG" }))).toEqual(["plan"]);
    expect(kinds(row({ category: "REGRIND" }))).toEqual([]);
    expect(kinds(row({ category: "RETURNABLE", stockTracked: false }))).toEqual([]); // the customer's crates
    expect(kinds(row({ category: "RETURNABLE", stockTracked: true }))).toEqual(["raise-po"]);
  });
  it("leaves healthy items alone", () => {
    expect(kinds(row({ status: "GREEN", onHand: 9000 }))).toEqual([]);
    expect(needsPo(row({ status: "GREEN", onHand: 9000 }), none)).toBe(false);
  });
});
