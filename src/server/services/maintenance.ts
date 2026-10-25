import type { PrismaClient, RepairKind } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";
import { aggregate, reliability } from "./oee";
import { getShiftMinutes } from "./settings";

type Db = PrismaClient;

export const PM_CHECKS = [
  "Clean vents and parting line",
  "Check ejector pins and return springs",
  "Flush cooling lines, check leaks",
  "Inspect gate and runner wear",
  "Grease guide pillars and bushes",
] as const;

export type PmState = "OK" | "DUE_SOON" | "OVERDUE";

/** Shots left until the next PM, and how worrying that is. "Due soon" is the last 30% of the interval, capped at 15,000 shots. */
export function pmStatus(shots: number, lastPm: number, interval: number) {
  const left = lastPm + interval - shots;
  const warnAt = Math.min(15000, Math.round(interval * 0.3));
  const state: PmState = left <= 0 ? "OVERDUE" : left < warnAt ? "DUE_SOON" : "OK";
  return { left, state, usedPct: Math.max(2, Math.min(100, ((shots - lastPm) / interval) * 100)) };
}

export interface MouldMaint {
  id: string; code: string; name: string; cavities: number; machineCode: string | null; parts: string[];
  shots: number; lastPm: number; interval: number; life: number; lifePct: number;
  left: number; state: PmState; usedPct: number;
}

/** Every mould with its shot counter: shots on the mould's counter at go-live plus every shot booked in production. */
export async function mouldRows(db: Db = defaultDb): Promise<MouldMaint[]> {
  const [moulds, booked] = await Promise.all([
    db.mould.findMany({ orderBy: { code: "asc" }, include: { machine: true, boms: { include: { fgItem: true } } } }),
    db.productionBooking.groupBy({ by: ["bomId"], _sum: { shots: true } }),
  ]);
  const boms = await db.bom.findMany({ select: { id: true, mouldId: true } });
  const shotsByMould = new Map<string, number>();
  for (const b of booked) {
    const m = boms.find((x) => x.id === b.bomId)?.mouldId;
    if (m) shotsByMould.set(m, (shotsByMould.get(m) ?? 0) + (b._sum.shots ?? 0));
  }
  return moulds.map((m) => {
    const shots = m.openingShots + (shotsByMould.get(m.id) ?? 0);
    const s = pmStatus(shots, m.lastPmShots, m.pmIntervalShots);
    return {
      id: m.id, code: m.code, name: m.name, cavities: m.cavities, machineCode: m.machine?.code ?? null,
      parts: m.boms.map((b) => b.fgItem.code), shots, lastPm: m.lastPmShots, interval: m.pmIntervalShots, life: m.lifeShots,
      lifePct: Math.round((shots / m.lifeShots) * 100), left: s.left, state: s.state, usedPct: s.usedPct,
    };
  });
}

export interface HistoryItem { when: Date; kind: "PM" | "Repair" | "Trial"; what: string; note: string }

export async function mouldHistory(mouldId: string, db: Db = defaultDb): Promise<HistoryItem[]> {
  const [pms, repairs] = await Promise.all([
    db.pmRecord.findMany({ where: { mouldId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.repairTicket.findMany({ where: { mouldId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const items: HistoryItem[] = [
    ...pms.map((p) => ({ when: p.createdAt, kind: "PM" as const, what: `PM at ${p.shotsAtPm.toLocaleString("en-US")} shots`, note: `${p.checks.split("\n").filter(Boolean).length} checks · photo${p.note ? ` · ${p.note}` : ""}` })),
    ...repairs.map((r) => ({
      when: r.createdAt, kind: r.kind === "TRIAL" ? ("Trial" as const) : ("Repair" as const), what: r.summary,
      note: [r.downtimeMin ? `Downtime ${r.downtimeMin} min` : "", r.photoRef ? "photo" : "", r.note ?? ""].filter(Boolean).join(" · "),
    })),
  ];
  return items.sort((a, b) => b.when.getTime() - a.when.getTime());
}

export interface CompletePmInput { mouldId: string; checks: string[]; photoRef: string | undefined; note?: string; userId?: string }

/** PM is only complete when every checklist step is ticked and an after-PM photo is attached; it resets the PM counter. */
export function validatePm(input: Pick<CompletePmInput, "checks" | "photoRef">): string | null {
  const missing = PM_CHECKS.filter((c) => !input.checks.includes(c));
  if (missing.length) return `${PM_CHECKS.length - missing.length} of ${PM_CHECKS.length} checks done. Tick every step.`;
  if (!input.photoRef) return "Attach the after-PM photo.";
  return null;
}

export async function completePm(input: CompletePmInput, db: Db = defaultDb) {
  const err = validatePm(input);
  if (err) throw new DomainError(err);
  const rows = await mouldRows(db);
  const m = rows.find((r) => r.id === input.mouldId);
  if (!m) throw new DomainError("Unknown mould.");
  return db.$transaction(async (tx) => {
    await tx.pmRecord.create({
      data: { mouldId: m.id, shotsAtPm: m.shots, checks: input.checks.join("\n"), photoRef: input.photoRef!, note: input.note?.trim() || null, userId: input.userId },
    });
    return tx.mould.update({ where: { id: m.id }, data: { lastPmShots: m.shots } });
  });
}

export async function logRepair(
  input: { mouldId: string; kind: RepairKind; summary: string; downtimeMin?: number; photoRef?: string; note?: string; userId?: string },
  db: Db = defaultDb,
) {
  if (!input.summary.trim()) throw new DomainError("Describe the repair.");
  if (input.downtimeMin !== undefined && !(Number.isInteger(input.downtimeMin) && input.downtimeMin >= 0)) throw new DomainError("Downtime must be whole minutes.");
  if (!(await db.mould.findUnique({ where: { id: input.mouldId } }))) throw new DomainError("Unknown mould.");
  return db.repairTicket.create({
    data: { mouldId: input.mouldId, kind: input.kind, summary: input.summary.trim(), downtimeMin: input.downtimeMin ?? 0, photoRef: input.photoRef || null, note: input.note?.trim() || null, userId: input.userId },
  });
}

export interface MachineReliability { machineId: string; code: string; breakdowns: number; mtbfHours: number | null; mttrMin: number | null; nextPm: string }

/** MTBF / MTTR per machine over the last `days` days, from logged downtime and booked shifts. */
export async function machineReliability(days = 30, db: Db = defaultDb, now = new Date()): Promise<MachineReliability[]> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  const [machines, bookings, downs, shiftMinutes, pmSlots] = await Promise.all([
    db.machine.findMany({ orderBy: { code: "asc" } }),
    db.productionBooking.findMany({ where: { producedAt: { gte: from } }, select: { machineId: true, shift: true, producedAt: true } }),
    db.downtime.findMany({ where: { day: { gte: from } } }),
    getShiftMinutes(db),
    db.planSlot.findMany({ where: { kind: "PM", day: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) } }, orderBy: { day: "asc" } }),
  ]);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const agg = aggregate(
    bookings.map((b) => ({ machineId: b.machineId, day: iso(b.producedAt), shift: b.shift, shots: 0, good: 0, reject: 0, cycleSec: null })),
    downs.map((d) => ({ machineId: d.machineId, day: iso(d.day), shift: d.shift, minutes: d.minutes, reason: d.reason })),
    shiftMinutes, (r) => r.machineId,
  );
  return machines.map((m) => {
    const a = agg.get(m.id);
    const breakdowns = downs.filter((d) => d.machineId === m.id && d.reason === "MACHINE_BREAKDOWN");
    const repairMin = breakdowns.reduce((s, d) => s + d.minutes, 0);
    const r = reliability(a ? a.plannedMin - a.downMin : 0, breakdowns.length, repairMin);
    const next = pmSlots.find((s) => s.machineId === m.id);
    return { machineId: m.id, code: m.code, breakdowns: breakdowns.length, ...r, nextPm: next ? next.day.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—" };
  });
}
