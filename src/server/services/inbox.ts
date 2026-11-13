import { qualityHref } from "@/lib/quality-tabs";
import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { can, canView, type Permission } from "@/server/auth/permissions";
import type { ViewKey } from "@/lib/views";
import { mouldRows } from "./maintenance";
import { mondayOf, planWeek } from "./planning";
import { pendingScrap } from "./scrap";
import { pdiQueue } from "./pdi";
import { rejectedLots } from "./rtv";
import { stockByItem, supplyByItem } from "./stock";
import { needsPo } from "./supply-steps";

type Db = PrismaClient;

// The Home "Needs you" inbox (IMS scope review, "a home page per role"). Each task is the hand-over from the previous
// step: a GRN leaves a lot for QC, QC approval leaves a lot to put away, a request leaves an issue, and so on.
// A user sees a task when their role has the screen where it is done, so custom roles get the right tasks too.

export interface InboxTask {
  key: string; title: string; sub: string; href: string; count: number;
  kind: "act" | "watch"; // act: work waiting on you; watch: worth a look, nothing is blocked
}

interface Ctx { userId: string; now: Date }

interface TaskDef extends Omit<InboxTask, "count"> {
  view: ViewKey;
  perm?: Permission;
  count: (db: Db, ctx: Ctx) => Promise<number>;
}

const WEEK = 7 * 86_400_000;
const OPEN_REQUEST = { status: { in: ["OPEN", "PARTIAL"] as ("OPEN" | "PARTIAL")[] } };

const TASKS: TaskDef[] = [
  {
    key: "gate", view: "grn", kind: "act", href: "/grn", title: "Trucks at the gate", sub: "Gate entries with no GRN yet",
    count: (db) => db.gateEntry.count({ where: { grns: { none: {} } } }),
  },
  {
    key: "receive", view: "grn", kind: "watch", href: "/grn", title: "POs to receive", sub: "Released or part-received supplier POs",
    count: (db) => db.purchaseOrder.count({ where: { status: { in: ["APPROVED", "PARTIAL"] } } }),
  },
  {
    key: "demand-due", view: "demand", kind: "watch", href: "/demand", title: "Customer demand due this week", sub: "Firm and spot lines due in the next 7 days",
    count: (db, { now }) => db.demandLine.count({ where: { type: { in: ["FIRM", "SPOT"] }, dueDate: { gte: now, lte: new Date(now.getTime() + WEEK) } } }),
  },
  {
    key: "to-buy", view: "mrp", kind: "act", href: "/mrp", title: "Items to buy", sub: "At or below reorder point even after open POs and QC",
    count: async (db) => {
      const [rows, supply] = await Promise.all([stockByItem(db), supplyByItem(db)]);
      return rows.filter((r) => needsPo(r, supply.get(r.itemId) ?? { openPoQty: 0, toPutAway: 0 })).length;
    },
  },
  {
    key: "to-plan", view: "planning", perm: "plan.manage", kind: "act", href: "/planning", title: "Parts to plan on a machine", sub: "Firm demand not yet covered by planned machine days",
    count: async (db, { now }) => (await planWeek(mondayOf(now), db, now)).jobs.filter((j) => j.left > 0).length,
  },
  {
    key: "qc", view: "quality", perm: "qc.inspect", kind: "act", href: qualityHref("inward"), title: "Lots waiting for inward QC", sub: "Received and held in staging",
    count: (db) => db.lot.count({ where: { qcStatus: "PENDING_QC" } }),
  },
  {
    key: "putaway", view: "stock", perm: "stock.transfer", kind: "act", href: "/stock?view=bins", title: "Lots to put away", sub: "QC-approved, still in staging",
    count: (db) => db.stockBalance.count({ where: { qty: { gt: 0 }, location: { type: "STAGING" }, lot: { qcStatus: { in: ["APPROVED", "DEVIATED"] } } } }),
  },
  {
    key: "issue", view: "requests", perm: "stock.issue", kind: "act", href: "/requests", title: "Requests to issue", sub: "Open shop-floor requisitions, FIFO lot shown",
    count: (db) => db.materialRequest.count({ where: OPEN_REQUEST }),
  },
  {
    key: "my-requests", view: "requests", perm: "request.create", kind: "watch", href: "/requests", title: "Your requests not yet issued", sub: "Waiting on stores",
    count: (db, { userId }) => db.materialRequest.count({ where: { ...OPEN_REQUEST, requestedById: userId } }),
  },
  {
    key: "rtv", view: "quality", perm: "rtv.manage", kind: "act", href: qualityHref("rtv"), title: "Rejected lots to send back", sub: "Sitting in staging, no debit note yet",
    count: async (db) => (await rejectedLots(db)).length,
  },
  {
    key: "pdi", view: "quality", perm: "pdi.release", kind: "act", href: qualityHref("pdi"), title: "FG lots waiting for final inspection", sub: "Dispatch can't load them until released",
    count: async (db) => (await pdiQueue(db)).filter((l) => l.status === "PENDING").length,
  },
  {
    key: "firstoff", view: "quality", perm: "firstoff.approve", kind: "act", href: qualityHref("firstoff"), title: "First-offs to approve", sub: "Asked for by production after a set-up",
    count: (db) => db.firstOff.count({ where: { status: "PENDING" } }),
  },
  {
    key: "firstoff-mine", view: "quality", perm: "firstoff.request", kind: "watch", href: qualityHref("firstoff"), title: "Your first-offs waiting for QA", sub: "Production can't be booked until approved",
    count: (db, { userId }) => db.firstOff.count({ where: { status: "PENDING", requestedById: userId } }),
  },
  {
    key: "counting", view: "stock", perm: "stock.count", kind: "act", href: "/stock?view=bins", title: "Count sheets in progress", sub: "Opened but not yet sent for approval",
    count: (db) => db.stockCount.count({ where: { status: "OPEN" } }),
  },
  {
    key: "adjustments", view: "stock", perm: "stock.adjust", kind: "act", href: "/stock?view=bins", title: "Stock counts to approve", sub: "Submitted by Store, waiting for a decision",
    count: (db) => db.stockCount.count({ where: { status: "SUBMITTED" } }),
  },
  {
    key: "scrap", view: "quality", perm: "scrap.approve", kind: "act", href: qualityHref("scrap"), title: "Rejects waiting for a decision", sub: "Regrind or waste, per booking",
    count: async (db) => (await pendingScrap(db)).length,
  },
  {
    key: "grades", view: "bom", perm: "qc.inspect", kind: "act", href: "/bom/groups", title: "Alternate grades to approve", sub: "Added by purchase, waiting on QA",
    count: (db) => db.equivalentGrade.count({ where: { status: "PENDING_QA" } }),
  },
  {
    key: "pm", view: "maintenance", kind: "act", href: "/maintenance", title: "Moulds due for PM", sub: "Due soon or overdue by shot count",
    count: async (db) => (await mouldRows(db)).filter((m) => m.state !== "OK").length,
  },
  {
    key: "loading", view: "orders", perm: "dispatch.manage", kind: "act", href: "/orders?kind=dispatch&state=active", title: "Dispatches still loading", sub: "Pick list open, not yet completed",
    count: (db) => db.dispatch.count({ where: { status: "LOADING" } }),
  },
  {
    key: "fg-ready", view: "orders", perm: "dispatch.manage", kind: "watch", href: "/orders?kind=dispatch&state=active", title: "FG boxes ready to ship", sub: "Packed, labelled and released by QA",
    count: (db) => db.fgBox.count({ where: { status: "IN_STOCK", lot: { pdiStatus: { notIn: ["PENDING", "HOLD"] } } } }),
  },
  {
    key: "fifo-overrides", view: "process", kind: "watch", href: "/process", title: "FIFO overrides this week", sub: "Lots issued out of order, with a reason",
    count: (db, { now }) => db.issueLine.count({ where: { fifoOverrideReason: { not: null }, issuedAt: { gte: new Date(now.getTime() - WEEK) } } }),
  },
  {
    key: "deviations", view: "process", kind: "watch", href: "/process", title: "QC deviations this week", sub: "Lots accepted on deviation",
    count: (db, { now }) => db.qcInspection.count({ where: { decision: "DEVIATED", inspectedAt: { gte: new Date(now.getTime() - WEEK) } } }),
  },
];

type Who = { views: readonly string[]; permissions: readonly string[] };

/** The task kinds a user's role covers, before counting. */
export function tasksFor(user: Who): string[] {
  return TASKS.filter((t) => canView(user, t.view) && (!t.perm || can(user, t.perm))).map((t) => t.key);
}

/** The user's inbox: only tasks with something in them, work waiting on them first. */
export async function inbox(user: Who & { id: string }, db: Db = defaultDb, now = new Date()): Promise<InboxTask[]> {
  const keys = new Set(tasksFor(user));
  const defs = TASKS.filter((t) => keys.has(t.key));
  const counts = await Promise.all(defs.map((t) => t.count(db, { userId: user.id, now })));
  return defs
    .map(({ key, title, sub, href, kind }, i) => ({ key, title, sub, href, kind, count: counts[i] }))
    .filter((t) => t.count > 0)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "act" ? -1 : 1));
}
