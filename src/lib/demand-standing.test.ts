import { describe, expect, it } from "vitest";
import { standingOf } from "./demand-standing";

const line = (over: Partial<Parameters<typeof standingOf>[0]> = {}) => ({ type: "FIRM" as const, qty: 1000, shipped: 0, due: "2026-11-20", ...over });

describe("where an order stands", () => {
  const today = "2026-11-13";
  it("is open before its due date, overdue after it, and shipped once everything has gone", () => {
    expect(standingOf(line(), today)).toBe("open");
    expect(standingOf(line({ due: today }), today)).toBe("open"); // due today is not late yet
    expect(standingOf(line({ due: "2026-11-12" }), today)).toBe("overdue");
    expect(standingOf(line({ shipped: 1000 }), today)).toBe("shipped");
    expect(standingOf(line({ shipped: 1200 }), today)).toBe("shipped"); // over-shipping still closes it
  });
  it("is part shipped while some has gone and some is left, and overdue wins once it is late", () => {
    expect(standingOf(line({ shipped: 400 }), today)).toBe("part");
    expect(standingOf(line({ shipped: 400, due: "2026-11-01" }), today)).toBe("overdue");
  });
  it("treats a shipped order as shipped even when it was due long ago, and a forecast as never an order", () => {
    expect(standingOf(line({ shipped: 1000, due: "2026-10-01" }), today)).toBe("shipped");
    expect(standingOf(line({ type: "FORECAST", due: "2026-10-01" }), today)).toBe("forecast");
    expect(standingOf(line({ type: "SPOT", shipped: 10 }), today)).toBe("part");
  });
});
