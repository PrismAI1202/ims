import type { Permission } from "@/server/auth/permissions";
import type { ViewKey } from "./views";

// The blocks a role's Home page is built from. A role lists the ones it wants, in order (Settings · Roles & access);
// a block only shows when the role also has the screen or permission it draws on.

export type HomeWidgetKey =
  | "needs-you" | "stock-health" | "quick-actions"
  | "my-machines" | "todays-shipments" | "qc-queue" | "plant-overview" | "approvals";

export interface HomeWidgetDef {
  key: HomeWidgetKey;
  name: string;
  what: string;
  view?: ViewKey;
  perm?: Permission;
}

export const HOME_WIDGETS: HomeWidgetDef[] = [
  { key: "needs-you", name: "Needs you", what: "The role's task inbox: work waiting at each hand-over" },
  { key: "plant-overview", name: "Plant overview", what: "OEE today, top downtime reason and open exceptions", view: "metrics" },
  { key: "approvals", name: "Approvals", what: "Stock counts waiting for a decision", view: "stock", perm: "stock.adjust" },
  { key: "qc-queue", name: "QC queue", what: "Inward, first-off and final inspection waiting, with the oldest age", view: "quality" },
  { key: "my-machines", name: "My machines", what: "Each machine's mould, plan, last booking, open downtime and material", view: "production" },
  { key: "todays-shipments", name: "Today's shipments", what: "Demand due and FG ready to ship, per customer", view: "orders", perm: "dispatch.manage" },
  { key: "stock-health", name: "Stock health", what: "Red / yellow / green items, with PO and QC status on each", perm: "reorder.view" },
  { key: "quick-actions", name: "Quick actions", what: "Shortcuts to the role's main screens" },
];

export const HOME_WIDGET_KEYS = HOME_WIDGETS.map((w) => w.key);
export const isHomeWidget = (k: string): k is HomeWidgetKey => HOME_WIDGET_KEYS.includes(k as HomeWidgetKey);
export const homeWidget = (k: string) => HOME_WIDGETS.find((w) => w.key === k);
