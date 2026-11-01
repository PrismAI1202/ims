import { db as defaultDb } from "@/server/db";
import type { PrismaClient } from "@prisma/client";
import { dispatchProgress } from "./dispatch";

type Db = PrismaClient;

export type OrderDirection = "BUY" | "SELL";
/** open = still active, overdue = late and unfinished, closed = finished or cancelled. */
export type OrderState = "open" | "overdue" | "closed";

export type OrderRow = {
  key: string;
  direction: OrderDirection;
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
      where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 200,
      include: { supplier: true, lines: { include: { item: true } } },
    }),
    db.demandLine.findMany({
      where: { type: { in: ["FIRM", "SPOT"] } }, orderBy: { dueDate: "asc" }, take: 300,
      include: { customer: true, fgItem: true },
    }),
    db.dispatch.findMany({
      orderBy: { createdAt: "desc" }, take: 200,
      include: { customer: true, lines: { include: { item: true } } },
    }),
  ]);

  const rows: OrderRow[] = [];

  for (const p of pos) {
    const active = p.status === "APPROVED" || p.status === "PARTIAL";
    const late = active && p.lines.some((l) => l.expectedDate && l.expectedDate < today && Number(l.receivedQty) < Number(l.qty));
    rows.push({
      key: `po-${p.id}`, direction: "BUY", number: p.poNumber, party: p.supplier.name,
      kind: p.segment === "AUTOMOTIVE" ? "Automotive PO" : "PO",
      status: late ? "LATE" : p.status, state: !active ? "closed" : late ? "overdue" : "open",
      tone: p.status === "CLOSED" ? "ok" : p.status === "CANCELLED" ? "danger" : late || p.status === "PARTIAL" ? "warn" : "info",
      date: p.createdAt, href: `/purchase/${p.id}`,
      lines: p.lines.map((l) => ({ label: l.item.code, sub: l.item.name, done: Number(l.receivedQty), total: Number(l.qty), uom: l.item.uom })),
    });
  }

  for (const d of demand) {
    const late = d.dueDate < today;
    rows.push({
      key: `dl-${d.id}`, direction: "SELL", number: `${d.type} · ${d.fgItem.code}`, party: d.customer.name,
      kind: d.type === "FIRM" ? "Firm order" : "Spot order",
      status: late ? "PAST DUE" : "OPEN", state: late ? "overdue" : "open", tone: late ? "warn" : "info",
      date: d.dueDate, href: "/demand",
      lines: [{ label: d.fgItem.code, sub: `${d.fgItem.name} · due ${d.dueDate.toISOString().slice(0, 10)}`, total: d.qty, uom: "pcs" }],
    });
  }

  const loading = new Map(
    await Promise.all(dispatches.filter((x) => x.status === "LOADING").map(async (x) => [x.id, await dispatchProgress(x.id, db)] as const)),
  );
  for (const x of dispatches) {
    const pr = loading.get(x.id);
    rows.push({
      key: `dc-${x.id}`, direction: "SELL", number: x.dcNumber, party: x.customer.name, kind: "Dispatch",
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
