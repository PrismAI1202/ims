// OEE = Availability × Performance × Quality, worked out from production bookings and logged downtime.
// Pure functions only (no database), so the maths can be tested on its own.

export interface BookingRow {
  machineId: string; day: string; shift: string; // day is YYYY-MM-DD
  shots: number; good: number; reject: number;
  cycleSec: number | null; // the mould's standard cycle time; null when it hasn't been set
}
export interface DownRow { machineId: string; day: string; shift: string; minutes: number; reason: string }

export interface Agg {
  units: number; // distinct machine-shifts that ran or stopped
  plannedMin: number; downMin: number; idealMin: number;
  good: number; reject: number;
  missingCycle: boolean; // a booking in this bucket had no standard cycle time, so performance can't be measured
}

export interface Oee { A: number | null; P: number | null; Q: number | null; oee: number | null }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function oeeOf(a: Agg): Oee {
  const run = a.plannedMin - a.downMin;
  const A = a.plannedMin > 0 ? clamp01(run / a.plannedMin) : null;
  const P = a.missingCycle || run <= 0 || a.idealMin <= 0 ? null : clamp01(a.idealMin / run);
  const total = a.good + a.reject;
  const Q = total > 0 ? a.good / total : null;
  const oee = A !== null && P !== null && Q !== null ? A * P * Q : null;
  return { A, P, Q, oee };
}

const emptyAgg = (): Agg => ({ units: 0, plannedMin: 0, downMin: 0, idealMin: 0, good: 0, reject: 0, missingCycle: false });

/**
 * Groups bookings and downtime by `keyOf` (a day, a week, a machine, a shift…) and totals them.
 * Planned time is shiftMinutes for every distinct machine-shift that either ran or stopped.
 */
export function aggregate(
  bookings: BookingRow[], downs: DownRow[], shiftMinutes: number,
  keyOf: (r: { machineId: string; day: string; shift: string }) => string | null,
): Map<string, Agg> {
  const out = new Map<string, Agg>();
  const seen = new Map<string, Set<string>>();
  const touch = (r: { machineId: string; day: string; shift: string }) => {
    const key = keyOf(r);
    if (key === null) return null;
    const a = out.get(key) ?? emptyAgg();
    const unit = `${r.machineId}|${r.day}|${r.shift}`;
    const set = seen.get(key) ?? new Set<string>();
    if (!set.has(unit)) { set.add(unit); a.units += 1; a.plannedMin += shiftMinutes; }
    seen.set(key, set); out.set(key, a);
    return a;
  };
  for (const b of bookings) {
    const a = touch(b);
    if (!a) continue;
    a.good += b.good; a.reject += b.reject;
    if (b.cycleSec && b.cycleSec > 0) a.idealMin += (b.shots * b.cycleSec) / 60; else a.missingCycle = true;
  }
  for (const d of downs) {
    const a = touch(d);
    if (a) a.downMin += d.minutes;
  }
  return out;
}

/** Monday of the ISO week containing a YYYY-MM-DD day, as YYYY-MM-DD. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
export const monthKey = (day: string) => day.slice(0, 7);

export const DOWNTIME_LABEL: Record<string, string> = {
  MOULD_CHANGE: "Mould change", MOULD_REPAIR: "Mould repair", MACHINE_BREAKDOWN: "Machine breakdown", NO_MATERIAL: "No material",
  NO_OPERATOR: "No operator", NO_PLAN: "No plan", POWER_CUT: "Power cut", QC_HOLD: "QC hold", COLOUR_CHANGE: "Colour change", TRIAL: "Trial",
};

/** MTBF = run hours ÷ breakdowns; MTTR = repair minutes ÷ breakdowns. */
export function reliability(runMin: number, breakdowns: number, repairMin: number) {
  return {
    mtbfHours: breakdowns > 0 ? Math.round(runMin / 60 / breakdowns) : null,
    mttrMin: breakdowns > 0 ? Math.round(repairMin / breakdowns) : null,
  };
}
