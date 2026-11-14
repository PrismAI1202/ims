import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError, createPurchaseOrder } from "./inventory";
import { orderByDate, runMrp, type MrpBom, type MrpRow } from "./mrp-engine";
import { stockByItem } from "./stock";
import { partsPerDay } from "./planning";
import { remainingQty } from "./demand";
import { groupForPos } from "@/lib/po-groups";
import { getShiftMinutes } from "./settings";

type Db = PrismaClient;

export interface PlanOptions { horizonDays: number; scrapPct: number; today?: Date }


// Every active supplier with a price on file for each item, cheapest first. The first is the default; the buyer may pick another.
async function suppliersFor(db: Db, itemIds: string[]) {
  const prices = await db.priceMaster.findMany({ where: { itemId: { in: itemIds }, supplier: { active: true } }, include: { supplier: true } });
  const by = new Map<string, { id: string; name: string; price: number; leadTimeDays: number }[]>();
  for (const p of prices) {
    const list = by.get(p.itemId) ?? [];
    list.push({ id: p.supplierId, name: p.supplier.name, price: Number(p.price), leadTimeDays: p.supplier.leadTimeDays });
    by.set(p.itemId, list);
  }
  for (const list of by.values()) list.sort((x, y) => x.price - y.price || x.leadTimeDays - y.leadTimeDays);
  return by;
}

/** The horizons the MRP screen offers by default; a custom number of days sits beside them. */
export const HORIZON_PRESETS = [
  { days: 7, key: "week", label: "Next week" },
  { days: 30, key: "month", label: "Next month" },
  { days: 90, key: "quarter", label: "Next quarter" },
] as const;

export interface DemandDriver { customer: string; segment: string; type: string; dueDate: Date; qty: number }
export interface PartDriver { fgItemId: string; code: string; name: string; parts: number; qty: number; bomId: string | null; customers: string[] }
export interface OpenPo { poId: string; poNumber: string; supplier: string; qty: number; expected: Date | null; status: string }

export interface PlanRow extends MrpRow {
  buyable: boolean;
  supplier: { id: string; name: string; price: number; leadTimeDays: number } | null; // the cheapest, used unless another is chosen
  options: { id: string; name: string; price: number; leadTimeDays: number }[]; // every active supplier with a price for it, cheapest first
  orderBy: Date | null;
  late: boolean;
  /** `incoming` split by where it comes from: open POs for materials, machine-plan output for a finished good. */
  onOrder: number; inProduction: number; plannedDays: number;
  pendingQc: number;
  minStock: number; maxStock: number; reorderPointLevel: number; safetyStock: number;
  /** Quantity needed from demand in each preset horizon and the one being viewed, keyed by days. */
  needBy: Record<number, number>;
  demandLines: DemandDriver[]; // finished goods: the customer demand behind it
  partDrivers: PartDriver[];   // materials: the parts whose production asks for it
  openPos: OpenPo[];
}

const DAY_MS = 86_400_000;

async function loadInputs(db: Db, today: Date, maxDays: number) {
  const startOfToday = new Date(today.toISOString().slice(0, 10));
  const horizonEnd = new Date(startOfToday.getTime() + maxDays * DAY_MS);
  const [stock, openPo, boms, demandAll, itemRows, slots, shiftMinutes] = await Promise.all([
    stockByItem(db),
    db.purchaseOrderLine.findMany({ where: { po: { status: { in: ["APPROVED", "PARTIAL"] } } }, include: { po: { include: { supplier: true } } } }),
    db.bom.findMany({ include: { mould: true, lines: true } }),
    db.demandLine.findMany({ where: { dueDate: { lte: horizonEnd } }, include: { customer: true } }),
    db.item.findMany({ where: { active: true } }),
    db.planSlot.findMany({ where: { kind: "JOB", fgItemId: { not: null }, day: { gte: startOfToday, lte: horizonEnd } }, include: { mould: true } }),
    getShiftMinutes(db),
  ]);
  // Only what is still to ship counts: a completed order has been made and sent, and must not be planned again.
  const demand = demandAll.filter((d) => remainingQty(d) > 0).map((d) => ({ ...d, qty: remainingQty(d) }));
  return { startOfToday, stock, openPo, boms, demand, itemRows, slots, shiftMinutes };
}
type Inputs = Awaited<ReturnType<typeof loadInputs>>;

/** The engine's rows for one horizon. A finished good counts what the machine plan will make in that time as already coming. */
function rowsFor(inp: Inputs, days: number, scrapPct: number) {
  const horizonEnd = new Date(inp.startOfToday.getTime() + days * DAY_MS);
  const levels = new Map(inp.itemRows.map((i) => [i.id, i]));

  const onOrder = new Map<string, number>();
  for (const l of inp.openPo) onOrder.set(l.itemId, (onOrder.get(l.itemId) ?? 0) + Math.max(Number(l.qty) - Number(l.receivedQty), 0));

  const made = new Map<string, { parts: number; days: number }>();
  for (const sl of inp.slots) {
    if (!sl.fgItemId || sl.day.getTime() > horizonEnd.getTime()) continue;
    const per = partsPerDay(sl.mould?.cavities ?? 0, sl.mould?.idealCycleSec === null || sl.mould?.idealCycleSec === undefined ? null : Number(sl.mould.idealCycleSec), inp.shiftMinutes);
    const cur = made.get(sl.fgItemId) ?? { parts: 0, days: 0 };
    cur.parts += per ?? 0; cur.days += 1;
    made.set(sl.fgItemId, cur);
  }

  const mrpBoms: MrpBom[] = inp.boms.map((b) => ({
    fgItemId: b.fgItemId, cavities: b.mould.cavities, partWeightG: Number(b.partWeightG),
    runnerWeightG: Number(b.mould.runnerWeightG ?? 0), scrapPct,
    lines: b.lines.map((l) => ({ itemId: l.itemId, kind: l.kind, pct: l.pct === null ? undefined : Number(l.pct), qtyPerPart: l.qtyPerPart === null ? undefined : Number(l.qtyPerPart) })),
  }));
  const demand = inp.demand.filter((d) => d.dueDate.getTime() <= horizonEnd.getTime());

  const rows = runMrp({
    items: inp.stock.map((s) => ({
      id: s.itemId, code: s.code, name: s.name, uom: s.uom, category: s.category,
      minStock: s.minStock, reorderPoint: s.reorderPoint, maxStock: s.maxStock,
      safetyStock: Number(levels.get(s.itemId)?.safetyStock ?? 0), onHand: s.onHand,
      incoming: (onOrder.get(s.itemId) ?? 0) + (made.get(s.itemId)?.parts ?? 0),
    })),
    boms: mrpBoms,
    demand: demand.map((d) => ({ segment: d.customer.segment, fgItemId: d.fgItemId, dueDate: d.dueDate, qty: d.qty })),
    horizonEnd,
  });
  return { rows, horizonEnd, demand, onOrder, made };
}

export interface DemandBucket { key: string; label: string; lines: number; parts: number }

/** How the loaded customer demand is spread over time, so it is clear why a wider horizon does (or does not) add anything. */
function spreadOf(inp: Inputs, beyond: { lines: number; parts: number }): DemandBucket[] {
  const out: DemandBucket[] = [
    ["overdue", "Overdue"], ["week", "Next 7 days"], ["month", "8 to 30 days"], ["quarter", "31 to 90 days"], ["later", "Beyond 90 days"],
  ].map(([key, label]) => ({ key, label, lines: 0, parts: 0 }));
  // Upper edges are inclusive, like the horizons themselves: a line due in exactly 7 days is inside the 7-day horizon.
  for (const d of inp.demand) {
    const age = (d.dueDate.getTime() - inp.startOfToday.getTime()) / DAY_MS;
    const i = age < 0 ? 0 : age <= 7 ? 1 : age <= 30 ? 2 : age <= 90 ? 3 : 4;
    out[i].lines += 1; out[i].parts += d.qty;
  }
  out[4].lines += beyond.lines; out[4].parts += beyond.parts;
  return out;
}

export async function planMrp(opts: PlanOptions, db: Db = defaultDb): Promise<{ rows: PlanRow[]; horizonEnd: Date; demandLines: number; demandSpread: DemandBucket[] }> {
  const today = opts.today ?? new Date();
  // Load once for the longest horizon shown, then run the engine for each: the preset horizons only add a "needed by" figure per row.
  const horizons = [...new Set<number>([...HORIZON_PRESETS.map((h) => h.days), opts.horizonDays])].sort((a, b) => a - b);
  const inp = await loadInputs(db, today, horizons[horizons.length - 1]);
  const lastEnd = new Date(inp.startOfToday.getTime() + horizons[horizons.length - 1] * DAY_MS);
  const laterLines = (await db.demandLine.findMany({ where: { dueDate: { gt: lastEnd } }, select: { qty: true, shippedQty: true } })).filter((d) => remainingQty(d) > 0);
  const later = { _count: laterLines.length, _sum: { qty: laterLines.reduce((a, d) => a + remainingQty(d), 0) } };
  const main = rowsFor(inp, opts.horizonDays, opts.scrapPct);
  const needByHorizon = new Map(horizons.map((h) => [h, new Map(rowsFor(inp, h, opts.scrapPct).rows.map((r) => [r.itemId, r.gross]))]));

  const needBuy = main.rows.filter((r) => r.suggested > 0 && r.role !== "FG" && !r.inHouse);
  const suppliers = await suppliersFor(db, needBuy.map((r) => r.itemId));
  const stockOf = new Map(inp.stock.map((s) => [s.itemId, s]));
  const levels = new Map(inp.itemRows.map((i) => [i.id, i]));
  const itemOf = new Map(inp.itemRows.map((i) => [i.id, i]));
  const bomOf = new Map(inp.boms.map((b) => [b.fgItemId, b.id]));

  const demandBy = new Map<string, DemandDriver[]>();
  for (const d of main.demand) {
    const list = demandBy.get(d.fgItemId) ?? [];
    list.push({ customer: d.customer.name, segment: d.customer.segment, type: d.type, dueDate: d.dueDate, qty: d.qty });
    demandBy.set(d.fgItemId, list);
  }
  const posBy = new Map<string, OpenPo[]>();
  for (const l of inp.openPo) {
    const left = Number(l.qty) - Number(l.receivedQty);
    if (left <= 0) continue;
    const list = posBy.get(l.itemId) ?? [];
    list.push({ poId: l.poId, poNumber: l.po.poNumber, supplier: l.po.supplier.name, qty: left, expected: l.expectedDate, status: l.po.status });
    posBy.set(l.itemId, list);
  }

  const planned: PlanRow[] = main.rows.map((r) => {
    const buyable = r.role !== "FG" && !r.inHouse && r.suggested > 0;
    const options = buyable ? suppliers.get(r.itemId) ?? [] : [];
    const supplier = options[0] ?? null;
    const ob = supplier ? orderByDate(r.earliestDue, supplier.leadTimeDays, today) : null;
    const inProduction = r.role === "FG" ? main.made.get(r.itemId)?.parts ?? 0 : 0;
    const lv = levels.get(r.itemId);
    return {
      ...r, buyable, supplier, options, orderBy: ob?.orderBy ?? null, late: ob?.late ?? false,
      onOrder: main.onOrder.get(r.itemId) ?? 0, inProduction, plannedDays: r.role === "FG" ? main.made.get(r.itemId)?.days ?? 0 : 0,
      pendingQc: stockOf.get(r.itemId)?.pendingQc ?? 0,
      minStock: Number(lv?.minStock ?? 0), maxStock: Number(lv?.maxStock ?? 0), reorderPointLevel: Number(lv?.reorderPoint ?? 0), safetyStock: Number(lv?.safetyStock ?? 0),
      needBy: Object.fromEntries(horizons.map((h) => [h, needByHorizon.get(h)?.get(r.itemId) ?? 0])),
      demandLines: (demandBy.get(r.itemId) ?? []).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
      partDrivers: r.drivers.map((d) => ({
        fgItemId: d.fgItemId, code: itemOf.get(d.fgItemId)?.code ?? "?", name: itemOf.get(d.fgItemId)?.name ?? "", parts: d.parts, qty: d.qty,
        bomId: bomOf.get(d.fgItemId) ?? null, customers: [...new Set((demandBy.get(d.fgItemId) ?? []).map((x) => x.customer))],
      })).sort((a, b) => b.qty - a.qty),
      openPos: (posBy.get(r.itemId) ?? []).sort((a, b) => (a.expected?.getTime() ?? 1e15) - (b.expected?.getTime() ?? 1e15)),
    };
  });
  return { rows: planned, horizonEnd: main.horizonEnd, demandLines: main.demand.length, demandSpread: spreadOf(inp, { lines: later._count, parts: later._sum.qty ?? 0 }) };
}

// Turns chosen suggestions into approved POs. Quantities and prices are recomputed on the server; the client says which items, and
// optionally a different quantity, supplier or expected date. A supplier other than the cheapest must have a price on file for the
// item. Lines for the same supplier go on one PO unless `club` is false (see lib/po-groups).
export async function createPosFromPlan(
  input: {
    selections: { itemId: string; qty?: number; supplierId?: string; expectedDate?: Date }[];
    opts: PlanOptions; club?: boolean; expedite?: boolean; expediteNote?: string; userId?: string;
  },
  db: Db = defaultDb,
) {
  if (input.selections.length === 0) throw new DomainError("Select at least one item to order.");
  const { rows } = await planMrp(input.opts, db);
  const byItem = new Map(rows.map((r) => [r.itemId, r]));

  const lines: { itemId: string; supplierId: string; policy: "KANBAN" | "ROP"; qty: number; price: number; expectedDate?: Date }[] = [];
  for (const sel of input.selections) {
    const r = byItem.get(sel.itemId);
    if (!r || !r.buyable) throw new DomainError("One of the selected items no longer needs ordering. Refresh the plan.");
    if (r.options.length === 0) throw new DomainError(`${r.code} has no supplier price on file. Add one on the item first.`);
    const chosen = sel.supplierId ? r.options.find((o) => o.id === sel.supplierId) : r.options[0];
    if (!chosen) throw new DomainError(`That supplier has no price on file for ${r.code}. Choose one of its suppliers, or add the price on the item.`);
    const qty = sel.qty ?? r.suggested;
    if (!(qty > 0)) throw new DomainError(`Quantity for ${r.code} must be above 0.`);
    lines.push({ itemId: r.itemId, supplierId: chosen.id, policy: r.policy, qty, price: chosen.price, expectedDate: sel.expectedDate ?? r.earliestDue ?? undefined });
  }

  const created = [];
  for (const g of groupForPos(lines, input.club ?? true)) {
    created.push(await createPurchaseOrder({
      supplierId: g.supplierId, segment: g.segment, userId: input.userId, expedite: input.expedite, expediteNote: input.expediteNote,
      lines: g.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, expectedDate: l.expectedDate })),
    }, db));
  }
  return created;
}
