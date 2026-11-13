import { hubTabs, isViewKey, VIEW_KEYS, viewDef, type ViewKey } from "@/lib/views";
import { HOME_WIDGETS, isHomeWidget, type HomeWidgetKey } from "@/lib/home-widgets";

export type Permission =
  | "masters.manage"
  | "po.manage"
  | "grn.create"
  | "qc.inspect"
  | "stock.view"
  | "stock.transfer"
  | "stock.issue"
  | "reorder.view"
  | "request.create"
  | "production.book"
  | "bom.manage"
  | "fg.pack"
  | "mrp.plan"
  | "users.manage"
  | "scrap.approve"
  | "reports.view"
  | "equivalents.manage"
  | "plan.manage"
  | "maintenance.manage"
  | "downtime.log"
  | "dispatch.manage"
  | "stock.count"
  | "stock.adjust"
  | "material.return"
  | "rtv.manage"
  | "firstoff.request"
  | "firstoff.approve"
  | "pdi.release"
  | "bins.manage"
  | "partners.manage"
  | "equipment.manage";

/** What each permission lets a user do, as shown on Settings · Roles & access. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "masters.manage": "Edit masters (parts, partners, machines, moulds)",
  "po.manage": "Raise, edit and close supplier POs",
  "grn.create": "Record gate entries and GRNs",
  "qc.inspect": "Inspect lots and approve alternate grades",
  "stock.view": "Read stock",
  "stock.transfer": "Put away and move stock between bins",
  "stock.issue": "Issue material to the shop floor",
  "reorder.view": "See stock health (red / yellow / green) on Home",
  "request.create": "Raise material requests",
  "production.book": "Book production",
  "bom.manage": "Edit BOMs",
  "fg.pack": "Pack FG boxes and print box labels",
  "mrp.plan": "Import demand and run MRP",
  "users.manage": "Manage roles, users and passwords",
  "scrap.approve": "Decide regrind or waste for rejects",
  "reports.view": "Open and export reports",
  "equivalents.manage": "Add and rank alternate grades",
  "plan.manage": "Edit the machine plan",
  "maintenance.manage": "Record PM, repairs and mould settings",
  "downtime.log": "Log downtime",
  "dispatch.manage": "Create, load and complete dispatches",
  "stock.count": "Count bins and submit differences",
  "stock.adjust": "Approve stock count adjustments",
  "material.return": "Return unused material to stores",
  "rtv.manage": "Return rejected lots to the supplier",
  "firstoff.request": "Request a first-off inspection",
  "firstoff.approve": "Approve or reject a first-off",
  "pdi.release": "Release FG lots after final inspection",
  "bins.manage": "Edit the store layout (add racks, shelves and bins)",
  "partners.manage": "Add, edit and remove customers and suppliers",
  "equipment.manage": "Add, edit and remove machines and moulds",
};

export const PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];
export const isPermission = (p: string): p is Permission => p in PERMISSION_LABELS;

/** Permissions shown under Home on the roles screen because no single view owns them. */
export const HOME_ACTIONS: Permission[] = ["reorder.view"];

/** Every role can read stock; screens decide how much of it a role actually sees. */
const BASE: Permission[] = ["stock.view"];

export interface RoleRecord { allAccess: boolean; views: string[]; permissions: string[]; home: string[] }
export interface Access { views: ViewKey[]; permissions: Permission[]; home: HomeWidgetKey[] }

// A Home block shows when the role has the screen or permission it draws on; with nothing left, the task inbox.
function homeFor(home: string[], views: readonly string[], permissions: readonly string[]): HomeWidgetKey[] {
  const ok = (k: HomeWidgetKey) => {
    const w = HOME_WIDGETS.find((x) => x.key === k)!;
    return (!w.view || views.includes(w.view)) && (!w.perm || permissions.includes(w.perm));
  };
  const keys = [...new Set(home.filter(isHomeWidget))].filter(ok);
  return keys.length ? keys : ["needs-you"];
}

// Turns a stored role into what its users may see and do. A full-access role gets every view and permission, including
// ones added after it was created. Otherwise each granted view also brings the permission its page needs to work.
export function resolveAccess(role: RoleRecord | null | undefined): Access {
  if (!role) return { views: [], permissions: [], home: ["needs-you"] };
  if (role.allAccess) return { views: [...VIEW_KEYS], permissions: [...PERMISSIONS], home: homeFor(role.home, VIEW_KEYS, PERMISSIONS) };
  const picked = [...new Set(role.views.filter(isViewKey))]; // stored order is the role's menu order (phone tabs use it)
  const granted = new Set<Permission>([...BASE, ...role.permissions.filter(isPermission)]);
  for (const v of picked) {
    const req = viewDef(v)?.requires;
    if (req) granted.add(req);
  }
  const permissions = PERMISSIONS.filter((p) => granted.has(p));
  // A hub (Quality) is only in the menu when the role can open at least one of its tabs.
  const views = picked.filter((v) => { const d = viewDef(v); return !d?.tabs || hubTabs(d, permissions).length > 0; });
  return { views, permissions, home: homeFor(role.home, views, permissions) };
}

export interface SystemRole extends RoleRecord { key: string; name: string; description: string }

// Default roles, shaped around each role's shift routine (IMS scope review, Nov 2026). The migration creates them;
// admins can change them under Settings, and "Reset to default" puts these values back.
export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: "ADMIN", name: "Admin", allAccess: false,
    description: "Plant head and system owner: set-up, users and roles, exceptions and KPIs.",
    views: ["process", "orders", "metrics", "approvals", "masters", "settings", "partners", "bom", "equivalents", "maintenance", "trace", "variance", "stock"],
    permissions: ["reorder.view", "equivalents.manage", "stock.transfer", "bins.manage", "partners.manage", "equipment.manage"],
    home: ["plant-overview", "approvals", "needs-you", "stock-health"],
  },
  {
    key: "STORE_INCHARGE", name: "Store Incharge", allAccess: false,
    description: "Receives trucks, puts away approved lots, issues material FIFO, counts bins and raises POs.",
    views: ["grn", "stock", "issue", "scan", "orders", "mrp", "count", "returns", "quality"],
    permissions: ["reorder.view", "stock.transfer", "po.manage", "rtv.manage"],
    home: ["needs-you", "stock-health", "quick-actions"],
  },
  {
    key: "QA_INSPECTOR", name: "QA Inspector", allAccess: false,
    description: "Inward QC, first-off and final inspection, scrap decisions, traceability and alternate-grade approval.",
    views: ["quality", "trace", "equivalents"],
    permissions: ["qc.inspect", "scrap.approve", "pdi.release", "firstoff.approve"],
    home: ["qc-queue", "needs-you"],
  },
  {
    key: "PRODUCTION_LEAD", name: "Production Lead", allAccess: false,
    description: "Runs the machines: requests material, books shifts and downtime, packs FG, logs maintenance.",
    views: ["production", "requests", "fg", "planning", "maintenance", "returns", "quality"],
    permissions: ["downtime.log", "maintenance.manage", "firstoff.request"],
    home: ["my-machines", "needs-you", "quick-actions"],
  },
  {
    key: "DISPATCH_OFFICER", name: "Dispatch Officer", allAccess: false,
    description: "Picks and loads FG boxes, prints the DC and e-way data, keeps the returnable ledger.",
    views: ["orders", "fg", "returnables", "scan"],
    permissions: ["dispatch.manage"],
    home: ["todays-shipments", "needs-you"],
  },
  {
    key: "PLANNER", name: "Planner", allAccess: false,
    description: "Imports customer demand, runs MRP, releases POs and plans moulds on machines.",
    views: ["demand", "mrp", "orders", "planning", "partners"],
    permissions: ["reorder.view", "plan.manage", "po.manage"],
    home: ["needs-you", "stock-health"],
  },
  {
    key: "DEMO", name: "Demo (all views)", allAccess: true,
    description: "Every screen and action, for walkthroughs. Not for day-to-day use.",
    views: [], permissions: [],
    home: ["needs-you", "plant-overview", "approvals", "qc-queue", "my-machines", "todays-shipments", "stock-health", "quick-actions"],
  },
];

// Admin must always be able to reach the screens that manage access, or nobody could fix a mistake.
export const ADMIN_KEY = "ADMIN";
export const ADMIN_LOCKED_VIEWS: ViewKey[] = ["settings"];

type Holder = { permissions: readonly string[] } | null | undefined;
type Viewer = { views: readonly string[] } | null | undefined;

export function can(user: Holder, permission: Permission): boolean {
  return !!user?.permissions.includes(permission);
}

export function canView(user: Viewer, view: string): boolean {
  return !!user && isViewKey(view) && user.views.includes(view);
}

export function assertCan(user: Holder, permission: Permission): void {
  if (!can(user, permission)) {
    throw new ForbiddenError(permission);
  }
}

export class ForbiddenError extends Error {
  constructor(public permission: Permission) {
    super(`Forbidden: missing permission ${permission}`);
    this.name = "ForbiddenError";
  }
}
