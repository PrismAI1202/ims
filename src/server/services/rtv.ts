import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { company } from "@/lib/company";
import { DomainError, nextNumber } from "./inventory";

type Db = PrismaClient;

// Rejected lots sit in staging with no way out. Returning one to its supplier removes the stock, and the debit note
// is the document that travels with it. The price is the one on the PO line the lot was received against.

export interface RejectedLot { lotNumber: string; itemCode: string; itemName: string; uom: string; supplier: string | null; onHand: number }

/** Rejected lots that still have stock to send back. */
export async function rejectedLots(db: Db = defaultDb): Promise<RejectedLot[]> {
  const lots = await db.lot.findMany({
    where: { qcStatus: "REJECTED", balances: { some: { qty: { gt: 0 } } } }, orderBy: { receivedAt: "asc" },
    include: { item: true, balances: true, grnLine: { include: { poLine: { include: { po: { include: { supplier: true } } } } } } },
  });
  return lots.map((l) => ({
    lotNumber: l.lotNumber, itemCode: l.item.code, itemName: l.item.name, uom: l.item.uom,
    supplier: l.grnLine?.poLine.po.supplier.name ?? null, onHand: l.balances.reduce((s, b) => s + Number(b.qty), 0),
  }));
}

export interface ReturnToVendorInput { lotNumber: string; qty: number; reason: string; userId?: string }

export async function returnToVendor(input: ReturnToVendorInput, db: Db = defaultDb) {
  if (!(input.qty > 0)) throw new DomainError("Quantity must be positive.");
  if (!input.reason.trim()) throw new DomainError("Give the reason for the return; it goes on the debit note.");
  const lot = await db.lot.findUnique({
    where: { lotNumber: input.lotNumber.trim() },
    include: { balances: { include: { location: true } }, grnLine: { include: { poLine: { include: { po: true } } } } },
  });
  if (!lot) throw new DomainError(`Unknown lot ${input.lotNumber}.`);
  if (lot.qcStatus !== "REJECTED") throw new DomainError(`Lot ${lot.lotNumber} is ${lot.qcStatus}; only a rejected lot can be returned to the supplier.`);
  if (!lot.grnLine) throw new DomainError(`Lot ${lot.lotNumber} wasn't received against a PO, so there is no supplier to return it to.`);

  return db.$transaction(async (tx) => {
    // Re-read inside the transaction so two returns can't both take the same stock.
    const balances = (await tx.stockBalance.findMany({ where: { lotId: lot.id, qty: { gt: 0 } }, orderBy: { qty: "desc" } }));
    const onHand = balances.reduce((s, b) => s + Number(b.qty), 0);
    if (input.qty > onHand + 1e-9) throw new DomainError(`Only ${onHand} of ${lot.lotNumber} is left to return; you asked for ${input.qty}.`);

    const rtv = await tx.returnToVendor.create({
      data: {
        rtvNumber: await nextNumber(tx, "RTV", "returnToVendor"), debitNoteNumber: await nextNumber(tx, "DN", "returnToVendor"),
        supplierId: lot.grnLine!.poLine.po.supplierId, lotId: lot.id, qty: input.qty, unitPrice: lot.grnLine!.poLine.price,
        reason: input.reason.trim(), createdById: input.userId,
      },
    });
    let left = input.qty;
    for (const b of balances) {
      if (left <= 1e-9) break;
      const take = Math.min(left, Number(b.qty));
      await tx.stockBalance.update({ where: { id: b.id }, data: { qty: { decrement: take } } });
      await tx.stockTransaction.create({
        data: { type: "RTV_OUT", lotId: lot.id, locationId: b.locationId, qty: -take, refType: "RTV", refId: rtv.id, userId: input.userId, note: input.reason.trim() },
      });
      left -= take;
    }
    return rtv;
  });
}

/** Everything the printable debit note needs. */
export async function debitNoteData(id: string, db: Db = defaultDb) {
  const rtv = await db.returnToVendor.findUnique({
    where: { id },
    include: { supplier: true, lot: { include: { item: true, grnLine: { include: { poLine: { include: { po: true } } } } } } },
  });
  if (!rtv) throw new DomainError("Unknown return.");
  const rate = Number(rtv.unitPrice), qty = Number(rtv.qty);
  return {
    rtv, company, date: rtv.createdAt, rate, qty, value: Math.round(qty * rate * 100) / 100,
    poNumber: rtv.lot.grnLine?.poLine.po.poNumber ?? null,
  };
}
