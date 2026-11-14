import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

// Unused material coming back from the machine to a storage bin. Without this the BOM variance report counts it as
// over-use and stock is understated. A lot can only come back as far as it went out: issued, less what production
// says it used from it, less what has already been returned.

export const MACHINE_RETURN = "MACHINE_RETURN";

export interface ReturnableLot { lotNumber: string; itemCode: string; itemName: string; uom: string; atMachine: number; lastIssued: Date }

async function atMachine(db: Db, lotId: string): Promise<number> {
  const [issued, used, returned] = await Promise.all([
    db.issueLine.aggregate({ _sum: { qty: true }, where: { lotId } }),
    db.productionLotUse.aggregate({ _sum: { qty: true }, where: { lotId } }),
    db.stockTransaction.aggregate({ _sum: { qty: true }, where: { lotId, type: "RETURN", refType: MACHINE_RETURN } }),
  ]);
  return Math.max(0, Number(issued._sum.qty ?? 0) - Number(used._sum.qty ?? 0) - Number(returned._sum.qty ?? 0));
}

/** Lots issued in the last two weeks that may still have material at a machine, most recent first. */
export async function returnableLots(db: Db = defaultDb, now = new Date()): Promise<ReturnableLot[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const recent = await db.issueLine.findMany({
    where: { issuedAt: { gte: since } }, orderBy: { issuedAt: "desc" }, include: { lot: { include: { item: true } } },
  });
  const seen = new Map<string, (typeof recent)[number]>();
  for (const l of recent) if (!seen.has(l.lotId)) seen.set(l.lotId, l);
  const out: ReturnableLot[] = [];
  for (const l of seen.values()) {
    const left = await atMachine(db, l.lotId);
    if (left > 1e-9) out.push({ lotNumber: l.lot.lotNumber, itemCode: l.lot.item.code, itemName: l.lot.item.name, uom: l.lot.item.uom, atMachine: left, lastIssued: l.issuedAt });
  }
  return out;
}

export interface ReturnMaterialInput { lotNumber: string; locationCode: string; qty: number; note?: string; userId?: string }

export async function returnMaterial(input: ReturnMaterialInput, db: Db = defaultDb) {
  if (!(input.qty > 0)) throw new DomainError("Quantity must be positive.");
  const [lot, loc] = await Promise.all([
    db.lot.findUnique({ where: { lotNumber: input.lotNumber.trim() } }),
    db.location.findFirst({ where: { code: input.locationCode.trim(), active: true } }),
  ]);
  if (!lot) throw new DomainError(`Unknown lot ${input.lotNumber}.`);
  if (!loc) throw new DomainError(`Unknown bin ${input.locationCode}.`);
  if (loc.type !== "STORAGE") throw new DomainError("Material goes back into a storage bin.");
  if (lot.qcStatus !== "APPROVED" && lot.qcStatus !== "DEVIATED") throw new DomainError(`Lot ${lot.lotNumber} is ${lot.qcStatus}; it can't go back into stock.`);

  return db.$transaction(async (tx) => {
    const left = await atMachine(tx as unknown as Db, lot.id);
    if (input.qty > left + 1e-9) {
      throw new DomainError(left > 0
        ? `Only ${left} of ${lot.lotNumber} is out at the machines; you are returning ${input.qty}.`
        : `Nothing of ${lot.lotNumber} is out at the machines: it was never issued, or has all been used or returned.`);
    }
    await tx.stockBalance.upsert({
      where: { lotId_locationId: { lotId: lot.id, locationId: loc.id } },
      update: { qty: { increment: input.qty } }, create: { lotId: lot.id, locationId: loc.id, qty: input.qty },
    });
    await tx.stockTransaction.create({
      data: { type: "RETURN", lotId: lot.id, locationId: loc.id, qty: input.qty, refType: MACHINE_RETURN, userId: input.userId, note: input.note?.trim() || undefined },
    });
  });
}
