import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { aggregate, DOWNTIME_LABEL, monthKey, oeeOf, reliability, weekKey, type Agg, type BookingRow, type DownRow } from "./oee";
import { mouldRows } from "./maintenance";
import { getShiftMinutes } from "./settings";
import { stockByItem } from "./stock";
import { returnableBalances } from "./dispatch";

type Db = PrismaClient;

export interface KpiTile { label: string; value: string; note: string; tone: "ok" | "warn" | "danger" | "neutral"; href: string }
export interface MetricsPeriod {
  name: string; trend: string; unit: string; labels: string[];
  A: (number | null)[]; P: (number | null)[]; Q: (number | null)[];
  pareto: [string, number][]; shifts: [string, number | null][];
  machines: [string, number | null, number | null, number | null][];
  kpis: KpiTile[];
}
export interface MetricsData { periods: MetricsPeriod[]; shiftMinutes: number; missingCycle: string[]; hasData: boolean }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const SHIFT_LABEL: Record<string, string> = { A: "A · 06–14", B: "B · 14–22", C: "C · 22–06" };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Last-N bucket keys ending at `now`, oldest first. */
export function bucketKeys(kind: "daily" | "weekly" | "monthly", now: Date): { keys: string[]; labels: string[]; from: string; keyOf: (day: string) => string } {
  const today = iso(now);
  if (kind === "daily") {
    const keys = Array.from({ length: 7 }, (_, i) => iso(addDays(now, i - 6)));
    return { keys, labels: keys.map((k) => { const d = new Date(`${k}T00:00:00Z`); return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`; }), from: keys[0], keyOf: (d) => d };
  }
  if (kind === "weekly") {
    const thisWeek = weekKey(today);
    const keys = Array.from({ length: 8 }, (_, i) => iso(addDays(new Date(`${thisWeek}T00:00:00Z`), (i - 7) * 7)));
    const isoWeek = (k: string) => {
      const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3);
      const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    };
    return { keys, labels: keys.map((k) => `W${isoWeek(k)}`), from: keys[0], keyOf: weekKey };
  }
  const keys = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  return { keys, labels: keys.map((k) => MONTH_NAMES[Number(k.slice(5)) - 1]), from: `${keys[0]}-01`, keyOf: monthKey };
}

const tone = (ok: boolean, warn = false): KpiTile["tone"] => (ok ? "ok" : warn ? "warn" : "danger");

export async function computeMetrics(db: Db = defaultDb, now = new Date()): Promise<MetricsData> {
  const shiftMinutes = await getShiftMinutes(db);
  const earliest = bucketKeys("monthly", now).from;
  const since = new Date(`${earliest}T00:00:00.000Z`);
  const [bookings, downs, machines, moulds, stock, returnables, maint] = await Promise.all([
    db.productionBooking.findMany({ where: { producedAt: { gte: since } }, include: { bom: { include: { mould: true } } } }),
    db.downtime.findMany({ where: { day: { gte: since } } }),
    db.machine.findMany({ orderBy: { code: "asc" } }),
    db.mould.findMany(),
    stockByItem(db),
    returnableBalances(db),
    mouldRows(db),
  ]);
  const bRows: BookingRow[] = bookings.map((b) => ({
    machineId: b.machineId, day: iso(b.producedAt), shift: b.shift, shots: b.shots, good: b.goodParts, reject: b.rejectParts,
    cycleSec: b.bom.mould.idealCycleSec === null ? null : Number(b.bom.mould.idealCycleSec),
  }));
  const dRows: DownRow[] = downs.map((d) => ({ machineId: d.machineId, day: iso(d.day), shift: d.shift, minutes: d.minutes, reason: d.reason }));
  const code = new Map(machines.map((m) => [m.id, m.code]));
  const missingCycle = [...new Set(bookings.filter((b) => b.bom.mould.idealCycleSec === null).map((b) => b.bom.mould.code))].sort();

  const kpiTail = async (from: string, to: string): Promise<KpiTile[]> => {
    const f = new Date(`${from}T00:00:00.000Z`), t = new Date(`${to}T00:00:00.000Z`);
    const [lots, dispatched, consumption] = await Promise.all([
      db.lot.findMany({ where: { receivedAt: { gte: f, lt: t }, grnLine: { isNot: null } }, select: { qcStatus: true } }),
      db.dispatch.count({ where: { status: "DISPATCHED", dispatchedAt: { gte: f, lt: t } } }),
      db.bookingConsumption.findMany({ where: { booking: { producedAt: { gte: f, lt: t } } }, include: { item: true } }),
    ]);
    const rejected = lots.filter((l) => l.qcStatus === "REJECTED" || l.qcStatus === "DEVIATED").length;
    const rate = lots.length ? rejected / lots.length : 0;
    const kg = (cats: string[]) => consumption.filter((c) => cats.includes(c.item.category)).reduce((a, c) => a + Number(c.expectedQty), 0);
    const regrind = kg(["REGRIND"]), fed = kg(["RM_RESIN", "RM_MASTERBATCH", "REGRIND"]);
    const rpct = fed > 0 ? (regrind / fed) * 100 : null;

    // Plant MTBF / MTTR over the last 30 days
    const cut = iso(addDays(now, -30));
    const all = aggregate(bRows.filter((b) => b.day >= cut), dRows.filter((d) => d.day >= cut), shiftMinutes, () => "plant").get("plant");
    const breaks = dRows.filter((d) => d.day >= cut && d.reason === "MACHINE_BREAKDOWN");
    const rel = reliability(all ? all.plannedMin - all.downMin : 0, breaks.length, breaks.reduce((a, d) => a + d.minutes, 0));
    const belowMin = stock.filter((s) => s.status === "RED").length;
    const overdue = maint.filter((m) => m.state === "OVERDUE");
    const out = returnables.reduce((a, r) => a + r.balance, 0);
    return [
      { label: "QC lot rejects", value: `${rejected} of ${lots.length}`, note: lots.length ? `${(rate * 100).toFixed(1)}% of lots` : "No lots received", tone: tone(rejected === 0, rate < 0.1), href: "/qc" },
      { label: "Items below min", value: String(belowMin), note: belowMin ? "Raise POs · live count" : "All above min · live count", tone: tone(belowMin === 0), href: "/stock?status=RED" },
      { label: "Regrind usage", value: rpct === null ? "—" : `${rpct.toFixed(1)}%`, note: "Limit 20%", tone: rpct === null ? "neutral" : tone(rpct <= 20), href: "/production" },
      { label: "Dispatches", value: String(dispatched), note: "Loads shipped", tone: "neutral", href: "/dispatch" },
      { label: "MTBF (plant)", value: rel.mtbfHours === null ? "—" : `${rel.mtbfHours} h`, note: "Run h ÷ breakdowns · 30 d", tone: "neutral", href: "/maintenance?tab=machines" },
      { label: "MTTR (plant)", value: rel.mttrMin === null ? "—" : `${rel.mttrMin} min`, note: "Repair min ÷ breakdowns · 30 d", tone: "neutral", href: "/maintenance?tab=machines" },
      { label: "PM compliance", value: `${maint.length - overdue.length} of ${maint.length}`, note: overdue.length ? `${overdue.map((m) => m.code).join(", ")} overdue` : "All moulds in date", tone: tone(overdue.length === 0, true), href: "/maintenance" },
      { label: "Returnables out", value: String(out), note: `${new Set(returnables.filter((r) => r.balance > 0).map((r) => r.customerId)).size} customers holding`, tone: "neutral", href: "/returnables" },
    ];
  };

  const periods: MetricsPeriod[] = [];
  for (const [kind, name, trend, unit] of [
    ["daily", "Daily", "last 7 days", "day"], ["weekly", "Weekly", "last 8 weeks", "week"], ["monthly", "Monthly", "last 6 months", "month"],
  ] as const) {
    const b = bucketKeys(kind, now);
    const inWindow = (r: { day: string }) => r.day >= b.from && r.day <= iso(now);
    const keyOf = (r: { day: string }) => (inWindow(r) ? b.keyOf(r.day) : null);
    const byBucket = aggregate(bRows, dRows, shiftMinutes, keyOf);
    const res = b.keys.map((k) => oeeOf(byBucket.get(k) ?? { units: 0, plannedMin: 0, downMin: 0, idealMin: 0, good: 0, reject: 0, missingCycle: false } as Agg));

    const pareto = new Map<string, number>();
    for (const d of dRows.filter(inWindow)) pareto.set(d.reason, (pareto.get(d.reason) ?? 0) + d.minutes);
    const byMachine = aggregate(bRows, dRows, shiftMinutes, (r) => (inWindow(r) ? r.machineId : null));
    const byShift = aggregate(bRows, dRows, shiftMinutes, (r) => (inWindow(r) ? r.shift : null));
    const lastKey = b.keys[b.keys.length - 1];
    const winEnd = kind === "daily" ? iso(addDays(now, 1)) : kind === "weekly" ? iso(addDays(new Date(`${lastKey}T00:00:00Z`), 7)) : iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
    const winStart = kind === "daily" ? lastKey : lastKey.length === 7 ? `${lastKey}-01` : lastKey;

    periods.push({
      name, trend, unit, labels: b.labels,
      A: res.map((r) => r.A), P: res.map((r) => r.P), Q: res.map((r) => r.Q),
      pareto: [...pareto.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([r, m]) => [DOWNTIME_LABEL[r] ?? r, m] as [string, number]),
      shifts: (["A", "B", "C"] as const).map((s) => [SHIFT_LABEL[s], oeeOf(byShift.get(s) ?? { units: 0, plannedMin: 0, downMin: 0, idealMin: 0, good: 0, reject: 0, missingCycle: false }).oee] as [string, number | null]),
      machines: machines.map((m) => {
        const o = oeeOf(byMachine.get(m.id) ?? { units: 0, plannedMin: 0, downMin: 0, idealMin: 0, good: 0, reject: 0, missingCycle: false });
        return [code.get(m.id) ?? m.code, o.A, o.P, o.Q] as [string, number | null, number | null, number | null];
      }).filter((m) => m[1] !== null || m[3] !== null),
      kpis: await kpiTail(winStart, winEnd),
    });
  }
  return { periods, shiftMinutes, missingCycle, hasData: bookings.length > 0 || downs.length > 0 };
}
