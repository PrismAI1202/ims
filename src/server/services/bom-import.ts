import type { Item, PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { isBlend, kindForCategory } from "./bom-math";
import type { RowError } from "./demand-import";
import { DomainError } from "./inventory";
import { createItemIn } from "./masters";
import { ImportRejected } from "./po-import";
import { saveBomIn } from "./production";

type Db = PrismaClient;

// Loading BOMs from a spreadsheet. One row is one material line of one finished part; rows with the same fg_code make one BOM.
// Parts, materials and prices that aren't in the system yet can be created from the same file (optional columns), so a new
// product can come in whole: it then shows in Stores against its stock levels and can be ordered from its supplier.
// The whole file is checked and saved in one transaction: any problem and nothing is kept.

const HEADERS = {
  fg: ["fgcode", "fg", "partcode", "part", "finishedpart", "productcode", "product"],
  fgName: ["fgname", "partname", "productname", "finishedpartname"],
  mould: ["mouldcode", "mould", "moldcode", "mold", "tool", "toolcode"],
  weight: ["partweightg", "partweight", "netpartweightg", "netweightg", "netweight", "weightg"],
  material: ["materialcode", "material", "itemcode", "item", "component", "componentcode", "rawmaterial"],
  pct: ["pct", "percent", "percentage", "blendpct", "blendpercent"],
  qty: ["qtyperpart", "quantityperpart", "qtypart", "perpart", "qty", "quantity"],
  value: ["value", "amount"],
  name: ["materialname", "itemname", "componentname"],
  type: ["materialtype", "type", "kind", "materialcategory", "category"],
  uom: ["uom", "unit", "materialuom"],
  grade: ["polymergrade", "grade", "polymer"],
  maxRegrind: ["maxregrindpct", "maxregrind"],
  min: ["minstock", "min"],
  rop: ["reorderpoint", "rop", "reorderlevel"],
  max: ["maxstock", "max"],
  supplier: ["suppliercode", "supplier", "vendorcode", "vendor"],
  price: ["buyingprice", "purchaseprice", "price", "rate", "unitprice"],
} as const;
type Key = keyof typeof HEADERS;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function field(row: Record<string, unknown>, key: Key): unknown {
  for (const [h, v] of Object.entries(row)) if ((HEADERS[key] as readonly string[]).includes(norm(h))) return v;
  return undefined;
}
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (text(v) === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(n) ? n : NaN;
};

/** The words a file may use for a material's type, mapped to the item category. */
const TYPES: Record<string, string> = {
  resin: "RM_RESIN", rmresin: "RM_RESIN", rawresin: "RM_RESIN",
  masterbatch: "RM_MASTERBATCH", mb: "RM_MASTERBATCH", rmmasterbatch: "RM_MASTERBATCH",
  regrind: "REGRIND",
  insert: "BOP", inserts: "BOP", bop: "BOP", boughtout: "BOP", boughtoutpart: "BOP",
  packaging: "PACKAGING", pkg: "PACKAGING", pack: "PACKAGING",
};
const categoryOf = (v: unknown) => TYPES[norm(text(v))];

export interface BomImportLine {
  row: number; material: string; amount: number; via: "pct" | "qty" | "value";
  create?: { name: string; category: string; uom?: string; grade?: string; maxRegrind?: number; min?: number; rop?: number; max?: number; supplier?: string; price?: number };
}
export interface BomImportGroup { fg: string; fgName?: string; mould: string; weight: number | null; firstRow: number; lines: BomImportLine[] }

/** Turns spreadsheet rows into one group per finished part, and lists everything wrong with the rows that can't be used. */
export function parseBomRows(rows: Record<string, unknown>[]): { groups: BomImportGroup[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const groups = new Map<string, BomImportGroup>();

  rows.forEach((raw, i) => {
    const row = i + 2; // the header is row 1
    if (Object.values(raw).every((v) => v === null || v === undefined || text(v) === "")) return;

    const fg = text(field(raw, "fg")).toUpperCase();
    const mould = text(field(raw, "mould")).toUpperCase();
    const material = text(field(raw, "material")).toUpperCase();
    const weight = num(field(raw, "weight"));
    const pct = num(field(raw, "pct")), qty = num(field(raw, "qty")), val = num(field(raw, "value"));
    const given = [["pct", pct], ["qty", qty], ["value", val]].filter(([, v]) => v !== null) as ["pct" | "qty" | "value", number][];
    const typeRaw = text(field(raw, "type"));
    const category = typeRaw ? categoryOf(typeRaw) : undefined;
    const min = num(field(raw, "min")), rop = num(field(raw, "rop")), max = num(field(raw, "max"));
    const maxRegrind = num(field(raw, "maxRegrind")), price = num(field(raw, "price"));

    const problems: string[] = [];
    if (!fg) problems.push("fg_code is missing");
    if (!mould) problems.push("mould_code is missing");
    if (!material) problems.push("material_code is missing");
    if (weight !== null && !(weight > 0)) problems.push("part_weight_g must be a number above 0");
    if (given.length === 0) problems.push("give the amount in pct (resin, masterbatch, regrind) or qty_per_part (inserts, packaging)");
    else if (given.length > 1) problems.push("give either pct or qty_per_part, not both");
    else if (!(given[0][1] > 0)) problems.push("the amount must be a number above 0");
    if (typeRaw && !category) problems.push(`material_type "${typeRaw}" isn't one of resin, masterbatch, regrind, insert, packaging`);
    for (const [label, v] of [["min_stock", min], ["reorder_point", rop], ["max_stock", max], ["max_regrind_pct", maxRegrind], ["price", price]] as const) {
      if (v !== null && !(v >= 0)) problems.push(`${label} must be a number, 0 or more`);
    }
    if (problems.length) { errors.push({ row, message: problems.join("; ") }); return; }

    let g = groups.get(fg);
    if (!g) groups.set(fg, (g = { fg, fgName: text(field(raw, "fgName")) || undefined, mould, weight, firstRow: row, lines: [] }));
    if (!g.fgName && text(field(raw, "fgName"))) g.fgName = text(field(raw, "fgName"));
    if (g.mould !== mould) { errors.push({ row, message: `${fg} uses two moulds (${g.mould} and ${mould}); one BOM has one mould` }); return; }
    if (weight !== null) {
      if (g.weight !== null && Math.abs(g.weight - weight) > 1e-9) { errors.push({ row, message: `${fg} has two part weights (${g.weight} and ${weight})` }); return; }
      g.weight = weight;
    }
    if (g.lines.some((l) => l.material === material)) { errors.push({ row, message: `${material} appears twice on ${fg}; combine the lines` }); return; }

    const [via, amount] = given[0];
    const wantsNew = text(field(raw, "name")) !== "" || category !== undefined;
    g.lines.push({
      row, material, amount, via,
      create: wantsNew ? {
        name: text(field(raw, "name")), category: category ?? "", uom: text(field(raw, "uom")).toUpperCase() || undefined, grade: text(field(raw, "grade")) || undefined,
        maxRegrind: maxRegrind ?? undefined, min: min ?? undefined, rop: rop ?? undefined, max: max ?? undefined,
        supplier: text(field(raw, "supplier")).toUpperCase() || undefined, price: price ?? undefined,
      } : undefined,
    });
  });
  if (groups.size === 0 && errors.length === 0) errors.push({ row: 1, message: "the file has no rows to import" });
  for (const g of groups.values()) if (g.weight === null) errors.push({ row: g.firstRow, message: `${g.fg} has no part_weight_g` });
  return { groups: [...groups.values()], errors };
}

export interface BomImportResult {
  created: string[]; replaced: string[]; skipped: string[];
  newItems: { code: string; category: string; levelsSet: boolean; supplierSet: boolean }[];
}

/** Checks the file against parts, moulds and materials, then saves every BOM (and any new items) in one transaction. */
export async function importBoms(
  input: { groups: BomImportGroup[]; rowErrors: RowError[]; createMissing: boolean; replaceExisting: boolean },
  db: Db = defaultDb,
): Promise<BomImportResult> {
  const errors: RowError[] = [...input.rowErrors];
  const codes = (f: (g: BomImportGroup) => string[]) => [...new Set(input.groups.flatMap(f))];
  const [fgs, mats, moulds, boms, suppliers] = await Promise.all([
    db.item.findMany({ where: { code: { in: codes((g) => [g.fg]) } } }),
    db.item.findMany({ where: { code: { in: codes((g) => g.lines.map((l) => l.material)) } } }),
    db.mould.findMany({ where: { code: { in: codes((g) => [g.mould]) } } }),
    db.bom.findMany({ where: { fgItem: { code: { in: codes((g) => [g.fg]) } } }, include: { fgItem: true } }),
    db.supplier.findMany({ where: { code: { in: codes((g) => g.lines.flatMap((l) => (l.create?.supplier ? [l.create.supplier] : []))) } } }),
  ]);
  const fgBy = new Map(fgs.map((i) => [i.code.toUpperCase(), i]));
  const matBy = new Map(mats.map((i) => [i.code.toUpperCase(), i]));
  const mouldBy = new Map(moulds.map((m) => [m.code.toUpperCase(), m]));
  const hasBom = new Set(boms.map((b) => b.fgItem.code.toUpperCase()));
  const supplierBy = new Map(suppliers.map((s) => [s.code.toUpperCase(), s]));

  const todo = input.groups.filter((g) => input.replaceExisting || !hasBom.has(g.fg));
  const skipped = input.groups.filter((g) => !todo.includes(g)).map((g) => g.fg);
  const hint = " (tick “create parts and materials that aren't in the system yet” and add the name and type columns to create it)";

  for (const g of todo) {
    const fg = fgBy.get(g.fg);
    if (fg && fg.category !== "FG") errors.push({ row: g.firstRow, message: `${g.fg} exists but isn't a finished-goods part` });
    else if (fg && !fg.active) errors.push({ row: g.firstRow, message: `part ${g.fg} is inactive` });
    else if (!fg && !(input.createMissing && g.fgName)) errors.push({ row: g.firstRow, message: input.createMissing ? `part ${g.fg} is new: add an fg_name for it` : `part ${g.fg} isn't in the item master${hint}` });
    if (!mouldBy.has(g.mould)) errors.push({ row: g.firstRow, message: `mould ${g.mould} isn't set up: add it under Maintenance (Edit list → Add mould) first` });

    for (const l of g.lines) {
      const it = matBy.get(l.material);
      if (it) {
        if (!it.active) errors.push({ row: l.row, message: `material ${it.code} is inactive` });
        const kind = kindForCategory(it.category);
        if (!kind) errors.push({ row: l.row, message: `${it.code} is ${it.category.replace("_", " ").toLowerCase()}, which can't be a BOM material` });
        else if (isBlend(kind) && l.via === "qty") errors.push({ row: l.row, message: `${it.code} is a ${kind.toLowerCase()}: give pct, not qty_per_part` });
        else if (!isBlend(kind) && l.via === "pct") errors.push({ row: l.row, message: `${it.code} is ${kind === "BOP" ? "an insert" : "packaging"}: give qty_per_part, not pct` });
      } else {
        const c = l.create;
        if (!input.createMissing) errors.push({ row: l.row, message: `material ${l.material} isn't in the item master${hint}` });
        else if (!c || !c.name || !c.category) errors.push({ row: l.row, message: `material ${l.material} is new: add material_name and material_type for it` });
        else {
          const kind = kindForCategory(c.category)!;
          if (isBlend(kind) && l.via === "qty") errors.push({ row: l.row, message: `${l.material} is a ${kind.toLowerCase()}: give pct, not qty_per_part` });
          if (!isBlend(kind) && l.via === "pct") errors.push({ row: l.row, message: `${l.material} is ${kind === "BOP" ? "an insert" : "packaging"}: give qty_per_part, not pct` });
          if (c.supplier && !supplierBy.get(c.supplier)) errors.push({ row: l.row, message: `supplier "${c.supplier}" isn't in the supplier list` });
          if (c.price !== undefined && !c.supplier) errors.push({ row: l.row, message: "a price needs a supplier_code" });
          if (c.supplier && kind === "REGRIND") errors.push({ row: l.row, message: "regrind is made here, so it has no supplier" });
        }
      }
    }
  }
  if (errors.length) throw new ImportRejected(errors.sort((a, b) => a.row - b.row));

  return db.$transaction(async (tx) => {
    const out: BomImportResult = { created: [], replaced: [], skipped, newItems: [] };
    const failures: RowError[] = [];
    const made = new Map<string, Item>();
    const itemFor = async (l: BomImportLine): Promise<Item> => {
      const have = matBy.get(l.material) ?? made.get(l.material);
      if (have) return have;
      const c = l.create!;
      const kind = kindForCategory(c.category)!;
      const sup = c.supplier ? supplierBy.get(c.supplier)! : null;
      const item = await createItemIn(tx, {
        code: l.material, name: c.name, category: c.category, uom: c.uom ?? (isBlend(kind) ? "KG" : "NOS"),
        polymerGrade: c.grade ?? "", maxRegrindPct: c.maxRegrind ?? "", minStock: c.min ?? 0, reorderPoint: c.rop ?? 0, maxStock: c.max ?? 0,
        requiresCoa: kind === "RESIN",
      }, sup && c.price !== undefined ? { supplierId: sup.id, price: c.price } : null);
      made.set(l.material, item);
      out.newItems.push({ code: item.code, category: item.category, levelsSet: (c.rop ?? 0) > 0 || (c.min ?? 0) > 0, supplierSet: !!(sup && c.price !== undefined) });
      return item;
    };

    for (const g of todo) {
      try {
        let fg = fgBy.get(g.fg);
        if (!fg) {
          fg = await createItemIn(tx, { code: g.fg, name: g.fgName!, category: "FG", uom: "NOS", minStock: 0, reorderPoint: 0, maxStock: 0 }, null);
          out.newItems.push({ code: fg.code, category: "FG", levelsSet: false, supplierSet: false });
        }
        const lines = [];
        for (const l of g.lines) {
          const item = await itemFor(l);
          const kind = kindForCategory(item.category)!;
          lines.push(isBlend(kind) ? { itemId: item.id, kind, pct: l.amount } : { itemId: item.id, kind, qtyPerPart: l.amount });
        }
        await saveBomIn(tx, { fgItemId: fg.id, mouldId: mouldBy.get(g.mould)!.id, partWeightG: g.weight!, lines });
        (hasBom.has(g.fg) ? out.replaced : out.created).push(g.fg);
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        failures.push({ row: g.firstRow, message: `${g.fg}: ${e.message}` });
      }
    }
    if (failures.length) throw new ImportRejected(failures); // throwing rolls back every item and BOM made so far
    return out;
  });
}

export const BOM_TEMPLATE_CSV = [
  "fg_code,mould_code,part_weight_g,material_code,pct,qty_per_part,fg_name,material_name,material_type,uom,polymer_grade,max_regrind_pct,min_stock,reorder_point,max_stock,supplier_code,price",
  "FG-CLIP-001,MLD-1001,8.5,RM-PP-001,70,,,,,,,,,,,,",
  "FG-CLIP-001,MLD-1001,8.5,MB-BLK-001,5,,,,,,,,,,,,",
  "FG-CLIP-001,MLD-1001,8.5,RG-PP-001,25,,,,,,,,,,,,",
  "FG-CLIP-001,MLD-1001,8.5,BOP-INS-M6,,2,,,,,,,,,,,",
  "FG-NEW-010,MLD-1001,12,RM-NEW-PA6,90,,New bracket,PA6 GF30 (new grade),resin,KG,PA6,15,500,1000,3000,SUP-POLY,310",
  "FG-NEW-010,MLD-1001,12,MB-BLK-001,10,,,,,,,,,,,,",
  "FG-NEW-010,MLD-1001,12,PK-NEW-BOX,,0.01,,New carton 500x400,packaging,NOS,,,200,400,1500,SUP-PACK,42",
].join("\n") + "\n";
