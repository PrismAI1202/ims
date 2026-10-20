import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

export interface PoLineInput { itemId: string; qty: number; price: number; expectedDate?: Date }

async function loadEditable(db: Db | Parameters<Parameters<Db["$transaction"]>[0]>[0], poId: string) {
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) throw new DomainError("Unknown purchase order.");
  return po;
}

const received = (po: { lines: { receivedQty: unknown }[] }) => po.lines.some((l) => Number(l.receivedQty) > 0);

// Replaces the lines of an order. Only possible before any goods have been received against it, because
// GRNs and lots point at the existing lines.
export async function updatePurchaseOrder(poId: string, lines: PoLineInput[], db: Db = defaultDb) {
  if (lines.length === 0) throw new DomainError("A PO needs at least one line.");
  if (lines.some((l) => !(l.qty > 0))) throw new DomainError("Quantities must be above 0.");
  if (lines.some((l) => !(l.price >= 0))) throw new DomainError("Prices can't be negative.");
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw new DomainError("Each item may appear once on a PO.");

  return db.$transaction(async (tx) => {
    const po = await loadEditable(tx, poId);
    if (po.status !== "APPROVED" && po.status !== "DRAFT") throw new DomainError(`${po.poNumber} is ${po.status.toLowerCase()} and can't be edited.`);
    if (received(po)) throw new DomainError(`${po.poNumber} already has goods received; it can no longer be edited. Close it short instead.`);
    const items = await tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, active: true } });
    if (items.length !== lines.length) throw new DomainError("A line uses an item that doesn't exist or is inactive.");

    await tx.purchaseOrderLine.deleteMany({ where: { poId } });
    await tx.purchaseOrderLine.createMany({
      data: lines.map((l) => ({ poId, itemId: l.itemId, qty: l.qty, price: l.price, expectedDate: l.expectedDate })),
    });
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  });
}

export async function cancelPurchaseOrder(poId: string, db: Db = defaultDb) {
  return db.$transaction(async (tx) => {
    const po = await loadEditable(tx, poId);
    if (po.status === "CANCELLED") throw new DomainError(`${po.poNumber} is already cancelled.`);
    if (po.status === "CLOSED") throw new DomainError(`${po.poNumber} is closed.`);
    if (received(po)) throw new DomainError(`${po.poNumber} already has goods received. Use “Close short” to stop waiting for the rest.`);
    return tx.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED" } });
  });
}

// For a part-delivered order the supplier won't finish: stop expecting the balance so MRP no longer counts it as incoming.
export async function closePurchaseOrderShort(poId: string, db: Db = defaultDb) {
  return db.$transaction(async (tx) => {
    const po = await loadEditable(tx, poId);
    if (po.status !== "PARTIAL") throw new DomainError("Only a partly received order can be closed short.");
    return tx.purchaseOrder.update({ where: { id: poId }, data: { status: "CLOSED" } });
  });
}
