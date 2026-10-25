import { describe, expect, it } from "vitest";
import { aggregate, monthKey, oeeOf, reliability, weekKey, type BookingRow, type DownRow } from "./oee";

const booking = (o: Partial<BookingRow> = {}): BookingRow => ({ machineId: "M1", day: "2026-10-19", shift: "A", shots: 1000, good: 3900, reject: 100, cycleSec: 20, ...o });
const down = (o: Partial<DownRow> = {}): DownRow => ({ machineId: "M1", day: "2026-10-19", shift: "A", minutes: 48, reason: "MOULD_CHANGE", ...o });
const byDay = (r: { day: string }) => r.day;

describe("oeeOf", () => {
  it("multiplies availability, performance and quality", () => {
    // 480 min planned, 48 down => A 0.9. 1000 shots x 20 s = 333.3 min ideal over 432 run min => P 0.7716. Q 3900/4000 = 0.975
    const a = aggregate([booking()], [down()], 480, byDay).get("2026-10-19")!;
    const r = oeeOf(a);
    expect(r.A).toBeCloseTo(0.9, 5);
    expect(r.P).toBeCloseTo(333.333 / 432, 3);
    expect(r.Q).toBeCloseTo(0.975, 5);
    expect(r.oee).toBeCloseTo(0.9 * (333.333 / 432) * 0.975, 3);
  });

  it("counts a machine-shift once however many bookings it has", () => {
    const a = aggregate([booking(), booking({ shots: 500 })], [], 480, byDay).get("2026-10-19")!;
    expect(a.units).toBe(1);
    expect(a.plannedMin).toBe(480);
  });

  it("counts a shift that only had downtime as planned time", () => {
    const a = aggregate([], [down({ shift: "B", minutes: 480 })], 480, byDay).get("2026-10-19")!;
    expect(a.plannedMin).toBe(480);
    expect(oeeOf(a).A).toBe(0);
  });

  it("cannot measure performance without a standard cycle time", () => {
    const a = aggregate([booking({ cycleSec: null })], [], 480, byDay).get("2026-10-19")!;
    const r = oeeOf(a);
    expect(r.P).toBeNull();
    expect(r.oee).toBeNull();
    expect(r.A).toBe(1);
  });

  it("caps performance at 100% when the mould beats its standard", () => {
    const a = aggregate([booking({ shots: 5000 })], [], 480, byDay).get("2026-10-19")!;
    expect(oeeOf(a).P).toBe(1);
  });

  it("groups by the key you give it and can skip rows", () => {
    const rows = [booking({ day: "2026-10-19" }), booking({ day: "2026-10-20" }), booking({ day: "2026-09-01" })];
    const m = aggregate(rows, [], 480, (r) => (r.day >= "2026-10-01" ? monthKey(r.day) : null));
    expect([...m.keys()]).toEqual(["2026-10"]);
    expect(m.get("2026-10")!.units).toBe(2);
  });
});

describe("weekKey / reliability", () => {
  it("finds the Monday of the week", () => {
    expect(weekKey("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekKey("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(weekKey("2026-10-21")).toBe("2026-10-19");
  });
  it("computes MTBF and MTTR, and nothing when there were no breakdowns", () => {
    expect(reliability(36000, 4, 260)).toEqual({ mtbfHours: 150, mttrMin: 65 });
    expect(reliability(36000, 0, 0)).toEqual({ mtbfHours: null, mttrMin: null });
  });
});
