import type { PrismaClient, Shift } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

// First-off: after a mould set-up, production asks QA to check the first parts. When the "first-off required" plant
// rule is on, production can only be booked on a machine, part and shift with an approval from the last 24 hours.

export const FIRST_OFF_VALID_MS = 24 * 3_600_000;

export interface FirstOffInput { machineId: string; bomId: string; shift: Shift; note?: string; userId?: string }

export async function requestFirstOff(input: FirstOffInput, db: Db = defaultDb) {
  const [machine, bom] = await Promise.all([
    db.machine.findUnique({ where: { id: input.machineId } }),
    db.bom.findUnique({ where: { id: input.bomId }, include: { fgItem: true } }),
  ]);
  if (!machine || !machine.active) throw new DomainError("Choose a machine that is in service.");
  if (!bom) throw new DomainError("Choose a part.");
  if (!["A", "B", "C"].includes(input.shift)) throw new DomainError("Choose a shift.");
  const open = await db.firstOff.findFirst({ where: { machineId: machine.id, bomId: bom.id, shift: input.shift, status: "PENDING" } });
  if (open) throw new DomainError(`A first-off for ${machine.code} · ${bom.fgItem.code} is already waiting for QA.`);
  return db.firstOff.create({
    data: { machineId: machine.id, bomId: bom.id, shift: input.shift, note: input.note?.trim() || null, requestedById: input.userId },
  });
}

export async function decideFirstOff(input: { id: string; approve: boolean; note?: string; userId?: string }, db: Db = defaultDb) {
  if (!input.approve && !input.note?.trim()) throw new DomainError("Say what is wrong with the first-off parts.");
  const r = await db.firstOff.updateMany({
    where: { id: input.id, status: "PENDING" },
    data: { status: input.approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedById: input.userId, decisionNote: input.note?.trim() || null },
  });
  if (r.count !== 1) throw new DomainError("That first-off has already been decided.");
}

/** True when QA has approved this machine, part and shift in the last 24 hours. */
export async function hasApprovedFirstOff(machineId: string, bomId: string, shift: Shift, db: Db = defaultDb, now = new Date()) {
  const hit = await db.firstOff.findFirst({
    where: { machineId, bomId, shift, status: "APPROVED", decidedAt: { gte: new Date(now.getTime() - FIRST_OFF_VALID_MS) } },
  });
  return !!hit;
}
