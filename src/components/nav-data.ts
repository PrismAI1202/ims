import type { Permission } from "@/server/auth/permissions";

export type NavItem = {
  href: string;
  name: string;
  what: string;
  bar: string;
  perm?: Permission;
  stub?: boolean;
};

export type NavGroup = { name: string; items: NavItem[] };

/** Module groups from the design's "More" screen. `stub` modules have no functionality yet. */
export const NAV_GROUPS: NavGroup[] = [
  {
    name: "SET UP",
    items: [
      { href: "/masters", name: "Admin · Masters", what: "Parts, suppliers, customers, bins, machines and moulds", bar: "#0F5C5C", perm: "masters.manage" },
      { href: "/partners", name: "Customers & suppliers", what: "Every customer and vendor with their open and past orders", bar: "#1D4ED8", stub: true },
      { href: "/boms", name: "BOMs", what: "Blend ratios, inserts, and approved alternate grades by vendor", bar: "#C2410C", stub: true },
      { href: "/equivalents", name: "Equivalent materials", what: "Approved alternate grades grouped by vendor", bar: "#C2410C", stub: true },
    ],
  },
  {
    name: "BUY & RECEIVE",
    items: [
      { href: "/purchase", name: "Supplier PO", what: "Raise a PO and choose the vendor grade", bar: "#4B5563", perm: "po.manage" },
      { href: "/grn", name: "Gate entry & GRN", what: "Vehicle, invoice, lot / heat no., bags and weight", bar: "#C2410C", perm: "grn.create" },
      { href: "/qc", name: "Inward QC", what: "MFI, moisture, COA; hold, release or reject", bar: "#1D4ED8", perm: "qc.inspect" },
    ],
  },
  {
    name: "STORE & SHOP FLOOR",
    items: [
      { href: "/stock", name: "Stores", what: "Stock and bins, bin-to-bin transfer", bar: "#1E7A46", perm: "stock.view" },
      { href: "/requests", name: "Material requests", what: "Requisitions from the shop floor", bar: "#1E7A46", perm: "request.create" },
      { href: "/issue", name: "Issue to shop floor", what: "FIFO issue to machines", bar: "#1E7A46", perm: "stock.issue" },
      { href: "/scan", name: "Scanner", what: "Scan to issue or transfer, works offline", bar: "#15171A", perm: "stock.transfer" },
      { href: "/production", name: "Production", what: "Hourly booking, downtime with reason codes, runner and regrind", bar: "#6B4FB0", stub: true },
      { href: "/planning", name: "Planning", what: "Which mould runs on which machine, by day", bar: "#4B5563", stub: true },
      { href: "/maintenance", name: "Maintenance", what: "Mould shot life, PM checklists, repairs; machine MTBF / MTTR", bar: "#7A4E14", stub: true },
    ],
  },
  {
    name: "SHIP",
    items: [
      { href: "/dispatch", name: "Dispatch", what: "Box labels, pick-list scan, DC and e-way data, returnable crates", bar: "#15171A", stub: true },
    ],
  },
  {
    name: "DEVICE",
    items: [
      { href: "/sync", name: "Sync centre", what: "Offline outbox, conflicts, sync notifications", bar: "#585C63", stub: true },
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

/** Titles and blurbs for modules that exist in the design but not yet in the app. */
export const STUBS: Record<string, { title: string; what: string }> = {
  process: { title: "Factory process", what: "Set up and version the factory process, owned by the Store Incharge." },
  orders: { title: "Orders & traceability", what: "Customer order history, with back and forward tracing of boxes and lots." },
  metrics: { title: "Metrics", what: "OEE and performance by machine, mould and shift." },
  boms: { title: "BOMs", what: "Blend ratios, inserts, and approved alternate grades by vendor." },
  equivalents: { title: "Equivalent materials", what: "Approved alternate grades grouped by vendor." },
  partners: { title: "Customers & suppliers", what: "Every customer and vendor with their open and past orders." },
  production: { title: "Production", what: "Hourly booking, downtime with reason codes, runner and regrind." },
  dispatch: { title: "Dispatch", what: "Box labels, pick-list scan, DC and e-way data, returnable crates." },
  planning: { title: "Planning", what: "Which mould runs on which machine, by day." },
  maintenance: { title: "Maintenance", what: "Mould shot life, PM checklists, repairs; machine MTBF / MTTR." },
  sync: { title: "Sync centre", what: "Offline outbox, conflicts, sync notifications." },
};
