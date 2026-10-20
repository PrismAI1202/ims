import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError, createPurchaseOrder } from "./inventory";
import { orderByDate, runMrp, type MrpBom, type MrpRow } from "./mrp-engine";
import { stockByItem } from "./stock";

type Db = PrismaClient;

export interface PlanOptions { horizonDays: number; scrapPct: number; today?: Date }

export interface PlanRow extends MrpRow {
  buyable: boolean;
  supplier: { id: string; name: string; price: number; leadTimeDays: number } | null;
  orderBy: Date | null;
  late: boolean;
}

// Cheapest supplier that has a price on file for the item.
async function bestSuppliers(db: Db, itemIds: string[]) {
  const prices = await db.priceMaster.findMany({ where: { itemId: { in: itemIds }, supplier: { active: true } }, include: { supplier: true } });
  const best = new Map<string, (typeof prices)[number]>();
  for (const p of prices) {
    const cur = best.get(p.itemId);
    if (!cur || Number(p.price) < Number(cur.price)) best.set(p.itemId, p);
  }
  return best;
}

export async function planMrp(opts: PlanOptions, db: Db = defaultDb): Promise<{ rows: PlanRow[]; horizonEnd: Date; demandLines: number }> {
  const today = opts.today ?? new Date();
  const startOfToday = new Date(today.toISOString().slice(0, 10));
  const horizonEnd = new Date(startOfToday.getTime() + opts.horizonDays * 86_400_000);

  const [stock, openPo, boms, demand] = await Promise.all([
    stockByItem(db),
    db.purchaseOrderLine.findMany({ where: { po: { status: { in: ["APPROVED", "PARTIAL"] } } }, select: { itemId: true, qty: true, receivedQty: true } }),
    db.bom.findMany({ include: { mould: true, lines: true } }),
    db.demandLine.findMany({ where: { dueDate: { lte: horizonEnd } }, include: { customer: true } }),
  ]);
  const itemRows = await db.item.findMany({ where: { active: true } });
  const levels = new Map(itemRows.map((i) => [i.id, i]));

  const incoming = new Map<string, number>();
  for (const l of openPo) incoming.set(l.itemId, (incoming.get(l.itemId) ?? 0) + Math.max(Number(l.qty) - Number(l.receivedQty), 0));

  const mrpBoms: MrpBom[] = boms.map((b) => ({
    fgItemId: b.fgItemId, cavities: b.mould.cavities, partWeightG: Number(b.partWeightG),
    runnerWeightG: Number(b.mould.runnerWeightG ?? 0), scrapPct: opts.scrapPct,
    lines: b.lines.map((l) => ({ itemId: l.itemId, kind: l.kind, pct: l.pct === null ? undefined : Number(l.pct), qtyPerPart: l.qtyPerPart === null ? undefined : Number(l.qtyPerPart) })),
  }));

  const rows = runMrp({
    items: stock.map((s) => ({
      id: s.itemId, code: s.code, name: s.name, uom: s.uom, category: s.category,
      minStock: s.minStock, reorderPoint: s.reorderPoint, maxStock: s.maxStock,
      safetyStock: Number(levels.get(s.itemId)?.safetyStock ?? 0), onHand: s.onHand, incoming: incoming.get(s.itemId) ?? 0,
    })),
    boms: mrpBoms,
    demand: demand.map((d) => ({ segment: d.customer.segment, fgItemId: d.fgItemId, dueDate: d.dueDate, qty: d.qty })),
    horizonEnd,
  });

  const needBuy = rows.filter((r) => r.suggested > 0 && r.role !== "FG" && !r.inHouse);
  const suppliers = await bestSuppliers(db, needBuy.map((r) => r.itemId));
  const planned: PlanRow[] = rows.map((r) => {
    const buyable = r.role !== "FG" && !r.inHouse && r.suggested > 0;
    const s = suppliers.get(r.itemId);
    const supplier = buyable && s ? { id: s.supplierId, name: s.supplier.name, price: Number(s.price), leadTimeDays: s.supplier.leadTimeDays } : null;
    const ob = supplier ? orderByDate(r.earliestDue, supplier.leadTimeDays, today) : null;
    return { ...r, buyable, supplier, orderBy: ob?.orderBy ?? null, late: ob?.late ?? false };
  });
  return { rows: planned, horizonEnd, demandLines: demand.length };
}

// Turns chosen suggestions into approved POs, one per supplier and segment. Quantities and prices are
// recomputed on the server; the client only says which items, and optionally a larger or smaller quantity.
export async function createPosFromPlan(
  input: { selections: { itemId: string; qty?: number }[]; opts: PlanOptions; userId?: string },
  db: Db = defaultDb,
) {
  if (input.selections.length === 0) throw new DomainError("Select at least one item to order.");
  const { rows } = await planMrp(input.opts, db);
  const byItem = new Map(rows.map((r) => [r.itemId, r]));

  const groups = new Map<string, { supplierId: string; segment: "AUTOMOTIVE" | "NON_AUTOMOTIVE"; lines: { itemId: string; qty: number; price: number; expectedDate?: Date }[] }>();
  for (const sel of input.selections) {
    const r = byItem.get(sel.itemId);
    if (!r || !r.buyable) throw new DomainError("One of the selected items no longer needs ordering. Refresh the plan.");
    if (!r.supplier) throw new DomainError(`${r.code} has no supplier price on file. Add one in Masters first.`);
    const qty = sel.qty ?? r.suggested;
    if (!(qty > 0)) throw new DomainError(`Quantity for ${r.code} must be above 0.`);
    const segment = r.policy === "KANBAN" ? "AUTOMOTIVE" : "NON_AUTOMOTIVE";
    const key = `${r.supplier.id}:${segment}`;
    const g = groups.get(key) ?? { supplierId: r.supplier.id, segment, lines: [] };
    g.lines.push({ itemId: r.itemId, qty, price: r.supplier.price, expectedDate: r.earliestDue ?? undefined });
    groups.set(key, g);
  }

  const created = [];
  for (const g of groups.values()) {
    created.push(await createPurchaseOrder({ supplierId: g.supplierId, segment: g.segment, lines: g.lines, userId: input.userId }, db));
  }
  return created;
}
