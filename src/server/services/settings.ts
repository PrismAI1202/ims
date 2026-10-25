import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

export const DEFAULT_SHIFT_MINUTES = 480;

/** Length of one production shift in minutes; planned time for OEE is this per machine-shift. */
export async function getShiftMinutes(db: Db = defaultDb): Promise<number> {
  const row = await db.appSetting.findUnique({ where: { key: "shiftMinutes" } });
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SHIFT_MINUTES;
}

export async function setShiftMinutes(minutes: number, db: Db = defaultDb) {
  if (!Number.isInteger(minutes) || minutes < 60 || minutes > 720) throw new DomainError("A shift must be between 60 and 720 minutes.");
  await db.appSetting.upsert({ where: { key: "shiftMinutes" }, update: { value: String(minutes) }, create: { key: "shiftMinutes", value: String(minutes) } });
}
