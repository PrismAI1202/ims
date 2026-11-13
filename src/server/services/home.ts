import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DOWNTIME_LABEL } from "./oee";
import { computeMetrics } from "./metrics";
import { mouldRows } from "./maintenance";
import { parseDay } from "./planning";
import { pendingScrap } from "./scrap";

type Db = PrismaClient;

// Data behind the role-specific Home blocks (src/components/home). Each function is one block's query set.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

/** "5 min ago", "3 h ago", "2 d ago". */
export function ago(then: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  return min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
}

export interface MachineCard {
  id: string; code: string; tonnage: number | null;
  mould: string | null;
  plan: { label: string; note: string } | null; // today's plan slot
  last: { number: string; part: string; shots: number; good: number; reject: number; when: string } | null;
  downtimeMin: number; // minutes stopped today
  lastStop: { reason: string; minutes: number; when: string } | null;
  lots: { lotNumber: string; item: string }[]; // material cited on the last booking
}

/** One card per machine: what is planned, what was last booked, today's stops and the material fed in. */
export async function machineCards(db: Db = defaultDb, now = new Date()): Promise<MachineCard[]> {
  const today = parseDay(iso(now));
  const [machines, slots, downs] = await Promise.all([
    db.machine.findMany({ where: { active: true }, orderBy: { code: "asc" }, include: { moulds: { where: { active: true }, orderBy: { code: "asc" }, take: 1 } } }),
    db.planSlot.findMany({ where: { day: today }, include: { mould: true } }),
    db.downtime.findMany({ where: { day: { gte: new Date(today.getTime() - 7 * DAY) } }, orderBy: { createdAt: "desc" } }),
  ]);
  const parts = new Map((await db.item.findMany({ where: { id: { in: slots.map((s) => s.fgItemId).filter((x): x is string => !!x) } }, select: { id: true, code: true } })).map((i) => [i.id, i.code]));
  const lasts = await Promise.all(machines.map((m) => db.productionBooking.findFirst({
    where: { machineId: m.id }, orderBy: { producedAt: "desc" },
    include: { bom: { include: { fgItem: true } }, lotUses: { include: { lot: { include: { item: true } } } } },
  })));

  return machines.map((m, i) => {
    const slot = slots.find((s) => s.machineId === m.id);
    const last = lasts[i];
    const stops = downs.filter((d) => d.machineId === m.id);
    const stop = stops[0];
    return {
      id: m.id, code: m.code, tonnage: m.tonnage,
      mould: slot?.mould?.code ?? m.moulds[0]?.code ?? null,
      plan: slot ? {
        label: slot.kind === "JOB" ? (slot.fgItemId ? parts.get(slot.fgItemId) ?? "Job" : "Job") : slot.kind === "PM" ? "PM" : "Trial",
        note: slot.note ?? "",
      } : null,
      last: last ? { number: last.bookingNumber, part: last.bom.fgItem.code, shots: last.shots, good: last.goodParts, reject: last.rejectParts, when: ago(last.producedAt, now) } : null,
      downtimeMin: stops.filter((d) => iso(d.day) === iso(today)).reduce((s, d) => s + d.minutes, 0),
      lastStop: stop ? { reason: DOWNTIME_LABEL[stop.reason] ?? stop.reason, minutes: stop.minutes, when: ago(stop.createdAt, now) } : null,
      lots: last ? last.lotUses.map((u) => ({ lotNumber: u.lot.lotNumber, item: u.lot.item.code })) : [],
    };
  });
}

export interface ShipmentRow {
  customer: string; part: string; due: string; qty: number; ready: number; // ready: FG in released, unloaded boxes
}
export interface Shipments { rows: ShipmentRow[]; loading: { id: string; dcNumber: string; customer: string; scanned: number }[]; readyBoxes: number }

/** Firm and spot demand due in the next 7 days against FG boxes ready to ship, plus dispatches still loading. */
export async function shipments(db: Db = defaultDb, now = new Date()): Promise<Shipments> {
  const today = parseDay(iso(now));
  const [demand, boxes, loading] = await Promise.all([
    db.demandLine.findMany({
      where: { type: { in: ["FIRM", "SPOT"] }, dueDate: { gte: today, lte: new Date(today.getTime() + 7 * DAY) } },
      orderBy: { dueDate: "asc" }, include: { customer: true, fgItem: true },
    }),
    db.fgBox.findMany({ where: { status: "IN_STOCK", dispatchId: null, lot: { pdiStatus: { notIn: ["PENDING", "HOLD"] } } }, include: { lot: true } }),
    db.dispatch.findMany({ where: { status: "LOADING" }, orderBy: { createdAt: "asc" }, include: { customer: true, boxes: true } }),
  ]);
  const ready = new Map<string, number>();
  for (const b of boxes) {
    const k = `${b.customerId}:${b.lot.itemId}`;
    ready.set(k, (ready.get(k) ?? 0) + b.qty);
  }
  return {
    rows: demand.filter((d) => d.qty > d.shippedQty).map((d) => ({ customer: d.customer.name, part: d.fgItem.code, due: iso(d.dueDate), qty: d.qty - d.shippedQty, ready: ready.get(`${d.customerId}:${d.fgItemId}`) ?? 0 })),
    loading: loading.map((d) => ({ id: d.id, dcNumber: d.dcNumber, customer: d.customer.name, scanned: d.boxes.length })),
    readyBoxes: boxes.length,
  };
}

export interface Overview {
  oee: number | null; label: string; topStop: { reason: string; minutes: number } | null;
  exceptions: { label: string; n: number; href: string }[];
}

/** Admin's glance: latest OEE, the biggest cause of downtime this month, and what needs a second look. */
export async function plantOverview(db: Db = defaultDb, now = new Date()): Promise<Overview> {
  const week = new Date(now.getTime() - 7 * DAY);
  const m = await computeMetrics(db, now);
  const d = m.periods[0];
  const at = (() => {
    for (let i = d.labels.length - 1; i >= 0; i--) if (d.A[i] !== null && d.P[i] !== null && d.Q[i] !== null) return i;
    return -1;
  })();
  const monthly = m.periods[m.periods.length - 1];
  const [overrides, deviations, moulds] = await Promise.all([
    db.issueLine.count({ where: { fifoOverrideReason: { not: null }, issuedAt: { gte: week } } }),
    db.qcInspection.count({ where: { decision: "DEVIATED", inspectedAt: { gte: week } } }),
    mouldRows(db),
  ]);
  const top = monthly.pareto[0];
  return {
    oee: at < 0 ? null : d.A[at]! * d.P[at]! * d.Q[at]!,
    label: at < 0 ? "No data yet" : d.labels[at],
    topStop: top ? { reason: top[0], minutes: top[1] } : null,
    exceptions: [
      { label: "FIFO overrides this week", n: overrides, href: "/process" },
      { label: "QC deviations this week", n: deviations, href: "/process" },
      { label: "Moulds overdue for PM", n: moulds.filter((x) => x.state === "OVERDUE").length, href: "/maintenance" },
    ],
  };
}

export interface QcQueue { inward: { n: number; oldest: string | null }; scrap: number; firstOff: number; pdi: number }

/** QA's queue: inward lots waiting (with the oldest), and rejects waiting for a scrap decision. */
export async function qcQueue(db: Db = defaultDb, now = new Date()): Promise<QcQueue> {
  const [n, oldest, scrap, firstOff, pdi] = await Promise.all([
    db.lot.count({ where: { qcStatus: "PENDING_QC" } }),
    db.lot.findFirst({ where: { qcStatus: "PENDING_QC" }, orderBy: { receivedAt: "asc" }, select: { receivedAt: true } }),
    pendingScrap(db),
    db.firstOff.count({ where: { status: "PENDING" } }),
    db.lot.count({ where: { pdiStatus: "PENDING" } }),
  ]);
  return { inward: { n, oldest: oldest ? ago(oldest.receivedAt, now) : null }, scrap: scrap.length, firstOff, pdi };
}
