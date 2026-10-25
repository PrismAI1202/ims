import { describe, expect, it } from "vitest";
import { groupWarning, rankGrades } from "./equivalents";
import { PM_CHECKS, pmStatus, validatePm } from "./maintenance";
import { daysNeeded, mondayOf, placementError, weekDays } from "./planning";
import { validateDowntime } from "./downtime";
import { bucketKeys } from "./metrics";

describe("pmStatus", () => {
  it("is OK well before the interval, due soon in the last stretch, overdue past it", () => {
    expect(pmStatus(320000, 300000, 50000)).toMatchObject({ left: 30000, state: "OK" });
    expect(pmStatus(340000, 300000, 50000)).toMatchObject({ left: 10000, state: "DUE_SOON" });
    expect(pmStatus(412880, 350000, 50000)).toMatchObject({ left: -12880, state: "OVERDUE" });
  });
  it("overdue exactly when the PM shot count is reached", () => {
    expect(pmStatus(350000, 300000, 50000).state).toBe("OVERDUE");
  });
});

describe("validatePm", () => {
  it("needs every step ticked and a photo", () => {
    expect(validatePm({ checks: [...PM_CHECKS].slice(0, 3), photoRef: "x" })).toMatch(/3 of 5/);
    expect(validatePm({ checks: [...PM_CHECKS], photoRef: undefined })).toMatch(/photo/);
    expect(validatePm({ checks: [...PM_CHECKS], photoRef: "file:1" })).toBeNull();
  });
});

describe("equivalent groups", () => {
  it("warns about single sourcing and missing approvals", () => {
    expect(groupWarning(0, 0)).toMatch(/No grades/);
    expect(groupWarning(0, 1)).toMatch(/approved/);
    expect(groupWarning(1, 0)).toMatch(/Single source/);
    expect(groupWarning(2, 0)).toBe("");
  });
  it("ranks only approved grades, in priority order, with pending ones after", () => {
    const r = rankGrades([
      { id: "c", status: "PENDING_QA", priority: 5 }, { id: "b", status: "APPROVED", priority: 20 },
      { id: "a", status: "APPROVED", priority: 10 }, { id: "d", status: "REJECTED", priority: 1 },
    ]);
    expect(r.map((g) => [g.id, g.rank])).toEqual([["a", 1], ["b", 2], ["c", null], ["d", null]]);
  });
});

describe("planning maths", () => {
  it("finds the Monday of a week and lists its days", () => {
    const m = mondayOf(new Date("2026-10-25T10:00:00Z")); // a Sunday
    expect(m.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(weekDays(m).map((d) => d.toISOString().slice(5, 10))).toEqual(["10-19", "10-20", "10-21", "10-22", "10-23", "10-24"]);
  });
  it("turns parts into machine-days from cavities and cycle time", () => {
    // 3 shifts x 480 min x 60 x 0.85 / 20 s = 3672 shots/day; x4 cavities = 14,688 parts/day
    expect(daysNeeded(15400, 4, 20, 480)).toBe(2);
    expect(daysNeeded(14000, 4, 20, 480)).toBe(1);
    expect(daysNeeded(100, 4, null, 480)).toBeNull();
  });
  it("blocks a mould from a press that is too small", () => {
    expect(placementError({ code: "M-01", tonnage: 80 }, { code: "MD-118", minTonnage: 150 })).toMatch(/needs at least 150 T/);
    expect(placementError({ code: "M-07", tonnage: 180 }, { code: "MD-118", minTonnage: 150 })).toBeNull();
    expect(placementError({ code: "M-07", tonnage: null }, { code: "MD-118", minTonnage: null })).toBeNull();
  });
});

describe("validateDowntime", () => {
  const today = new Date("2026-10-25T12:00:00Z");
  it("accepts a normal stop and rejects bad ones", () => {
    expect(validateDowntime({ minutes: 45, day: "2026-10-24" }, 480, today)).toBeNull();
    expect(validateDowntime({ minutes: 0, day: "2026-10-24" }, 480, today)).toMatch(/whole minutes/);
    expect(validateDowntime({ minutes: 600, day: "2026-10-24" }, 480, today)).toMatch(/480-minute/);
    expect(validateDowntime({ minutes: 30, day: "2026-10-30" }, 480, today)).toMatch(/future/);
  });
});

describe("bucketKeys", () => {
  const now = new Date("2026-10-25T09:00:00Z");
  it("gives seven days ending today", () => {
    const b = bucketKeys("daily", now);
    expect(b.keys).toHaveLength(7);
    expect(b.keys[6]).toBe("2026-10-25");
    expect(b.labels[6]).toBe("Sun 25");
  });
  it("gives eight Monday-keyed weeks and six months", () => {
    const w = bucketKeys("weekly", now);
    expect(w.keys[7]).toBe("2026-10-19");
    expect(w.keys).toHaveLength(8);
    expect(w.keyOf("2026-10-25")).toBe("2026-10-19");
    const m = bucketKeys("monthly", now);
    expect(m.keys).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(m.labels[5]).toBe("Oct");
  });
});
