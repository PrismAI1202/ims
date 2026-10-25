import { isBlend, type BomLineInput } from "./bom-math";

export type Policy = "KANBAN" | "ROP";

export interface MrpItem {
  id: string; code: string; name: string; uom: string; category: string;
  minStock: number; reorderPoint: number; maxStock: number; safetyStock: number;
  onHand: number; // usable (approved) stock
  incoming: number; // open purchase order quantity not yet received
}

export interface MrpBom {
  fgItemId: string; cavities: number; partWeightG: number; runnerWeightG: number;
  scrapPct: number; // allowance for rejects when planning how many parts to make
  lines: BomLineInput[];
}

export interface MrpDemand {
  segment: "AUTOMOTIVE" | "NON_AUTOMOTIVE";
  fgItemId: string; dueDate: Date; qty: number;
}

export interface MrpRow {
  itemId: string; code: string; name: string; uom: string; category: string;
  role: "FG" | "COMPONENT" | "STOCK";
  policy: Policy;
  gross: number; onHand: number; incoming: number; projected: number;
  suggested: number;
  inHouse: boolean; // regrind: made in-house, never bought
  earliestDue: Date | null;
  reason: string;
}

const COMPONENT_CATEGORIES = new Set(["RM_RESIN", "RM_MASTERBATCH", "RM_ADDITIVE", "RM_FILLER", "BOP", "PACKAGING"]);

// Whole units for counted goods, 0.1 for weights, always rounding up so the plan never under-buys.
export function roundUp(n: number, uom: string): number {
  if (n <= 0) return 0;
  if (["NOS", "ROLL", "PCS", "SET"].includes(uom.toUpperCase())) return Math.ceil(n - 1e-9);
  return Math.ceil(n * 10 - 1e-9) / 10;
}

// How much to replenish given the projected closing stock.
// KANBAN (automotive): strict minimum. If the projection drops below the minimum, refill to the reorder level.
// ROP (non-automotive): once at or below the reorder point, order up to the maximum (or twice the ROP if no max).
export function replenishment(policy: Policy, projected: number, i: Pick<MrpItem, "minStock" | "reorderPoint" | "maxStock" | "safetyStock">): number {
  if (policy === "KANBAN") {
    const floor = Math.max(i.minStock, i.safetyStock);
    if (!(projected < floor)) return 0;
    return Math.max(Math.max(i.reorderPoint, floor) - projected, 0);
  }
  const rop = Math.max(i.reorderPoint, i.safetyStock);
  if (!(projected <= rop && (rop > 0 || projected < 0))) return 0;
  const target = i.maxStock > rop ? i.maxStock : Math.max(rop * 2, rop + 1);
  return Math.max(target - projected, 0);
}

// Latest date an order can be placed and still arrive for the earliest need.
export function orderByDate(earliestDue: Date | null, leadTimeDays: number, today: Date) {
  const startOfToday = new Date(today.toISOString().slice(0, 10));
  // No specific need date (a plain reorder): order now. It can't be "late" against a date nobody set.
  if (!earliestDue) return { orderBy: startOfToday, late: false };
  const orderBy = new Date(earliestDue.getTime() - leadTimeDays * 86_400_000);
  return { orderBy, late: orderBy.getTime() < startOfToday.getTime() };
}

export function runMrp(input: { items: MrpItem[]; boms: MrpBom[]; demand: MrpDemand[]; horizonEnd: Date }): MrpRow[] {
  const items = new Map(input.items.map((i) => [i.id, i]));
  const bomByFg = new Map(input.boms.map((b) => [b.fgItemId, b]));
  const demand = input.demand.filter((d) => d.dueDate.getTime() <= input.horizonEnd.getTime() && d.qty > 0);

  const rows = new Map<string, MrpRow>();
  const earliest = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : a ?? b);

  const row = (id: string, role: MrpRow["role"]): MrpRow => {
    let r = rows.get(id);
    if (!r) {
      const it = items.get(id)!;
      r = {
        itemId: id, code: it.code, name: it.name, uom: it.uom, category: it.category, role, policy: "ROP",
        gross: 0, onHand: it.onHand, incoming: it.incoming, projected: it.onHand + it.incoming,
        suggested: 0, inHouse: it.category === "REGRIND", earliestDue: null, reason: "",
      };
      rows.set(id, r);
    }
    return r;
  };

  // 1. Finished goods: demand against stock, under the policy of the customers asking for them.
  const fgDemand = new Map<string, { gross: number; due: Date; automotive: boolean }>();
  for (const d of demand) {
    if (!items.has(d.fgItemId)) continue;
    const cur = fgDemand.get(d.fgItemId) ?? { gross: 0, due: d.dueDate, automotive: false };
    cur.gross += d.qty;
    cur.due = d.dueDate < cur.due ? d.dueDate : cur.due;
    cur.automotive ||= d.segment === "AUTOMOTIVE";
    fgDemand.set(d.fgItemId, cur);
  }

  const toMake: { fgItemId: string; parts: number; due: Date; policy: Policy }[] = [];
  for (const [fgId, d] of fgDemand) {
    const it = items.get(fgId)!;
    const r = row(fgId, "FG");
    r.policy = d.automotive ? "KANBAN" : "ROP";
    r.gross = d.gross;
    r.earliestDue = d.due;
    r.projected = it.onHand + it.incoming - d.gross;
    r.suggested = roundUp(replenishment(r.policy, r.projected, it), it.uom);
    r.reason = r.suggested > 0
      ? r.projected < 0 ? `Demand ${d.gross} exceeds stock ${it.onHand}` : `Buffer would fall to ${r.projected}`
      : "Covered by stock";
    if (r.suggested > 0) toMake.push({ fgItemId: fgId, parts: r.suggested, due: d.due, policy: r.policy });
  }

  // 2. Components: what making those parts consumes, through the BOM.
  for (const m of toMake) {
    const bom = bomByFg.get(m.fgItemId);
    if (!bom) {
      rows.get(m.fgItemId)!.reason += " — no BOM, components not planned";
      continue;
    }
    const parts = Math.ceil(m.parts / (1 - Math.min(bom.scrapPct, 99) / 100));
    const shots = Math.ceil(parts / bom.cavities);
    const materialKg = (shots * (bom.cavities * bom.partWeightG + bom.runnerWeightG)) / 1000;
    for (const l of bom.lines) {
      if (!items.has(l.itemId)) continue;
      const qty = isBlend(l.kind) ? (materialKg * (l.pct ?? 0)) / 100 : (l.qtyPerPart ?? 0) * parts;
      const r = row(l.itemId, "COMPONENT");
      r.gross += qty;
      r.earliestDue = earliest(r.earliestDue, m.due);
      if (m.policy === "KANBAN") r.policy = "KANBAN";
    }
  }
  for (const r of rows.values()) {
    if (r.role !== "COMPONENT") continue;
    const it = items.get(r.itemId)!;
    r.projected = it.onHand + it.incoming - r.gross;
    r.suggested = roundUp(replenishment(r.policy, r.projected, it), it.uom);
    r.reason = r.suggested > 0
      ? r.projected < 0 ? `Needs ${roundUp(r.gross, it.uom)}, only ${it.onHand + it.incoming} on hand/ordered` : "Would fall below the stock policy level"
      : "Covered by stock";
  }

  // 3. Plain stock replenishment: materials with no demand this horizon but already at or below their level.
  for (const it of input.items) {
    if (rows.has(it.id) || !COMPONENT_CATEGORIES.has(it.category)) continue;
    const projected = it.onHand + it.incoming;
    const suggested = roundUp(replenishment("ROP", projected, it), it.uom);
    if (suggested > 0) {
      rows.set(it.id, {
        itemId: it.id, code: it.code, name: it.name, uom: it.uom, category: it.category, role: "STOCK", policy: "ROP",
        gross: 0, onHand: it.onHand, incoming: it.incoming, projected, suggested, inHouse: false, earliestDue: null,
        reason: "At or below reorder point",
      });
    }
  }

  return [...rows.values()].sort((a, b) => Number(b.suggested > 0) - Number(a.suggested > 0) || a.code.localeCompare(b.code));
}
