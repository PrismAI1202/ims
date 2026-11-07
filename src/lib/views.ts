import type { Permission } from "@/server/auth/permissions";

// Every screen a role can be given, in menu order. A role's `views` decide what appears in its menus and which pages
// it may open; its `permissions` decide what it may do there. Ticking a view also grants `requires`, the permission
// the page cannot work without; `actions` are optional extras an admin can grant alongside it.
// Home, Account and Sync centre are open to every signed-in user and are not listed here.

export type ViewKey =
  | "process" | "orders" | "metrics"
  | "masters" | "users" | "settings" | "partners" | "bom" | "equivalents" | "demand"
  | "mrp" | "purchase" | "grn" | "qc" | "scrap"
  | "stock" | "requests" | "issue" | "scan" | "production" | "fg" | "planning" | "maintenance"
  | "dispatch" | "returnables"
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
}

export type ViewGroup = "OVERVIEW" | "SET UP" | "BUY & RECEIVE" | "STORE & SHOP FLOOR" | "SHIP" | "TRACE & REPORTS";
export const VIEW_GROUPS: ViewGroup[] = ["OVERVIEW", "SET UP", "BUY & RECEIVE", "STORE & SHOP FLOOR", "SHIP", "TRACE & REPORTS"];

export const VIEWS: ViewDef[] = [
  { key: "process", href: "/process", name: "Process", what: "Live 11-step plant process with what is waiting at each step", group: "OVERVIEW", bar: "#C2410C" },
  { key: "orders", href: "/orders", name: "Orders", what: "Every buy and sell document with its status", group: "OVERVIEW", bar: "#1D4ED8" },
  { key: "metrics", href: "/metrics", name: "Metrics", what: "OEE, downtime, rejects, regrind and maintenance KPIs", group: "OVERVIEW", bar: "#1E7A46" },

  { key: "masters", href: "/masters", name: "Admin · Masters", what: "Parts, suppliers, customers, bins, machines and moulds", group: "SET UP", bar: "#0F5C5C", requires: "masters.manage" },
  { key: "users", href: "/users", name: "Users", what: "Add, edit and deactivate users; assign each a role", group: "SET UP", bar: "#0F5C5C", requires: "users.manage" },
  { key: "settings", href: "/settings", name: "Settings · Roles & access", what: "Create roles and choose the screens and actions each one gets", group: "SET UP", bar: "#0F5C5C", requires: "users.manage" },
  { key: "partners", href: "/partners", name: "Customers & suppliers", what: "Every customer and vendor with their open and past orders", group: "SET UP", bar: "#1D4ED8" },
  { key: "bom", href: "/bom", name: "BOMs", what: "Blend ratios, inserts, and approved alternate grades by vendor", group: "SET UP", bar: "#C2410C", requires: "bom.manage" },
  { key: "equivalents", href: "/equivalents", name: "Equivalent materials", what: "Approved alternate grades grouped by vendor", group: "SET UP", bar: "#C2410C", actions: ["equivalents.manage"] },
  { key: "demand", href: "/demand", name: "Customer demand", what: "Import customer POs and call-off schedules", group: "SET UP", bar: "#4B5563", requires: "mrp.plan" },

  { key: "mrp", href: "/mrp", name: "MRP plan", what: "Material shortfall from demand, with suggested POs", group: "BUY & RECEIVE", bar: "#4B5563", requires: "mrp.plan" },
  { key: "purchase", href: "/purchase", name: "Supplier PO", what: "Raise a PO and choose the vendor grade", group: "BUY & RECEIVE", bar: "#4B5563", requires: "po.manage" },
  { key: "grn", href: "/grn", name: "Gate entry & GRN", what: "Vehicle, invoice, lot / heat no., bags and weight", group: "BUY & RECEIVE", bar: "#C2410C", requires: "grn.create" },
  { key: "qc", href: "/qc", name: "Inward QC", what: "MFI, moisture, COA; hold, release or reject", group: "BUY & RECEIVE", bar: "#1D4ED8", requires: "qc.inspect" },
  { key: "scrap", href: "/qc/scrap", name: "Scrap approval", what: "Approve scrap raised from the shop floor", group: "BUY & RECEIVE", bar: "#B42318", requires: "scrap.approve" },

  { key: "stock", href: "/stock", name: "Stores", what: "Stock and bins, put-away and bin-to-bin transfer", group: "STORE & SHOP FLOOR", bar: "#1E7A46", actions: ["stock.transfer"] },
  { key: "requests", href: "/requests", name: "Material requests", what: "Requisitions from the shop floor", group: "STORE & SHOP FLOOR", bar: "#1E7A46", requires: "request.create" },
  { key: "issue", href: "/issue", name: "Issue to shop floor", what: "FIFO issue to machines", group: "STORE & SHOP FLOOR", bar: "#1E7A46", requires: "stock.issue" },
  { key: "scan", href: "/scan", name: "Scanner", what: "Scan to issue, transfer or load, works offline", group: "STORE & SHOP FLOOR", bar: "#15171A" },
  { key: "production", href: "/production", name: "Production", what: "Hourly booking, downtime with reason codes, runner and regrind", group: "STORE & SHOP FLOOR", bar: "#6B4FB0", requires: "production.book", actions: ["downtime.log"] },
  { key: "fg", href: "/fg", name: "FG & box labels", what: "Pack finished goods and print box labels", group: "STORE & SHOP FLOOR", bar: "#6B4FB0", requires: "fg.pack" },
  { key: "planning", href: "/planning", name: "Planning", what: "Which mould runs on which machine, by day", group: "STORE & SHOP FLOOR", bar: "#4B5563", actions: ["plan.manage"] },
  { key: "maintenance", href: "/maintenance", name: "Maintenance", what: "Mould shot life, PM checklists, repairs; machine MTBF / MTTR", group: "STORE & SHOP FLOOR", bar: "#7A4E14", actions: ["maintenance.manage"] },

  { key: "dispatch", href: "/dispatch", name: "Dispatch", what: "Box labels, pick-list scan, DC and e-way data", group: "SHIP", bar: "#15171A", requires: "dispatch.manage" },
  { key: "returnables", href: "/returnables", name: "Returnable ledger", what: "Crates and trolleys issued to and returned by customers", group: "SHIP", bar: "#15171A", requires: "dispatch.manage" },

  { key: "trace", href: "/trace", name: "Traceability", what: "Back and forward trace of any box or lot", group: "TRACE & REPORTS", bar: "#1D4ED8" },
  { key: "variance", href: "/reports/variance", name: "BOM variance", what: "Planned versus actual material use", group: "TRACE & REPORTS", bar: "#1D4ED8", requires: "reports.view" },
];

export const VIEW_KEYS = VIEWS.map((v) => v.key);
export const viewDef = (key: string) => VIEWS.find((v) => v.key === key);
export const isViewKey = (key: string): key is ViewKey => VIEW_KEYS.includes(key as ViewKey);
