// How an item's type is shown wherever it must be told apart at a glance: a short tag and a colour of its own, so a part is
// recognisable even when its name doesn't say what it is (FG, resin RM, masterbatch MB, insert BOP, packaging PKG).

export interface ItemTypeStyle { tag: string; group: string; name: string; color: string }

export const ITEM_TYPES: Record<string, ItemTypeStyle> = {
  FG: { tag: "FG", group: "FG", name: "Finished good", color: "#6B4FB0" },
  RM_RESIN: { tag: "RM", group: "RM", name: "Resin", color: "#C2410C" },
  RM_ADDITIVE: { tag: "ADD", group: "RM", name: "Additive", color: "#9A3412" },
  RM_FILLER: { tag: "FIL", group: "RM", name: "Filler", color: "#9A3412" },
  RM_MASTERBATCH: { tag: "MB", group: "MB", name: "Masterbatch", color: "#15171A" },
  BOP: { tag: "BOP", group: "BOP", name: "Bought-out part / insert", color: "#0F5C5C" },
  PACKAGING: { tag: "PKG", group: "PKG", name: "Packaging", color: "#1D4ED8" },
  REGRIND: { tag: "RG", group: "RG", name: "Regrind", color: "#B7791F" },
  RETURNABLE: { tag: "RET", group: "PKG", name: "Returnable crate", color: "#585C63" },
};

export const itemType = (category: string): ItemTypeStyle =>
  ITEM_TYPES[category] ?? { tag: category.slice(0, 3), group: category, name: category, color: "#585C63" };

/** The filter chips, in the order a planner thinks about them. */
export const TYPE_GROUPS: { key: string; label: string }[] = [
  { key: "FG", label: "FG · finished goods" }, { key: "RM", label: "RM · resin" }, { key: "MB", label: "MB · masterbatch" },
  { key: "BOP", label: "BOP · inserts" }, { key: "PKG", label: "PKG · packaging" }, { key: "RG", label: "RG · regrind" },
];
