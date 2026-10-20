import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import type { Permission } from "@/server/auth/permissions";
import { returnableBalances } from "./dispatch";
import type { Table } from "./export-format";
import { planMrp } from "./mrp";
import { stockByItem } from "./stock";
import { varianceReport } from "./production";

type Db = PrismaClient;

export const REPORTS = {
  stock: "stock.view",
  variance: "reports.view",
  returnables: "dispatch.manage",
  mrp: "mrp.plan",
  demand: "mrp.plan",
} as const satisfies Record<string, Permission>;
export type ReportName = keyof typeof REPORTS;
export const isReport = (s: string): s is ReportName => s in REPORTS;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const STATUS = { RED: "Below Min", YELLOW: "Near ROP", GREEN: "Optimal" } as const;

export interface ReportParams { from?: Date; to?: Date; horizonDays?: number; scrapPct?: number }

export async function buildReport(name: ReportName, p: ReportParams = {}, db: Db = defaultDb): Promise<Table> {
  switch (name) {
    case "stock": {
      const rows = await stockByItem(db);
      return {
        title: "Live stock",
        columns: ["Item code", "Name", "Category", "UOM", "On hand", "Pending QC", "Min", "ROP", "Max", "Status"],
        rows: rows.map((r) => [r.code, r.name, r.category, r.uom, r.onHand, r.pendingQc, r.minStock, r.reorderPoint, r.maxStock, STATUS[r.status]]),
      };
    }
    case "variance": {
      const to = p.to ?? new Date();
      const from = p.from ?? new Date(to.getTime() - 30 * 86_400_000);
      const rep = await varianceReport(from, new Date(to.getTime() + 86_400_000), db);
      return {
        title: `BOM variance ${day(from)} to ${day(to)}`,
        columns: ["Item code", "Name", "UOM", "Expected", "Issued", "Variance", "Variance %"],
        rows: rep.rows.map((r) => [r.code, r.name, r.uom, r.expected, r.issued, r.variance, r.variancePct]),
      };
    }
    case "returnables": {
      const rows = await returnableBalances(db);
      return {
        title: "Returnable ledger",
        columns: ["Customer", "Container code", "Container", "Issued", "Returned", "Outstanding"],
        rows: rows.map((r) => [r.customerName, r.itemCode, r.itemName, r.issued, r.returned, r.balance]),
      };
    }
    case "mrp": {
      const { rows } = await planMrp({ horizonDays: p.horizonDays ?? 60, scrapPct: p.scrapPct ?? 2 }, db);
      return {
        title: "MRP plan",
        columns: ["Item code", "Name", "Role", "Policy", "Needed", "On hand", "On order", "Projected", "Suggested", "UOM", "Supplier", "Price", "Order by", "Late", "Reason"],
        rows: rows.map((r) => [
          r.code, r.name, r.role, r.policy, Math.round(r.gross * 10) / 10, r.onHand, r.incoming, Math.round(r.projected * 10) / 10, r.suggested, r.uom,
          r.supplier?.name ?? "", r.supplier?.price ?? null, day(r.orderBy), r.late ? "Yes" : "", r.reason,
        ]),
      };
    }
    case "demand": {
      const lines = await db.demandLine.findMany({ orderBy: [{ dueDate: "asc" }], include: { customer: true, fgItem: true } });
      return {
        title: "Customer demand",
        columns: ["Due date", "Customer", "Part", "Qty", "Type"],
        rows: lines.map((l) => [day(l.dueDate), l.customer.name, l.fgItem.code, l.qty, l.type]),
      };
    }
  }
}
