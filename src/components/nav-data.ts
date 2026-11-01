import type { Permission } from "@/server/auth/permissions";

export type NavItem = {
  href: string;
  name: string;
  what: string;
  bar: string;
  perm?: Permission;
  stub?: boolean; // not built yet
};

export type NavGroup = { name: string; items: NavItem[] };

/** Module groups from the design's "More" screen. `stub` modules have no functionality yet. */
export const NAV_GROUPS: NavGroup[] = [
  {
    name: "SET UP",
    items: [
      { href: "/masters", name: "Admin · Masters", what: "Parts, suppliers, customers, bins, machines and moulds", bar: "#0F5C5C", perm: "masters.manage" },
      { href: "/users", name: "Users & roles", what: "Add, edit and deactivate users; assign roles", bar: "#0F5C5C", perm: "users.manage" },
      { href: "/partners", name: "Customers & suppliers", what: "Every customer and vendor with their open and past orders", bar: "#1D4ED8", perm: "stock.view" },
      { href: "/bom", name: "BOMs", what: "Blend ratios, inserts, and approved alternate grades by vendor", bar: "#C2410C", perm: "bom.manage" },
      { href: "/equivalents", name: "Equivalent materials", what: "Approved alternate grades grouped by vendor", bar: "#C2410C" },
      { href: "/demand", name: "Customer demand", what: "Import customer POs and call-off schedules", bar: "#4B5563", perm: "mrp.plan" },
    ],
  },
  {
    name: "BUY & RECEIVE",
    items: [
      { href: "/mrp", name: "MRP plan", what: "Material shortfall from demand, with suggested POs", bar: "#4B5563", perm: "mrp.plan" },
      { href: "/purchase", name: "Supplier PO", what: "Raise a PO and choose the vendor grade", bar: "#4B5563", perm: "po.manage" },
      { href: "/grn", name: "Gate entry & GRN", what: "Vehicle, invoice, lot / heat no., bags and weight", bar: "#C2410C", perm: "grn.create" },
      { href: "/qc", name: "Inward QC", what: "MFI, moisture, COA; hold, release or reject", bar: "#1D4ED8", perm: "qc.inspect" },
      { href: "/qc/scrap", name: "Scrap approval", what: "Approve scrap raised from the shop floor", bar: "#B42318", perm: "scrap.approve" },
    ],
  },
  {
    name: "STORE & SHOP FLOOR",
    items: [
      { href: "/stock", name: "Stores", what: "Stock and bins, bin-to-bin transfer", bar: "#1E7A46", perm: "stock.view" },
      { href: "/requests", name: "Material requests", what: "Requisitions from the shop floor", bar: "#1E7A46", perm: "request.create" },
      { href: "/issue", name: "Issue to shop floor", what: "FIFO issue to machines", bar: "#1E7A46", perm: "stock.issue" },
      { href: "/scan", name: "Scanner", what: "Scan to issue, transfer or load, works offline", bar: "#15171A", perm: "stock.view" },
      { href: "/production", name: "Production", what: "Hourly booking, downtime with reason codes, runner and regrind", bar: "#6B4FB0", perm: "production.book" },
      { href: "/fg", name: "FG & box labels", what: "Pack finished goods and print box labels", bar: "#6B4FB0", perm: "fg.pack" },
      { href: "/planning", name: "Planning", what: "Which mould runs on which machine, by day", bar: "#4B5563" },
      { href: "/maintenance", name: "Maintenance", what: "Mould shot life, PM checklists, repairs; machine MTBF / MTTR", bar: "#7A4E14" },
    ],
  },
  {
    name: "SHIP",
    items: [
      { href: "/dispatch", name: "Dispatch", what: "Box labels, pick-list scan, DC and e-way data", bar: "#15171A", perm: "dispatch.manage" },
      { href: "/returnables", name: "Returnable ledger", what: "Crates and trolleys issued to and returned by customers", bar: "#15171A", perm: "dispatch.manage" },
    ],
  },
  {
    name: "TRACE & REPORTS",
    items: [
      { href: "/trace", name: "Traceability", what: "Back and forward trace of any box or lot", bar: "#1D4ED8", perm: "stock.view" },
      { href: "/reports/variance", name: "BOM variance", what: "Planned versus actual material use", bar: "#1D4ED8", perm: "reports.view" },
    ],
  },
  {
    name: "DEVICE",
    items: [
      { href: "/account", name: "Account", what: "Change your password", bar: "#585C63" },
      { href: "/sync", name: "Sync centre", what: "Offline outbox and sync status for this device", bar: "#585C63" },
    ],
  },
];

/** The five phone tabs from the design. */
export const TABS = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/process", label: "Process", icon: "process" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/metrics", label: "Metrics", icon: "metrics" },
  { href: "/more", label: "More", icon: "more" },
] as const;
