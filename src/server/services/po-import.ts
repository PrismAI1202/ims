import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { parseDate, type RowError } from "./demand-import";
import { createPurchaseOrderIn, DomainError } from "./inventory";

type Db = PrismaClient;

// Loading supplier POs from a file, for plants that raise them in another tool or track them by hand. One row is one PO line.
// Rows that share a supplier and a PO reference become one PO; rows with no reference become one PO per supplier. A file with any
// bad row is rejected as a whole, so nothing half-loads, and a PO whose reference was already loaded for that supplier is skipped,
// so uploading the same file twice is safe.

const HEADERS = {
  ref: ["poref", "poreference", "reference", "ref", "ponumber", "pono", "ponum", "orderno", "ordernumber", "externalref"],
  supplier: ["suppliercode", "supplier", "vendorcode", "vendor"],
  item: ["itemcode", "item", "partcode", "part", "materialcode", "material", "sku"],
  qty: ["qty", "quantity", "orderqty", "orderedqty"],
  price: ["price", "rate", "unitprice", "unitrate"],
  date: ["expecteddate", "deliverydate", "duedate", "requireddate", "eta", "date"],
  segment: ["segment", "potype"],
} as const;
type Key = keyof typeof HEADERS;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function field(row: Record<string, unknown>, key: Key): unknown {
  for (const [h, v] of Object.entries(row)) if ((HEADERS[key] as readonly string[]).includes(norm(h))) return v;
  return undefined;
}
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export interface PoLineRow { row: number; itemCode: string; qty: number; price?: number; expectedDate?: Date }
export interface PoGroup { ref: string | null; supplierCode: string; segment: "AUTOMOTIVE" | "NON_AUTOMOTIVE"; lines: PoLineRow[] }

/** Thrown when a file is rejected; `errors` lists every row problem (the message shows the first few). */
export class ImportRejected extends DomainError {
  constructor(public errors: RowError[]) {
    const shown = errors.slice(0, 6).map((e) => `row ${e.row}: ${e.message}`).join("; ");
    super(`Nothing was imported. ${errors.length} problem${errors.length === 1 ? "" : "s"} in the file: ${shown}${errors.length > 6 ? `; and ${errors.length - 6} more` : ""}.`);
    this.name = "ImportRejected";
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : NaN;
  return Number.isFinite(n) ? n : null;
};

function segmentOf(v: unknown): PoGroup["segment"] | null {
  const s = norm(text(v));
  if (s === "") return "NON_AUTOMOTIVE";
  if (["automotive", "auto"].includes(s)) return "AUTOMOTIVE";
  if (["nonautomotive", "nonauto", "general", "industrial"].includes(s)) return "NON_AUTOMOTIVE";
  return null;
}

/** Turns spreadsheet rows into PO groups, and lists everything wrong with the rows that can't be used. */
export function parsePoRows(rows: Record<string, unknown>[]): { groups: PoGroup[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const groups = new Map<string, PoGroup>();
  const seen = new Map<string, Set<string>>();

  rows.forEach((raw, i) => {
    const row = i + 2; // the header is row 1
    if (Object.values(raw).every((v) => v === null || v === undefined || text(v) === "")) return;

    const supplierCode = text(field(raw, "supplier")).toUpperCase();
    const itemCode = text(field(raw, "item")).toUpperCase();
    const ref = text(field(raw, "ref")) || null;
    const qty = num(field(raw, "qty"));
    const priceRaw = field(raw, "price");
    const price = text(priceRaw) === "" ? undefined : num(priceRaw);
    const dateRaw = field(raw, "date");
    const expectedDate = text(dateRaw) === "" ? undefined : parseDate(dateRaw);
    const segment = segmentOf(field(raw, "segment"));

    const problems: string[] = [];
    if (!supplierCode) problems.push("supplier code is missing");
    if (!itemCode) problems.push("item code is missing");
    if (qty === null || !(qty > 0) || qty >= 1e9) problems.push("quantity must be a number above 0");
    if (price === null || (price !== undefined && price < 0)) problems.push("price must be a number, 0 or more (or leave it blank for the price master)");
    if (expectedDate === null) problems.push("expected date isn't a valid date (use YYYY-MM-DD or DD/MM/YYYY)");
    if (segment === null) problems.push("segment must be AUTOMOTIVE or NON_AUTOMOTIVE (or blank)");
    if (problems.length) { errors.push({ row, message: problems.join("; ") }); return; }

    const key = `${supplierCode}|${ref ?? ""}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ref, supplierCode, segment: segment!, lines: [] }));
    if (g.segment !== segment && text(field(raw, "segment")) !== "") {
      errors.push({ row, message: `segment differs from the other lines of PO ${ref ?? "for " + supplierCode}; one PO has one segment` });
      return;
    }
    const items = seen.get(key) ?? seen.set(key, new Set()).get(key)!;
    if (items.has(itemCode)) { errors.push({ row, message: `${itemCode} appears twice on PO ${ref ?? "for " + supplierCode}; combine the lines` }); return; }
    items.add(itemCode);
    g.lines.push({ row, itemCode, qty: qty!, price: price ?? undefined, expectedDate: expectedDate ?? undefined });
  });
  if (groups.size === 0 && errors.length === 0) errors.push({ row: 1, message: "the file has no rows to import" });
  return { groups: [...groups.values()], errors };
}

export interface PoImportResult { created: { poNumber: string; ref: string | null; lines: number }[]; skipped: string[] }

/** Checks every row against suppliers and items, then creates all the POs in one transaction. */
export async function importPurchaseOrders(
  input: { groups: PoGroup[]; rowErrors: RowError[]; userId?: string }, db: Db = defaultDb,
): Promise<PoImportResult> {
  const errors: RowError[] = [...input.rowErrors];
  const [suppliers, items] = await Promise.all([
    db.supplier.findMany({ where: { code: { in: [...new Set(input.groups.map((g) => g.supplierCode))] } } }),
    db.item.findMany({ where: { code: { in: [...new Set(input.groups.flatMap((g) => g.lines.map((l) => l.itemCode)))] } } }),
  ]);
  const supplierBy = new Map(suppliers.map((s) => [s.code.toUpperCase(), s]));
  const itemBy = new Map(items.map((i) => [i.code.toUpperCase(), i]));

  for (const g of input.groups) {
    const s = supplierBy.get(g.supplierCode);
    if (!s) g.lines.forEach((l) => errors.push({ row: l.row, message: `supplier "${g.supplierCode}" isn't in the supplier list` }));
    else if (!s.active) g.lines.forEach((l) => errors.push({ row: l.row, message: `supplier ${s.code} is inactive` }));
    for (const l of g.lines) {
      const it = itemBy.get(l.itemCode);
      if (!it) errors.push({ row: l.row, message: `item "${l.itemCode}" isn't in the item master` });
      else if (!it.active) errors.push({ row: l.row, message: `item ${it.code} is inactive` });
      else if (it.category === "FG" || it.category === "REGRIND") errors.push({ row: l.row, message: `${it.code} is ${it.category === "FG" ? "a finished good" : "regrind"}, which is made in-house and isn't bought` });
    }
  }
  if (errors.length) throw new ImportRejected(errors.sort((a, b) => a.row - b.row));

  return db.$transaction(async (tx) => {
    const result: PoImportResult = { created: [], skipped: [] };
    for (const g of input.groups) {
      const s = supplierBy.get(g.supplierCode)!;
      if (g.ref && (await tx.purchaseOrder.findUnique({ where: { supplierId_externalRef: { supplierId: s.id, externalRef: g.ref } } }))) {
        result.skipped.push(g.ref);
        continue;
      }
      const po = await createPurchaseOrderIn(tx, {
        supplierId: s.id, segment: g.segment, externalRef: g.ref ?? undefined, userId: input.userId,
        lines: g.lines.map((l) => ({ itemId: itemBy.get(l.itemCode)!.id, qty: l.qty, price: l.price, expectedDate: l.expectedDate })),
      });
      result.created.push({ poNumber: po.poNumber, ref: g.ref, lines: po.lines.length });
    }
    return result;
  });
}

export const PO_TEMPLATE_CSV = [
  "po_ref,supplier_code,item_code,qty,price,expected_date,segment",
  "ABC-1001,SUP-POLY,RM-PP-001,2000,112,2026-11-20,NON_AUTOMOTIVE",
  "ABC-1001,SUP-POLY,MB-BLK-001,100,,2026-11-20,NON_AUTOMOTIVE",
  "ABC-1002,SUP-PACK,PK-BOX-5P,1500,42,2026-11-25,",
].join("\n") + "\n";
