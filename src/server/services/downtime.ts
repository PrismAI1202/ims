import type { DowntimeReason, PrismaClient, Shift } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";
import { getShiftMinutes } from "./settings";

type Db = PrismaClient;

export interface LogDowntimeInput {
  machineId: string; mouldId?: string; day: string; // YYYY-MM-DD
  shift: Shift; reason: DowntimeReason; minutes: number; note?: string; userId?: string;
}

export function validateDowntime(i: { minutes: number; day: string }, shiftMinutes: number, today = new Date()): string | null {
  if (!Number.isInteger(i.minutes) || i.minutes <= 0) return "Enter the stop time in whole minutes.";
  if (i.minutes > shiftMinutes) return `A stop can't be longer than the ${shiftMinutes}-minute shift.`;
  const d = new Date(`${i.day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "Choose the date of the stop.";
  if (d.getTime() > today.getTime()) return "The stop can't be in the future.";
  return null;
}

export async function logDowntime(input: LogDowntimeInput, db: Db = defaultDb) {
  const err = validateDowntime(input, await getShiftMinutes(db));
  if (err) throw new DomainError(err);
  const machine = await db.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) throw new DomainError("Choose a machine.");
  return db.downtime.create({
    data: {
      machineId: machine.id, mouldId: input.mouldId || null, day: new Date(`${input.day}T00:00:00.000Z`), shift: input.shift,
      reason: input.reason, minutes: input.minutes, note: input.note?.trim() || null, userId: input.userId,
    },
  });
}
