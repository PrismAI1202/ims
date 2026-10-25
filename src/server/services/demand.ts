import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import type { DemandRow, RowError } from "./demand-import";
import { DomainError } from "./inventory";

type Db = PrismaClient;

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
        dueDate: r.dueDate, qty: r.qty, type: r.type,
      })),
    });
    return { importId: imp.id, imported: input.rows.length, replaced };
  });
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
