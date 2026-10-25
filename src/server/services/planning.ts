import type { PlanKind, PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";
import { getShiftMinutes } from "./settings";

type Db = PrismaClient;

/** Target OEE used to turn a part count into machine-days. */
const PLAN_OEE = 0.85;

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Monday (UTC) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
export const weekDays = (monday: Date, n = 6) => Array.from({ length: n }, (_, i) => new Date(monday.getTime() + i * 86_400_000));

/** Machine-days needed to make `qty` parts: cavities x shots per day at the target OEE. null when the mould has no cycle time. */
export function daysNeeded(qty: number, cavities: number, cycleSec: number | null, shiftMinutes: number): number | null {
  if (!cycleSec || cycleSec <= 0 || cavities <= 0) return null;
  const shotsPerDay = (3 * shiftMinutes * 60 * PLAN_OEE) / cycleSec;
  return Math.max(1, Math.ceil(qty / (cavities * shotsPerDay)));
}

/** Why a mould can't go on a machine, or null when it can. */
export function placementError(machine: { code: string; tonnage: number | null }, mould: { code: string; minTonnage: number | null }): string | null {
  if (mould.minTonnage && (machine.tonnage ?? 0) < mould.minTonnage) {
    return `${machine.code} is ${machine.tonnage ?? "?"} T. ${mould.code} needs at least ${mould.minTonnage} T.`;
  }
  return null;
}

export interface PlanJob {
  fgItemId: string; part: string; partName: string; mouldId: string; mould: string; minTonnage: number | null;
  qty: number; days: number | null; planned: number; left: number; colourKey: string; colour: string;
}
export interface PlanSlotView {
  id: string; machineId: string; day: string; kind: PlanKind; part: string; mould: string; note: string; colourKey: string; colour: string; fgItemId: string | null;
}
export interface PlanWeek {
  monday: string; days: string[]; machines: { id: string; code: string; tonnage: number | null }[]; slots: PlanSlotView[]; jobs: PlanJob[]; shiftMinutes: number;
}

/** Colour comes from the masterbatch in the part's BOM: none means natural. */
const colourOf = (lines: { kind: string; item: { id: string; name: string } }[]) => {
  const mb = lines.find((l) => l.kind === "MASTERBATCH");
  return mb ? { colourKey: mb.item.id, colour: mb.item.name.replace(/\s*(masterbatch|MB)\b.*$/i, "").trim() || mb.item.name } : { colourKey: "natural", colour: "Natural" };
};

export async function planWeek(monday: Date, db: Db = defaultDb, now = new Date()): Promise<PlanWeek> {
  const days = weekDays(monday);
  const today = parseDay(iso(now));
  const [machines, slots, demand, boms, fgBalances, shiftMinutes, futureJobSlots] = await Promise.all([
    db.machine.findMany({ orderBy: { code: "asc" } }),
    db.planSlot.findMany({ where: { day: { gte: days[0], lte: days[days.length - 1] } }, include: { mould: true } }),
    db.demandLine.findMany({ where: { type: { in: ["FIRM", "SPOT"] }, dueDate: { gte: today } }, include: { fgItem: true } }),
    db.bom.findMany({ include: { fgItem: true, mould: true, lines: { include: { item: true } } } }),
    db.stockBalance.findMany({ where: { qty: { gt: 0 }, lot: { item: { category: "FG" }, qcStatus: "APPROVED" } }, include: { lot: true } }),
    getShiftMinutes(db),
    db.planSlot.findMany({ where: { kind: "JOB", day: { gte: today } } }),
  ]);
  const bomByFg = new Map(boms.map((b) => [b.fgItemId, b]));
  const stock = new Map<string, number>();
  for (const b of fgBalances) stock.set(b.lot.itemId, (stock.get(b.lot.itemId) ?? 0) + Number(b.qty));
  const need = new Map<string, number>();
  for (const d of demand) need.set(d.fgItemId, (need.get(d.fgItemId) ?? 0) + d.qty);

  const jobs: PlanJob[] = [];
  for (const [fgItemId, total] of need) {
    const bom = bomByFg.get(fgItemId);
    const qty = total - (stock.get(fgItemId) ?? 0);
    if (!bom || qty <= 0) continue;
    const cycle = bom.mould.idealCycleSec === null ? null : Number(bom.mould.idealCycleSec);
    const days_ = daysNeeded(qty, bom.mould.cavities, cycle, shiftMinutes);
    const planned = futureJobSlots.filter((s) => s.fgItemId === fgItemId).length;
    const c = colourOf(bom.lines);
    jobs.push({
      fgItemId, part: bom.fgItem.code, partName: bom.fgItem.name, mouldId: bom.mouldId, mould: bom.mould.code, minTonnage: bom.mould.minTonnage,
      qty, days: days_, planned, left: days_ === null ? 1 : Math.max(0, days_ - planned), ...c,
    });
  }
  jobs.sort((a, b) => b.left - a.left || a.part.localeCompare(b.part));

  const partByFg = new Map(boms.map((b) => [b.fgItemId, b]));
  return {
    monday: iso(monday), days: days.map(iso), shiftMinutes,
    machines: machines.map((m) => ({ id: m.id, code: m.code, tonnage: m.tonnage })),
    jobs,
    slots: slots.map((s) => {
      const bom = s.fgItemId ? partByFg.get(s.fgItemId) : undefined;
      const c = bom ? colourOf(bom.lines) : { colourKey: "none", colour: "—" };
      return {
        id: s.id, machineId: s.machineId, day: iso(s.day), kind: s.kind, fgItemId: s.fgItemId,
        part: s.kind === "PM" ? "PM" : s.kind === "TRIAL" ? "Trial" : bom?.fgItem.code ?? "Job", mould: s.mould?.code ?? "", note: s.note ?? "", ...c,
      };
    }),
  };
}

export async function placeJob(
  input: { machineId: string; day: string; fgItemId: string; userId?: string }, db: Db = defaultDb,
): Promise<{ warning: string }> {
  const [machine, bom] = await Promise.all([
    db.machine.findUnique({ where: { id: input.machineId } }),
    db.bom.findUnique({ where: { fgItemId: input.fgItemId }, include: { mould: true, fgItem: true, lines: { include: { item: true } } } }),
  ]);
  if (!machine) throw new DomainError("Choose a machine.");
  if (!bom) throw new DomainError("That part has no BOM, so there is no mould to plan.");
  const err = placementError(machine, bom.mould);
  if (err) throw new DomainError(err);
  const day = parseDay(input.day);
  if (await db.planSlot.findUnique({ where: { machineId_day: { machineId: machine.id, day } } })) throw new DomainError(`${machine.code} is already booked on that day.`);

  // Colour change warning: the day before on the same machine ran a different colour.
  const prev = await db.planSlot.findUnique({
    where: { machineId_day: { machineId: machine.id, day: new Date(day.getTime() - 86_400_000) } },
  });
  let warning = "";
  if (prev?.kind === "JOB" && prev.fgItemId && prev.fgItemId !== input.fgItemId) {
    const prevBom = await db.bom.findUnique({ where: { fgItemId: prev.fgItemId }, include: { fgItem: true, lines: { include: { item: true } } } });
    const a = prevBom ? colourOf(prevBom.lines) : null; const b = colourOf(bom.lines);
    if (a && a.colourKey !== b.colourKey) warning = `Colour change ${a.colour} → ${b.colour}: allow about 15 minutes to purge.`;
  }
  await db.planSlot.create({ data: { machineId: machine.id, day, kind: "JOB", mouldId: bom.mouldId, fgItemId: input.fgItemId, userId: input.userId } });
  return { warning };
}

/** Marks a free machine-day as a PM or trial block. */
export async function blockSlot(
  input: { machineId: string; day: string; kind: "PM" | "TRIAL"; note?: string; userId?: string }, db: Db = defaultDb,
) {
  const day = parseDay(input.day);
  if (await db.planSlot.findUnique({ where: { machineId_day: { machineId: input.machineId, day } } })) throw new DomainError("That machine-day is already booked.");
  return db.planSlot.create({ data: { machineId: input.machineId, day, kind: input.kind, note: input.note?.trim() || null, userId: input.userId } });
}

export async function clearSlot(id: string, db: Db = defaultDb) {
  const s = await db.planSlot.findUnique({ where: { id } });
  if (!s) throw new DomainError("That slot no longer exists.");
  await db.planSlot.delete({ where: { id } });
}
