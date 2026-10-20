export type BomLineKind = "RESIN" | "MASTERBATCH" | "REGRIND" | "BOP" | "PACKAGING";

export interface BomLineInput {
  itemId: string;
  kind: BomLineKind;
  pct?: number; // blend lines (RESIN / MASTERBATCH / REGRIND), by weight
  qtyPerPart?: number; // BOP / PACKAGING
}

const BLEND: BomLineKind[] = ["RESIN", "MASTERBATCH", "REGRIND"];
export const isBlend = (k: BomLineKind) => BLEND.includes(k);

// Item categories each line kind may use.
export const KIND_CATEGORY: Record<BomLineKind, string> = {
  RESIN: "RM_RESIN", MASTERBATCH: "RM_MASTERBATCH", REGRIND: "REGRIND", BOP: "BOP", PACKAGING: "PACKAGING",
};

// The BOM line kind follows from the item's category, so forms never ask the user to repeat it.
export function kindForCategory(category: string): BomLineKind | undefined {
  return (Object.keys(KIND_CATEGORY) as BomLineKind[]).find((k) => KIND_CATEGORY[k] === category);
}

const EPS = 0.01;

// Structural rules that need no database. `regrindLimitPct` is the strictest max-regrind among the
// BOM's resin items (undefined = no limit configured).
export function validateBomLines(lines: BomLineInput[], regrindLimitPct?: number): string[] {
  const errors: string[] = [];
  if (lines.length === 0) return ["Add at least one material line."];

  if (!lines.some((l) => l.kind === "RESIN")) errors.push("A BOM needs at least one resin line.");

  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.itemId)) errors.push("The same item appears on more than one line.");
    seen.add(l.itemId);
    if (isBlend(l.kind)) {
      if (!(l.pct !== undefined && l.pct > 0 && l.pct <= 100)) errors.push("Blend lines need a percentage between 0 and 100.");
    } else if (!(l.qtyPerPart !== undefined && l.qtyPerPart > 0)) {
      errors.push("Insert and packaging lines need a quantity per part greater than 0.");
    }
  }

  const blendTotal = lines.filter((l) => isBlend(l.kind)).reduce((s, l) => s + (l.pct ?? 0), 0);
  if (Math.abs(blendTotal - 100) > EPS) {
    errors.push(`Resin + masterbatch + regrind must add up to 100% (currently ${round(blendTotal, 3)}%).`);
  }

  const regrind = lines.filter((l) => l.kind === "REGRIND").reduce((s, l) => s + (l.pct ?? 0), 0);
  if (regrindLimitPct !== undefined && regrind > regrindLimitPct + 1e-9) {
    errors.push(`Regrind is ${round(regrind, 3)}% but this grade allows at most ${regrindLimitPct}%.`);
  }
  return [...new Set(errors)];
}

export interface BookingMath {
  lines: BomLineInput[];
  cavities: number;
  partWeightG: number;
  runnerWeightG: number; // per shot
  shots: number;
  goodParts: number;
  rejectParts: number;
}

export const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

// Runner/sprue produced by `shots` shots, in kg.
export const runnerKg = (shots: number, runnerWeightG: number) => round((shots * runnerWeightG) / 1000, 3);

// Expected material use for a booking. Blend lines scale with everything that went through the
// machine (parts + runner); inserts go into every moulded part, rejects included; packaging only
// packs good parts.
export function expectedConsumption(b: BookingMath): { itemId: string; kind: BomLineKind; expectedQty: number }[] {
  const shotWeightG = b.cavities * b.partWeightG + b.runnerWeightG;
  const materialKg = (b.shots * shotWeightG) / 1000;
  return b.lines.map((l) => {
    let qty: number;
    if (isBlend(l.kind)) qty = (materialKg * (l.pct ?? 0)) / 100;
    else if (l.kind === "BOP") qty = (l.qtyPerPart ?? 0) * (b.goodParts + b.rejectParts);
    else qty = (l.qtyPerPart ?? 0) * b.goodParts;
    return { itemId: l.itemId, kind: l.kind, expectedQty: round(qty, 4) };
  });
}

// Parts can never exceed what the mould physically makes in the shots recorded.
export function validateBooking(b: { shots: number; goodParts: number; rejectParts: number; cavities: number }): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(b.shots) || b.shots <= 0) errors.push("Shots must be a whole number above 0.");
  if (!Number.isInteger(b.goodParts) || b.goodParts < 0) errors.push("Good parts must be 0 or more.");
  if (!Number.isInteger(b.rejectParts) || b.rejectParts < 0) errors.push("Rejected parts must be 0 or more.");
  const max = b.shots * b.cavities;
  if (errors.length === 0 && b.goodParts + b.rejectParts > max) {
    errors.push(`Good + rejected parts (${b.goodParts + b.rejectParts}) exceed what ${b.shots} shots × ${b.cavities} cavities can make (${max}).`);
  }
  return errors;
}
