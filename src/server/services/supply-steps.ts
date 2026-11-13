import type { ViewKey } from "@/lib/views";
import type { Permission } from "@/server/auth/permissions";

// Where an item's supply stands, step by step, for the Home stock-health list: what is already on its way
// (PO placed, in QC, waiting to be put away) and what still has to be started (raise a PO, plan production).
// Pure, so the rules can be tested without a database.

export interface SupplyRow {
  code: string; category: string; status: "RED" | "YELLOW" | "GREEN";
  onHand: number; pendingQc: number; reorderPoint: number; maxStock: number;
  stockTracked?: boolean;
}
export interface Supply { openPoQty: number; toPutAway: number }

export type StepKind = "putaway" | "qc" | "po-due" | "raise-po" | "plan";
export interface SupplyStep {
  kind: StepKind;
  label: string;
  todo: boolean; // true: someone has to start it; false: it is already moving
  links: { view: ViewKey; perm?: Permission; href: string }[]; // first one the viewer's role can open wins
}

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const MADE_IN_HOUSE = ["FG", "REGRIND"];

export function supplySteps(row: SupplyRow, s: Supply): SupplyStep[] {
  const steps: SupplyStep[] = [];
  const item = encodeURIComponent(row.code);
  if (s.toPutAway > 0) {
    steps.push({ kind: "putaway", label: `${n(s.toPutAway)} to put away`, todo: true, links: [{ view: "stock", href: `/stock?view=bins&item=${item}` }] });
  }
  if (row.pendingQc > 0) {
    steps.push({ kind: "qc", label: `${n(row.pendingQc)} in QC`, todo: false, links: [{ view: "quality", perm: "qc.inspect", href: "/quality?tab=inward" }] });
  }
  if (s.openPoQty > 0) {
    steps.push({
      kind: "po-due", label: `PO placed · ${n(s.openPoQty)} due`, todo: false,
      links: [{ view: "grn", href: "/grn" }, { view: "orders", href: `/orders?kind=po&q=${item}` }],
    });
  }
  if (row.status === "GREEN") return steps;

  if (row.category === "FG") {
    steps.push({ kind: "plan", label: "Plan production", todo: true, links: [{ view: "planning", href: "/planning" }, { view: "production", href: "/production" }] });
  } else if (!MADE_IN_HOUSE.includes(row.category) && !(row.category === "RETURNABLE" && !row.stockTracked)) {
    // Still at or below the reorder point once everything already coming has arrived: a PO is needed.
    const projected = row.onHand + row.pendingQc + s.openPoQty;
    if (projected <= row.reorderPoint) {
      const qty = Math.max(Math.ceil(row.maxStock - projected), 1);
      steps.push({
        kind: "raise-po", label: s.openPoQty > 0 ? "Raise another PO" : "Raise PO", todo: true,
        links: [{ view: "orders", perm: "po.manage", href: `/orders?new=po&item=${item}&qty=${qty}` }, { view: "mrp", href: "/mrp" }],
      });
    }
  }
  return steps;
}

export const needsPo = (row: SupplyRow, s: Supply) => supplySteps(row, s).some((x) => x.kind === "raise-po");
