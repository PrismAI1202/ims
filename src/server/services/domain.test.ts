import { describe, expect, it } from "vitest";
import { can, assertCan, ForbiddenError } from "../auth/permissions";
import { checkFifo, sortForPicking, suggestPicks, type PickableLot } from "./fifo";
import { stockStatus } from "./stock-status";

const lot = (id: string, received: string, available: number, expiry?: string): PickableLot => ({
  lotId: id,
  lotNumber: id.toUpperCase(),
  receivedAt: new Date(received),
  expiryDate: expiry ? new Date(expiry) : null,
  available,
});

describe("stockStatus", () => {
  const levels = { minStock: 100, reorderPoint: 200 };
  it("is RED below min", () => expect(stockStatus(99, levels)).toBe("RED"));
  it("is YELLOW at min up to and including ROP", () => {
    expect(stockStatus(100, levels)).toBe("YELLOW");
    expect(stockStatus(200, levels)).toBe("YELLOW");
  });
  it("is GREEN above ROP", () => expect(stockStatus(201, levels)).toBe("GREEN"));
});

describe("FIFO / FEFO", () => {
  it("orders by receipt date when no expiry", () => {
    const sorted = sortForPicking([lot("b", "2026-02-01", 5), lot("a", "2026-01-01", 5)]);
    expect(sorted.map((l) => l.lotId)).toEqual(["a", "b"]);
  });

  it("puts earlier expiry first (FEFO) even if received later", () => {
    const sorted = sortForPicking([
      lot("old", "2026-01-01", 5, "2027-01-01"),
      lot("new", "2026-03-01", 5, "2026-06-01"),
    ]);
    expect(sorted.map((l) => l.lotId)).toEqual(["new", "old"]);
  });

  it("allocates across lots in pick order and reports shortfall", () => {
    const { picks, shortfall } = suggestPicks(
      [lot("a", "2026-01-01", 30), lot("b", "2026-02-01", 50)],
      70,
    );
    expect(picks).toEqual([
      { lotId: "a", lotNumber: "A", qty: 30 },
      { lotId: "b", lotNumber: "B", qty: 40 },
    ]);
    expect(shortfall).toBe(0);
    expect(suggestPicks([lot("a", "2026-01-01", 10)], 25).shortfall).toBe(15);
  });

  it("rejects an out-of-order scan but accepts the oldest lot", () => {
    const lots = [lot("a", "2026-01-01", 10), lot("b", "2026-02-01", 10)];
    expect(checkFifo(lots, "a")).toEqual({ ok: true });
    const bad = checkFifo(lots, "b");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.shouldPick.lotId).toBe("a");
  });

  it("ignores exhausted older lots", () => {
    const lots = [lot("a", "2026-01-01", 0), lot("b", "2026-02-01", 10)];
    expect(checkFifo(lots, "b")).toEqual({ ok: true });
  });
});

describe("RBAC", () => {
  it("lets the store incharge do GRN and issue but not QC", () => {
    expect(can("STORE_INCHARGE", "grn.create")).toBe(true);
    expect(can("STORE_INCHARGE", "stock.issue")).toBe(true);
    expect(can("STORE_INCHARGE", "qc.inspect")).toBe(false);
  });
  it("lets QA inspect but not issue stock", () => {
    expect(can("QA_INSPECTOR", "qc.inspect")).toBe(true);
    expect(can("QA_INSPECTOR", "stock.issue")).toBe(false);
  });
  it("lets production create requests only", () => {
    expect(can("PRODUCTION_LEAD", "request.create")).toBe(true);
    expect(can("PRODUCTION_LEAD", "stock.issue")).toBe(false);
  });
  it("denies unauthenticated and throws on assert", () => {
    expect(can(undefined, "stock.view")).toBe(false);
    expect(() => assertCan("DISPATCH_OFFICER", "grn.create")).toThrow(ForbiddenError);
  });
});
