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

// Plant rules an admin can switch on or off under Settings. Stored as "1" / "0" in AppSetting.
export const PLANT_RULES = {
  requirePdi: { label: "Final inspection (PDI) required before dispatch", default: true },
  requireFirstOff: { label: "First-off approval required before production can be booked", default: false },
} as const;
export type PlantRule = keyof typeof PLANT_RULES;

export async function getRule(rule: PlantRule, db: Db = defaultDb): Promise<boolean> {
  const row = await db.appSetting.findUnique({ where: { key: rule } });
  return row ? row.value === "1" : PLANT_RULES[rule].default;
}

export async function setRule(rule: PlantRule, on: boolean, db: Db = defaultDb) {
  await db.appSetting.upsert({ where: { key: rule }, update: { value: on ? "1" : "0" }, create: { key: rule, value: on ? "1" : "0" } });
}
