import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { stockStatus, type StockStatus } from "./stock-status";

export interface ItemStockRow {
  itemId: string;
  code: string;
  name: string;
  category: string;
  uom: string;
  onHand: number; // approved, usable stock
  pendingQc: number;
  minStock: number;
  reorderPoint: number;
  maxStock: number;
  status: StockStatus;
}

// On-hand counts only APPROVED/DEVIATED lots; PENDING_QC is shown separately and REJECTED is excluded.
export async function stockByItem(client: PrismaClient = db): Promise<ItemStockRow[]> {
  const [items, balances] = await Promise.all([
    client.item.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    client.stockBalance.findMany({ include: { lot: { select: { itemId: true, qcStatus: true } } } }),
  ]);

  const usable = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const b of balances) {
    const q = Number(b.qty);
    const { itemId, qcStatus } = b.lot;
    if (qcStatus === "APPROVED" || qcStatus === "DEVIATED") usable.set(itemId, (usable.get(itemId) ?? 0) + q);
    else if (qcStatus === "PENDING_QC") pending.set(itemId, (pending.get(itemId) ?? 0) + q);
  }

  return items.map((i) => {
    const onHand = usable.get(i.id) ?? 0;
    const minStock = Number(i.minStock);
    const reorderPoint = Number(i.reorderPoint);
    return {
      itemId: i.id, code: i.code, name: i.name, category: i.category, uom: i.uom,
      onHand, pendingQc: pending.get(i.id) ?? 0,
      minStock, reorderPoint, maxStock: Number(i.maxStock),
      status: stockStatus(onHand, { minStock, reorderPoint }),
    };
  });
}
