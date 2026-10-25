import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

export interface GradeView {
  id: string; gradeName: string; supplierId: string; supplierName: string;
  status: "PENDING_QA" | "APPROVED" | "REJECTED"; autoApproved: boolean; priority: number; rank: number | null;
  stock: number; leadTimeDays: number | null; price: number | null;
  datasheetRef: string | null; trialRef: string | null; evidence: string;
}
export interface GroupView {
  id: string; code: string; name: string; itemId: string; itemCode: string; uom: string;
  onHand: number; min: number; spec: string[]; usedIn: string[]; grades: GradeView[]; warning: string;
}

export const GROUP_CATEGORIES = ["RM_RESIN", "RM_MASTERBATCH", "BOP", "PACKAGING"] as const;
const PREFIX: Record<string, string> = { RM_RESIN: "RM", RM_MASTERBATCH: "MB", BOP: "BOP", PACKAGING: "PKG" };

/** What the group page warns about: not enough approved sources to survive a supplier problem. */
export function groupWarning(approved: number, pending: number): string {
  if (approved === 0 && pending === 0) return "No grades yet. Add the first grade, then have QA approve it.";
  if (approved === 0) return "No grade is approved yet. Material can't be substituted until QA approves one.";
  if (approved === 1) return "Single source. Approve a second grade so a supplier problem doesn't stop production.";
  return "";
}

/** Approved grades in priority order get ranks 1..n; pending and rejected ones have no rank. */
export function rankGrades<T extends { status: string; priority: number }>(grades: T[]): (T & { rank: number | null })[] {
  const approved = grades.filter((g) => g.status === "APPROVED").sort((a, b) => a.priority - b.priority);
  return [...grades]
    .sort((a, b) => (a.status === "APPROVED" ? 0 : a.status === "PENDING_QA" ? 1 : 2) - (b.status === "APPROVED" ? 0 : b.status === "PENDING_QA" ? 1 : 2) || a.priority - b.priority)
    .map((g) => ({ ...g, rank: g.status === "APPROVED" ? approved.indexOf(g as never) + 1 : null }));
}

const evidenceText = (g: { datasheetRef: string | null; trialRef: string | null }) =>
  [g.datasheetRef ? "Datasheet" : null, g.trialRef ? "Trial report" : null].filter(Boolean).join(" + ") || "No evidence";

export async function listGroups(db: Db = defaultDb): Promise<GroupView[]> {
  const groups = await db.equivalentGroup.findMany({
    orderBy: { code: "asc" },
    include: { item: true, grades: { include: { supplier: true } } },
  });
  if (groups.length === 0) return [];
  const itemIds = groups.map((g) => g.itemId);
  const [balances, uses, prices] = await Promise.all([
    db.stockBalance.findMany({
      where: { qty: { gt: 0 }, lot: { itemId: { in: itemIds }, qcStatus: { in: ["APPROVED", "DEVIATED"] } } },
      include: { lot: { include: { grnLine: { include: { grn: { include: { po: true } } } } } } },
    }),
    db.bomLine.findMany({ where: { itemId: { in: itemIds } }, include: { bom: { include: { fgItem: true } } } }),
    db.priceMaster.findMany({ where: { itemId: { in: itemIds } } }),
  ]);

  return groups.map((g) => {
    const mine = balances.filter((b) => b.lot.itemId === g.itemId);
    const onHand = mine.reduce((a, b) => a + Number(b.qty), 0);
    const bySupplier = new Map<string, number>();
    for (const b of mine) {
      const sid = b.lot.grnLine?.grn.po.supplierId;
      if (sid) bySupplier.set(sid, (bySupplier.get(sid) ?? 0) + Number(b.qty));
    }
    const grades = rankGrades(g.grades.map((x) => ({
      id: x.id, gradeName: x.gradeName, supplierId: x.supplierId, supplierName: x.supplier.name, status: x.status,
      autoApproved: x.autoApproved, priority: x.priority, stock: bySupplier.get(x.supplierId) ?? 0,
      leadTimeDays: x.leadTimeDays ?? x.supplier.leadTimeDays,
      price: (() => { const p = prices.find((q) => q.itemId === g.itemId && q.supplierId === x.supplierId); return p ? Number(p.price) : null; })(),
      datasheetRef: x.datasheetRef, trialRef: x.trialRef, evidence: evidenceText(x),
    })));
    const approved = grades.filter((x) => x.status === "APPROVED").length;
    const pending = grades.filter((x) => x.status === "PENDING_QA").length;
    return {
      id: g.id, code: g.code, name: g.name, itemId: g.itemId, itemCode: g.item.code, uom: g.item.uom,
      onHand, min: Number(g.item.minStock), spec: g.spec.split(",").map((s) => s.trim()).filter(Boolean),
      usedIn: [...new Set(uses.filter((u) => u.itemId === g.itemId).map((u) => u.bom.fgItem.code))].sort(),
      grades, warning: groupWarning(approved, pending),
    };
  });
}

export async function createGroup(input: { name: string; itemId: string; spec?: string }, db: Db = defaultDb) {
  const name = input.name.trim();
  if (!name) throw new DomainError("Give the group a name.");
  const item = await db.item.findUnique({ where: { id: input.itemId }, include: { equivalentGroup: true } });
  if (!item) throw new DomainError("Choose the stock item this group covers.");
  if (!(GROUP_CATEGORIES as readonly string[]).includes(item.category)) throw new DomainError("Equivalent groups cover resin, masterbatch, inserts and packaging.");
  if (item.equivalentGroup) throw new DomainError(`${item.code} already has the group ${item.equivalentGroup.code}.`);
  const count = await db.equivalentGroup.count();
  return db.equivalentGroup.create({
    data: { code: `EQ-${PREFIX[item.category]}-${String(count + 1).padStart(3, "0")}`, name, itemId: item.id, spec: input.spec?.trim() ?? "" },
  });
}

export async function addGrade(
  input: { groupId: string; gradeName: string; supplierId: string; datasheetRef?: string; trialRef?: string; leadTimeDays?: number; userId?: string },
  db: Db = defaultDb,
) {
  const gradeName = input.gradeName.trim();
  if (!gradeName) throw new DomainError("Enter the vendor's grade name.");
  if (!input.supplierId) throw new DomainError("Pick the vendor.");
  if (!input.datasheetRef) throw new DomainError("Attach the datasheet first. QA needs it to check the spec window.");
  if (input.leadTimeDays !== undefined && !(Number.isInteger(input.leadTimeDays) && input.leadTimeDays >= 0)) throw new DomainError("Lead time must be a whole number of days.");
  const dup = await db.equivalentGrade.findFirst({ where: { groupId: input.groupId, gradeName, supplierId: input.supplierId } });
  if (dup) throw new DomainError(`${gradeName} from that vendor is already in this group.`);
  const last = await db.equivalentGrade.aggregate({ where: { groupId: input.groupId }, _max: { priority: true } });
  return db.equivalentGrade.create({
    data: {
      groupId: input.groupId, gradeName, supplierId: input.supplierId, datasheetRef: input.datasheetRef, trialRef: input.trialRef || null,
      leadTimeDays: input.leadTimeDays, priority: (last._max.priority ?? 0) + 10, requestedById: input.userId,
    },
  });
}

/** QA's decision on a proposed grade: approve for all parts, approve for non-automotive only, or reject. */
export async function decideGrade(
  input: { gradeId: string; decision: "APPROVE_ALL" | "APPROVE_NON_AUTO" | "REJECT"; userId?: string },
  db: Db = defaultDb,
) {
  const g = await db.equivalentGrade.findUnique({ where: { id: input.gradeId } });
  if (!g) throw new DomainError("Unknown grade.");
  if (g.status !== "PENDING_QA") throw new DomainError(`${g.gradeName} was already ${g.status === "APPROVED" ? "approved" : "rejected"}.`);
  return db.equivalentGrade.update({
    where: { id: g.id },
    data: {
      status: input.decision === "REJECT" ? "REJECTED" : "APPROVED", autoApproved: input.decision === "APPROVE_ALL",
      approvedById: input.userId, approvedAt: new Date(),
    },
  });
}

/** Moves an approved grade one place up the priority order. */
export async function moveGradeUp(gradeId: string, db: Db = defaultDb) {
  const g = await db.equivalentGrade.findUnique({ where: { id: gradeId } });
  if (!g || g.status !== "APPROVED") throw new DomainError("Only an approved grade can be re-ranked.");
  const approved = await db.equivalentGrade.findMany({ where: { groupId: g.groupId, status: "APPROVED" }, orderBy: { priority: "asc" } });
  const i = approved.findIndex((x) => x.id === g.id);
  if (i <= 0) return;
  const prev = approved[i - 1];
  await db.$transaction([
    db.equivalentGrade.update({ where: { id: g.id }, data: { priority: prev.priority } }),
    db.equivalentGrade.update({ where: { id: prev.id }, data: { priority: g.priority } }),
  ]);
}
