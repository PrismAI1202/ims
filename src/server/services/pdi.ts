import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

// Final inspection (PDI): production books a finished-goods lot as PENDING, QA samples it and releases it or puts it on
// hold, and dispatch only loads boxes from released lots. Packing and labelling are allowed meanwhile.

export const NOT_SHIPPABLE = ["PENDING", "HOLD"] as const;

export interface PdiLot {
  lotNumber: string; item: string; itemName: string; qty: number; boxes: number;
  booking: string; status: "PENDING" | "HOLD"; note: string | null; since: Date;
}

/** FG lots waiting for a final-inspection decision (or held), oldest first. */
export async function pdiQueue(db: Db = defaultDb): Promise<PdiLot[]> {
  const lots = await db.lot.findMany({
    where: { pdiStatus: { in: [...NOT_SHIPPABLE] }, balances: { some: { qty: { gt: 0 } } } }, orderBy: { receivedAt: "asc" },
    include: { item: true, balances: true, boxes: { where: { status: "IN_STOCK" } } },
  });
  return lots.map((l) => ({
    lotNumber: l.lotNumber, item: l.item.code, itemName: l.item.name, qty: l.balances.reduce((s, b) => s + Number(b.qty), 0), boxes: l.boxes.length,
    booking: l.supplierLotNo, status: l.pdiStatus as "PENDING" | "HOLD", note: l.pdiNote, since: l.pdiAt ?? l.receivedAt,
  }));
}

export interface PdiInput { lotNumber: string; release: boolean; remarks?: string; userId?: string }

/** Releases a lot for dispatch, or holds it (holding needs remarks). */
export async function decidePdi(input: PdiInput, db: Db = defaultDb) {
  const lot = await db.lot.findUnique({ where: { lotNumber: input.lotNumber.trim() }, include: { item: true } });
  if (!lot) throw new DomainError(`Unknown lot ${input.lotNumber}.`);
  if (lot.item.category !== "FG") throw new DomainError(`${lot.lotNumber} is not a finished-goods lot.`);
  if (lot.pdiStatus === "NOT_REQUIRED") throw new DomainError(`${lot.lotNumber} doesn't need final inspection.`);
  if (!input.release && !input.remarks?.trim()) throw new DomainError("Say why the lot is on hold.");
  if (lot.pdiStatus === (input.release ? "RELEASED" : "HOLD")) throw new DomainError(`${lot.lotNumber} is already ${lot.pdiStatus.toLowerCase()}.`);
  if (!input.release) {
    // Boxes already on a truck being loaded would ship a lot QA has just stopped.
    const loading = await db.fgBox.count({ where: { lotId: lot.id, status: "IN_STOCK", dispatch: { status: "LOADING" } } });
    if (loading > 0) throw new DomainError(`${loading} box${loading === 1 ? " of" : "es of"} ${lot.lotNumber} ${loading === 1 ? "is" : "are"} on a dispatch being loaded. Unload ${loading === 1 ? "it" : "them"} first.`);
  }
  await db.lot.update({
    where: { id: lot.id },
    data: { pdiStatus: input.release ? "RELEASED" : "HOLD", pdiNote: input.remarks?.trim() || null, pdiById: input.userId, pdiAt: new Date() },
  });
}
