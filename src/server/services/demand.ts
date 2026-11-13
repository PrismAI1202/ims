import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import type { DemandRow, RowError } from "./demand-import";
import { DomainError } from "./inventory";
import { stockByItem } from "./stock";

type Db = PrismaClient;

/** What is still to ship on a demand line. */
export const remainingQty = (d: { qty: number; shippedQty: number }) => Math.max(d.qty - d.shippedQty, 0);

/**
 * A completed dispatch fulfils the customer's open firm and spot orders for that part, oldest due date first. Forecast lines are
 * not orders and are never closed by a shipment. Shipping more than is on order simply leaves the last line complete.
 */
export async function allocateShipment(tx: Pick<PrismaClient, "demandLine">, customerId: string, fgItemId: string, qty: number) {
  let left = qty;
  const open = await tx.demandLine.findMany({
    where: { customerId, fgItemId, type: { in: ["FIRM", "SPOT"] } }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  for (const l of open) {
    if (left <= 0) break;
    const take = Math.min(remainingQty(l), left);
    if (take <= 0) continue;
    await tx.demandLine.update({ where: { id: l.id }, data: { shippedQty: { increment: take } } });
    left -= take;
  }
}

export interface ImportResult { importId: string; imported: number; replaced: number }

// All-or-nothing: one unknown part code rejects the whole file, so a half-loaded schedule never reaches MRP.
// With replaceForecast, a new forecast supersedes the old forecast for the same customer + part (firm orders and spot demand stay).
export async function importDemand(
  input: { fileName: string; rows: DemandRow[]; rowErrors: RowError[]; replaceForecast: boolean; userId?: string },
  db: Db = defaultDb,
): Promise<ImportResult> {
  if (input.rowErrors.length) {
    const first = input.rowErrors.slice(0, 5).map((e) => `row ${e.row}: ${e.message}`).join(" | ");
    throw new DomainError(`${input.rowErrors.length} row${input.rowErrors.length > 1 ? "s" : ""} need fixing — ${first}${input.rowErrors.length > 5 ? " …" : ""}`);
  }
  if (input.rows.length === 0) throw new DomainError("The file has no demand rows.");

  const [customers, items] = await Promise.all([
    db.customer.findMany({ where: { code: { in: [...new Set(input.rows.map((r) => r.customerCode))] } } }),
    db.item.findMany({ where: { code: { in: [...new Set(input.rows.map((r) => r.partCode))] } } }),
  ]);
  const cust = new Map(customers.map((c) => [c.code, c]));
  const part = new Map(items.map((i) => [i.code, i]));

  const problems: string[] = [];
  for (const r of input.rows) {
    const c = cust.get(r.customerCode);
    const p = part.get(r.partCode);
    if (!c) problems.push(`row ${r.row}: unknown customer ${r.customerCode}`);
    else if (!c.active) problems.push(`row ${r.row}: customer ${r.customerCode} is inactive`);
    if (!p) problems.push(`row ${r.row}: unknown part ${r.partCode}`);
    else if (p.category !== "FG") problems.push(`row ${r.row}: ${r.partCode} is not a finished-goods part`);
  }
  if (problems.length) {
    throw new DomainError(`${problems.length} problem${problems.length > 1 ? "s" : ""} — ${problems.slice(0, 5).join(" | ")}${problems.length > 5 ? " …" : ""}`);
  }

  return db.$transaction(async (tx) => {
    let replaced = 0;
    if (input.replaceForecast) {
      const pairs = new Map<string, { customerId: string; fgItemId: string }>();
      for (const r of input.rows.filter((x) => x.type === "FORECAST")) {
        const customerId = cust.get(r.customerCode)!.id;
        const fgItemId = part.get(r.partCode)!.id;
        pairs.set(`${customerId}:${fgItemId}`, { customerId, fgItemId });
      }
      for (const p of pairs.values()) {
        replaced += (await tx.demandLine.deleteMany({ where: { ...p, type: "FORECAST" } })).count;
      }
    }
    const imp = await tx.demandImport.create({
      data: { fileName: input.fileName.slice(0, 200), rowCount: input.rows.length, replaced, userId: input.userId },
    });
    await tx.demandLine.createMany({
      data: input.rows.map((r) => ({
        importId: imp.id, customerId: cust.get(r.customerCode)!.id, fgItemId: part.get(r.partCode)!.id,
        dueDate: r.dueDate, qty: r.qty, type: r.type, customerRef: r.customerRef ?? null,
      })),
    });
    return { importId: imp.id, imported: input.rows.length, replaced };
  });
}

/** What the New customer order form offers: active customers, and each finished part with what is in stock and already on order. */
export async function orderFormOptions(db: Db = defaultDb) {
  const [customers, parts, stock, open] = await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    stockByItem(db),
    db.demandLine.findMany({ where: { type: { in: ["FIRM", "SPOT"] } }, select: { fgItemId: true, qty: true, shippedQty: true } }),
  ]);
  const onHand = new Map(stock.map((r) => [r.itemId, r.onHand]));
  const toShip = new Map<string, number>();
  for (const l of open) toShip.set(l.fgItemId, (toShip.get(l.fgItemId) ?? 0) + remainingQty(l));
  return {
    customers: customers.map((c) => ({ id: c.id, name: c.name, segment: c.segment as string })),
    parts: parts.map((p) => ({ id: p.id, code: p.code, name: p.name, uom: p.uom, onHand: onHand.get(p.id) ?? 0, toShip: toShip.get(p.id) ?? 0 })),
  };
}

export interface CustomerOrderInput {
  customerId: string; type: "FIRM" | "SPOT"; ref?: string;
  lines: { fgItemId: string; qty: number; dueDate: Date }[]; userId?: string;
}

/**
 * Enters one customer order by hand: a customer PO with any number of part lines, each with its own due date. The lines are
 * ordinary demand lines, so the plan, the timeline and Orders treat them exactly like loaded ones. A customer PO number can only
 * be entered once per customer, so the same order is not added twice.
 */
export async function createCustomerOrder(input: CustomerOrderInput, db: Db = defaultDb) {
  if (input.lines.length === 0) throw new DomainError("An order needs at least one line.");
  if (input.type !== "FIRM" && input.type !== "SPOT") throw new DomainError("Choose firm or spot.", ["type"]);
  const ref = input.ref?.trim() || null;
  if (ref && ref.length > 40) throw new DomainError("The PO number is too long (40 characters at most).", ["customerRef"]);
  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer || !customer.active) throw new DomainError("Choose an active customer.", ["customerId"]);
  const parts = await db.item.findMany({ where: { id: { in: input.lines.map((l) => l.fgItemId) } } });
  const part = new Map(parts.map((p) => [p.id, p]));

  const seen = new Set<string>();
  for (const l of input.lines) {
    const p = part.get(l.fgItemId);
    if (!p) throw new DomainError("A line uses a part that doesn't exist.", ["itemId"]);
    if (p.category !== "FG" || !p.active) throw new DomainError(`${p.code} isn't a finished part that can be ordered.`, ["itemId"]);
    if (!Number.isInteger(l.qty) || !(l.qty > 0) || l.qty >= 1e9) throw new DomainError(`${p.code}: the quantity must be a whole number above 0.`, ["qty"]);
    if (!(l.dueDate instanceof Date) || Number.isNaN(l.dueDate.getTime())) throw new DomainError(`${p.code}: give a due date.`, ["date"]);
    const key = `${l.fgItemId}:${l.dueDate.toISOString().slice(0, 10)}`;
    if (seen.has(key)) throw new DomainError(`${p.code} is listed twice for the same date. Combine the lines.`, ["itemId"]);
    seen.add(key);
  }
  if (ref) {
    const dup = await db.demandLine.count({ where: { customerId: input.customerId, customerRef: ref } });
    if (dup) throw new DomainError(`${customer.name} already has an order with PO number ${ref} (${dup} line${dup === 1 ? "" : "s"}).`, ["customerRef"]);
  }
  await db.demandLine.createMany({
    data: input.lines.map((l) => ({ customerId: input.customerId, fgItemId: l.fgItemId, dueDate: l.dueDate, qty: l.qty, type: input.type, customerRef: ref })),
  });
  return { lines: input.lines.length, ref };
}

/** Takes one order line back out. Only an order nothing has shipped against can go; a shipped one is history. */
export async function removeOrderLine(id: string, db: Db = defaultDb) {
  const line = await db.demandLine.findUnique({ where: { id }, include: { fgItem: true, customer: true } });
  if (!line) throw new DomainError("That order line doesn't exist any more.");
  if (line.shippedQty > 0) throw new DomainError(`${line.fgItem.code} for ${line.customer.name} has already shipped ${line.shippedQty.toLocaleString()} parts, so it can't be removed.`);
  await db.demandLine.delete({ where: { id } });
}

// Removes an upload's lines (it does not restore forecasts that upload replaced).
export async function undoImport(importId: string, db: Db = defaultDb) {
  const imp = await db.demandImport.findUnique({ where: { id: importId } });
  if (!imp) throw new DomainError("Unknown import.");
  return db.$transaction(async (tx) => {
    const n = (await tx.demandLine.deleteMany({ where: { importId } })).count;
    await tx.demandImport.delete({ where: { id: importId } });
    return n;
  });
}
