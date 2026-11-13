import type { Permission } from "@/server/auth/permissions";

// Every screen a role can be given, in menu order. A role's `views` decide what appears in its menus and which pages
// it may open; its `permissions` decide what it may do there. Ticking a view also grants `requires`, the permission
// the page cannot work without; `actions` are optional extras an admin can grant alongside it. A view with `levels`
// is granted as a ladder instead (Settings shows one toggle): each level adds to the one before it.
// Home, Account and Sync centre are open to every signed-in user and are not listed here.

export type ViewKey =
  | "process" | "orders" | "metrics" | "approvals"
  | "masters" | "settings" | "partners" | "bom" | "equivalents" | "demand"
  | "mrp" | "grn" | "quality"
  | "stock" | "count" | "requests" | "issue" | "returns" | "scan" | "production" | "fg" | "planning" | "maintenance"
  | "returnables"
  | "trace" | "variance";

export interface ViewDef {
  key: ViewKey;
  href: string;
  name: string;
  what: string;
  group: ViewGroup;
  bar: string;
  requires?: Permission;
  actions?: Permission[];
  levels?: AccessLevel[];
  tabs?: HubTab[];
}

/**
 * A screen that is a hub of tabs (Quality). Each row is one permission that opens a tab: a role sees a tab when it holds the
 * permission, and the hub drops out of a role's menu when it holds none. Two rows may open the same tab (First-off:
 * request and approve are different jobs on one tab).
 */
export interface HubTab { tab: string; label: string; what: string; permission: Permission }

/** The tabs of a hub that these permissions open, in the hub's order, each once. */
export function hubTabs(v: ViewDef, permissions: readonly string[]): string[] {
  return [...new Set((v.tabs ?? []).filter((t) => permissions.includes(t.permission)).map((t) => t.tab))];
}

/** One rung of a view's access ladder. `permissions` is everything that rung grants, including the rungs below it. */
export interface AccessLevel { label: string; permissions: Permission[] }

/** Every optional permission a view offers, whether as separate extras or as rungs of its ladder. */
export const viewActions = (v: ViewDef): Permission[] => [...(v.actions ?? []), ...(v.levels ?? []).flatMap((l) => l.permissions), ...(v.tabs ?? []).map((t) => t.permission)];

/** The highest rung whose permissions are not all already given by the rung below, i.e. the one the permissions reach. */
export function levelOf(v: ViewDef, permissions: readonly string[]): number {
  const levels = v.levels ?? [];
  let at = 0;
  levels.forEach((l, i) => {
    const added = l.permissions.filter((p) => !(levels[i - 1]?.permissions ?? []).includes(p));
    if (i > 0 && added.some((p) => permissions.includes(p))) at = i;
  });
  return at;
}

export const levelPermissions = (v: ViewDef, level: number): Permission[] => v.levels?.[Math.min(Math.max(level, 0), (v.levels?.length ?? 1) - 1)]?.permissions ?? [];

export type ViewGroup = "OVERVIEW" | "SET UP" | "BUY & RECEIVE" | "STORE & SHOP FLOOR" | "QUALITY" | "SHIP" | "TRACE & REPORTS";
export const VIEW_GROUPS: ViewGroup[] = ["OVERVIEW", "SET UP", "BUY & RECEIVE", "STORE & SHOP FLOOR", "QUALITY", "SHIP", "TRACE & REPORTS"];

export const VIEWS: ViewDef[] = [
  { key: "process", href: "/process", name: "Process", what: "Live 11-step plant process with what is waiting at each step", group: "OVERVIEW", bar: "#C2410C" },
  { key: "orders", href: "/orders", name: "Orders", what: "Supplier POs, dispatches and customer orders in one filterable list; raise POs and pick lists", group: "OVERVIEW", bar: "#1D4ED8", actions: ["po.manage", "dispatch.manage"] },
  { key: "metrics", href: "/metrics", name: "Metrics", what: "OEE, downtime, rejects, regrind and maintenance KPIs", group: "OVERVIEW", bar: "#1E7A46" },
  { key: "approvals", href: "/approvals", name: "Approvals", what: "Stock count adjustments waiting for a decision", group: "OVERVIEW", bar: "#B42318", requires: "stock.adjust" },

  { key: "masters", href: "/masters", name: "Admin · Masters", what: "Parts and materials: stock levels, supplier prices, stock rules", group: "SET UP", bar: "#0F5C5C", requires: "masters.manage" },
  { key: "settings", href: "/settings", name: "Settings · Roles & users", what: "Roles and what each can see and do, plus the people in each role: add users, reset passwords", group: "SET UP", bar: "#0F5C5C", requires: "users.manage" },
  { key: "partners", href: "/partners", name: "Customers & suppliers", what: "Every customer and vendor with their orders; add, edit and remove them", group: "SET UP", bar: "#1D4ED8", levels: [
    { label: "View", permissions: [] },
    { label: "Edit list", permissions: ["partners.manage"] },
  ] },
  { key: "bom", href: "/bom", name: "BOMs", what: "Blend ratios, inserts, and approved alternate grades by vendor", group: "SET UP", bar: "#C2410C", requires: "bom.manage" },
  { key: "equivalents", href: "/equivalents", name: "Equivalent materials", what: "Approved alternate grades grouped by vendor", group: "SET UP", bar: "#C2410C", actions: ["equivalents.manage"] },
  { key: "demand", href: "/demand", name: "Customer demand", what: "Import customer POs and call-off schedules", group: "SET UP", bar: "#4B5563", requires: "mrp.plan" },

  { key: "mrp", href: "/mrp", name: "MRP plan", what: "Material shortfall from demand, with suggested POs", group: "BUY & RECEIVE", bar: "#4B5563", requires: "mrp.plan" },
  { key: "grn", href: "/grn", name: "Gate entry & GRN", what: "Vehicle, invoice, lot / heat no., bags and weight", group: "BUY & RECEIVE", bar: "#C2410C", requires: "grn.create" },

  { key: "stock", href: "/stock", name: "Stores", what: "Stock and bins, put-away and bin-to-bin transfer", group: "STORE & SHOP FLOOR", bar: "#1E7A46", levels: [
    { label: "View", permissions: [] },
    { label: "Move stock", permissions: ["stock.transfer"] },
    { label: "Edit layout", permissions: ["stock.transfer", "bins.manage"] },
  ] },
  { key: "count", href: "/count", name: "Stock count", what: "Count a bin and send differences for approval", group: "STORE & SHOP FLOOR", bar: "#1E7A46", requires: "stock.count" },
  { key: "requests", href: "/requests", name: "Material requests", what: "Requisitions from the shop floor", group: "STORE & SHOP FLOOR", bar: "#1E7A46", requires: "request.create" },
  { key: "issue", href: "/issue", name: "Issue to shop floor", what: "FIFO issue to machines", group: "STORE & SHOP FLOOR", bar: "#1E7A46", requires: "stock.issue" },
  { key: "returns", href: "/returns", name: "Return to stores", what: "Put unused material back from the machine", group: "STORE & SHOP FLOOR", bar: "#1E7A46", requires: "material.return" },
  { key: "scan", href: "/scan", name: "Scanner", what: "Scan to issue, transfer or load, works offline", group: "STORE & SHOP FLOOR", bar: "#15171A" },
  { key: "production", href: "/production", name: "Production", what: "Hourly booking, downtime with reason codes, runner and regrind", group: "STORE & SHOP FLOOR", bar: "#6B4FB0", requires: "production.book", actions: ["downtime.log"] },
  { key: "fg", href: "/fg", name: "FG & box labels", what: "Pack finished goods and print box labels", group: "STORE & SHOP FLOOR", bar: "#6B4FB0", requires: "fg.pack" },
  { key: "planning", href: "/planning", name: "Planning", what: "Which mould runs on which machine, by day", group: "STORE & SHOP FLOOR", bar: "#4B5563", actions: ["plan.manage"] },
  { key: "maintenance", href: "/maintenance", name: "Maintenance", what: "Machines and moulds: shot life, PM, repairs, MTBF / MTTR; add, edit and remove them", group: "STORE & SHOP FLOOR", bar: "#7A4E14", actions: ["maintenance.manage", "equipment.manage"] },

  { key: "quality", href: "/quality", name: "Quality", what: "Inward QC, scrap decisions, final inspection, first-off and returns to supplier: each role sees only its own tabs", group: "QUALITY", bar: "#1D4ED8", tabs: [
    { tab: "inward", label: "Inward QC", what: "Inspect received lots: approve, accept on deviation or reject, and put away", permission: "qc.inspect" },
    { tab: "scrap", label: "Scrap decisions", what: "Decide regrind or waste for parts rejected in production", permission: "scrap.approve" },
    { tab: "pdi", label: "Final inspection (PDI)", what: "Release finished-goods lots for dispatch, or put them on hold", permission: "pdi.release" },
    { tab: "firstoff", label: "First-off: request", what: "Ask QA to check the first parts of a set-up (production)", permission: "firstoff.request" },
    { tab: "firstoff", label: "First-off: approve", what: "Approve or reject a first-off sample (QA)", permission: "firstoff.approve" },
    { tab: "rtv", label: "Return to supplier", what: "Send rejected lots back with a debit note", permission: "rtv.manage" },
  ] },
  { key: "returnables", href: "/returnables", name: "Returnable ledger", what: "Crates and trolleys issued to and returned by customers", group: "SHIP", bar: "#15171A", requires: "dispatch.manage" },

  { key: "trace", href: "/trace", name: "Traceability", what: "Back and forward trace of any box or lot", group: "TRACE & REPORTS", bar: "#1D4ED8" },
  { key: "variance", href: "/reports/variance", name: "BOM variance", what: "Planned versus actual material use", group: "TRACE & REPORTS", bar: "#1D4ED8", requires: "reports.view" },
];

export const VIEW_KEYS = VIEWS.map((v) => v.key);
export const viewDef = (key: string) => VIEWS.find((v) => v.key === key);
export const isViewKey = (key: string): key is ViewKey => VIEW_KEYS.includes(key as ViewKey);
