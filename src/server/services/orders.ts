import { db as defaultDb } from "@/server/db";
import type { PrismaClient, Segment } from "@prisma/client";
import { dispatchProgress } from "./dispatch";

type Db = PrismaClient;

export type OrderDirection = "BUY" | "SELL";
/** open = still active, overdue = late and unfinished, closed = finished or cancelled. */
export type OrderState = "open" | "overdue" | "closed";

export type OrderType = "PO" | "DISPATCH" | "DEMAND";

export type OrderRow = {
  key: string;
  id: string; // the PO, dispatch or demand line behind the row
  type: OrderType;
  ref?: string; // a PO's number from another system, when it has one
  direction: OrderDirection;
  partyId: string;
  segment: Segment;
  searchText: string; // extra words the search box should find (vehicle, driver, segment)
  actions: ("edit" | "cancel" | "closeShort")[]; // what may still be done to a PO from the list (the page checks permission)
  number: string;
  party: string;
  kind: string;
  status: string;
  state: OrderState;
  tone: "ok" | "danger" | "warn" | "info" | "neutral";
  date: Date;
  href: string | null;
  lines: { label: string; sub?: string; done?: number; total: number; uom: string }[];
};

const startOfToday = () => new Date(new Date().toDateString());

/**
 * One list of everything the plant has bought or sold. Buy = supplier POs. Sell = firm and spot customer demand
 * plus dispatches. Forecast demand is left out because it is not an order. Demand lines have no link to the
 * dispatches that fulfil them, so they carry no progress figure rather than an invented one.
 */
export async function listOrders(db: Db = defaultDb): Promise<OrderRow[]> {
  const today = startOfToday();
  const [pos, demand, dispatches] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 500,
      include: { supplier: true, lines: { include: { item: true } } },
    }),
    db.demandLine.findMany({
      where: { type: { in: ["FIRM", "SPOT"] } }, orderBy: { dueDate: "asc" }, take: 500,
      include: { customer: true, fgItem: true },
    }),
    db.dispatch.findMany({
      orderBy: { createdAt: "desc" }, take: 500,
      include: { customer: true, lines: { include: { item: true } } },
    }),
  ]);

  const rows: OrderRow[] = [];

  for (const p of pos) {
    const active = p.status === "APPROVED" || p.status === "PARTIAL";
    const late = active && p.lines.some((l) => l.expectedDate && l.expectedDate < today && Number(l.receivedQty) < Number(l.qty));
    rows.push({
      key: `po-${p.id}`, id: p.id, type: "PO", partyId: p.supplierId, segment: p.segment, searchText: [p.externalRef, p.segment === "AUTOMOTIVE" ? "automotive" : "non-automotive"].filter(Boolean).join(" "), ref: p.externalRef ?? undefined,
      actions: p.status === "PARTIAL" ? ["closeShort"] : p.status === "APPROVED" && p.lines.every((l) => Number(l.receivedQty) === 0) ? ["edit", "cancel"] : [],
      direction: "BUY", number: p.poNumber, party: p.supplier.name,
      kind: p.segment === "AUTOMOTIVE" ? "Automotive PO" : "PO",
      status: late ? "LATE" : p.status, state: !active ? "closed" : late ? "overdue" : "open",
      tone: p.status === "CLOSED" ? "ok" : p.status === "CANCELLED" ? "danger" : late || p.status === "PARTIAL" ? "warn" : "info",
      date: p.createdAt, href: `/purchase/${p.id}`,
      lines: p.lines.map((l) => ({ label: l.item.code, sub: l.item.name, done: Number(l.receivedQty), total: Number(l.qty), uom: l.item.uom })),
    });
  }

  for (const d of demand) {
    const done = d.shippedQty >= d.qty;
    const late = !done && d.dueDate < today;
    rows.push({
      key: `dl-${d.id}`, id: d.id, type: "DEMAND", partyId: d.customerId, segment: d.customer.segment, searchText: d.customer.segment === "AUTOMOTIVE" ? "automotive" : "non-automotive", actions: [],
      direction: "SELL", number: `${d.type} · ${d.fgItem.code}`, party: d.customer.name,
      kind: d.type === "FIRM" ? "Firm order" : "Spot order",
      status: done ? "SHIPPED" : late ? "PAST DUE" : d.shippedQty > 0 ? "PART SHIPPED" : "OPEN",
      state: done ? "closed" : late ? "overdue" : "open", tone: done ? "ok" : late ? "warn" : "info",
      date: d.dueDate, href: "/demand",
      lines: [{ label: d.fgItem.code, sub: `${d.fgItem.name} · due ${d.dueDate.toISOString().slice(0, 10)}`, done: d.shippedQty, total: d.qty, uom: "pcs" }],
    });
  }

  const loading = new Map(
    await Promise.all(dispatches.filter((x) => x.status === "LOADING").map(async (x) => [x.id, await dispatchProgress(x.id, db)] as const)),
  );
  for (const x of dispatches) {
    const pr = loading.get(x.id);
    rows.push({
      key: `dc-${x.id}`, id: x.id, type: "DISPATCH", partyId: x.customerId, segment: x.customer.segment, actions: [],
      searchText: [x.vehicleNumber, x.driverName, x.customer.segment === "AUTOMOTIVE" ? "automotive" : "non-automotive"].filter(Boolean).join(" "),
      direction: "SELL", number: x.dcNumber, party: x.customer.name, kind: "Dispatch",
      status: x.status, state: x.status === "LOADING" ? "open" : "closed",
      tone: x.status === "DISPATCHED" ? "ok" : x.status === "CANCELLED" ? "danger" : "warn",
      date: x.createdAt, href: `/dispatch/${x.id}`,
      lines: x.lines.map((l) => ({
        label: l.item.code, sub: l.item.name, total: l.qty, uom: "pcs",
        done: x.status === "DISPATCHED" ? l.qty : x.status === "LOADING" ? Math.min(pr?.lines.find((pl) => pl.itemId === l.itemId)?.scanned ?? 0, l.qty) : undefined,
      })),
    });
  }

  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}

// ───────── Filtering ─────────

export type OrderKind = "po" | "dispatch" | "demand";
/** active = open or overdue (still to be done), overdue = late only, closed = finished or cancelled. */
export type OrderStateFilter = "active" | "overdue" | "closed";

export interface OrderFilters {
  dir?: OrderDirection;
  kind?: OrderKind;
  state?: OrderStateFilter;
  party?: string; // supplier or customer id
  segment?: Segment;
  from?: string; // YYYY-MM-DD, inclusive: the order date (PO / dispatch created, demand due)
  to?: string;
  q?: string;
  sort?: "new" | "old";
}

const KIND_TYPE: Record<OrderKind, OrderType> = { po: "PO", dispatch: "DISPATCH", demand: "DEMAND" };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The rows that pass every filter that is set, in the chosen order. Pure, so the rules can be tested without a database. */
export function filterOrders(rows: OrderRow[], f: OrderFilters): OrderRow[] {
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out = rows.filter((o) => {
    if (f.dir && o.direction !== f.dir) return false;
    if (f.kind && o.type !== KIND_TYPE[f.kind]) return false;
    if (f.state === "active" && o.state === "closed") return false;
    if (f.state === "overdue" && o.state !== "overdue") return false;
    if (f.state === "closed" && o.state !== "closed") return false;
    if (f.party && o.partyId !== f.party) return false;
    if (f.segment && o.segment !== f.segment) return false;
    if (f.from && day(o.date) < f.from) return false;
    if (f.to && day(o.date) > f.to) return false;
    if (words.length) {
      const hay = [o.number, o.party, o.kind, o.status, o.searchText, ...o.lines.flatMap((l) => [l.label, l.sub ?? ""])].join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  return out.sort((a, b) => (f.sort === "old" ? 1 : -1) * (a.date.getTime() - b.date.getTime()));
}

/** Suppliers and customers that appear in the list, for the party filter. */
export function orderParties(rows: OrderRow[]): { id: string; name: string; direction: OrderDirection }[] {
  const seen = new Map<string, { id: string; name: string; direction: OrderDirection }>();
  for (const o of rows) if (!seen.has(o.partyId)) seen.set(o.partyId, { id: o.partyId, name: o.party, direction: o.direction });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const PAGE_SIZE = 25;

/** One page of a list, with the page number clamped into range. */
export function paginate<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: items.slice((at - 1) * size, at * size), page: at, pages, total: items.length, from: items.length ? (at - 1) * size + 1 : 0, to: Math.min(at * size, items.length) };
}
