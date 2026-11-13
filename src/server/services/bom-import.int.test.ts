import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importBoms, parseBomRows } from "./bom-import";
import { ImportRejected } from "./po-import";
import { stockByItem } from "./stock";
import { supplySteps } from "./supply-steps";
import { planMrp } from "./mrp";
import { createItemWithSupplier, removeSupplierPrice, setSupplierPrice } from "./masters";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

const load = (rows: Record<string, unknown>[], o: { createMissing?: boolean; replaceExisting?: boolean } = {}) => {
  const p = parseBomRows(rows);
  return importBoms({ groups: p.groups, rowErrors: p.errors, createMissing: !!o.createMissing, replaceExisting: !!o.replaceExisting }, db);
};
// Runs an import that should be refused and returns the refusal, so tests can read its row errors.
const rejected = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as ImportRejected; }
  throw new Error("expected the import to be rejected");
};
const line = (fg: string, material: string, pct: number | null, extra: Record<string, unknown> = {}) =>
  ({ fg_code: fg, mould_code: "MLD-1", part_weight_g: 10, material_code: material, ...(pct === null ? { qty_per_part: 2 } : { pct }), ...extra });

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["BookingConsumption", "ProductionBooking", "BomLine", "Bom", "PriceMaster", "StockTransaction", "StockBalance", "Lot", "Mould", "Item", "Supplier"]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  await db.mould.create({ data: { code: "MLD-1", name: "Clip", cavities: 4 } });
  await db.supplier.create({ data: { code: "SUP-A", name: "Alpha Poly", leadTimeDays: 10 } });
  const mk = (code: string, category: string, extra: object = {}) => db.item.create({ data: { code, name: code, category: category as never, uom: category === "BOP" ? "NOS" : "KG", ...extra } });
  await mk("FG-OLD", "FG", { uom: "NOS" });
  await mk("RM-PP", "RM_RESIN", { polymerGrade: "PP", maxRegrindPct: 25 });
  await mk("MB-1", "RM_MASTERBATCH");
  await mk("RG-PP", "REGRIND", { polymerGrade: "PP" });
  await mk("INS-1", "BOP");
});

describe("importBoms with existing parts and materials", () => {
  it("creates a BOM per part from the rows, working out the kind from each item", async () => {
    const r = await load([line("FG-OLD", "RM-PP", 70), line("FG-OLD", "MB-1", 5), line("FG-OLD", "RG-PP", 25), line("FG-OLD", "INS-1", null)]);
    expect(r).toMatchObject({ created: ["FG-OLD"], replaced: [], skipped: [], newItems: [] });
    const bom = await db.bom.findFirstOrThrow({ include: { lines: true, mould: true } });
    expect(Number(bom.partWeightG)).toBe(10);
    expect(bom.lines.map((l) => [l.kind, l.pct === null ? Number(l.qtyPerPart) : Number(l.pct)]).sort()).toEqual([["BOP", 2], ["MASTERBATCH", 5], ["REGRIND", 25], ["RESIN", 70]]);
  });

  it("skips a part that already has a BOM unless asked to replace it", async () => {
    const rows = [line("FG-OLD", "RM-PP", 95), line("FG-OLD", "MB-1", 5)];
    await load(rows);
    const again = await load([line("FG-OLD", "RM-PP", 90), line("FG-OLD", "MB-1", 10)]);
    expect(again).toMatchObject({ created: [], skipped: ["FG-OLD"] });
    expect(Number((await db.bomLine.findFirstOrThrow({ where: { kind: "RESIN" } })).pct)).toBe(95);
    const replaced = await load([line("FG-OLD", "RM-PP", 90), line("FG-OLD", "MB-1", 10)], { replaceExisting: true });
    expect(replaced).toMatchObject({ replaced: ["FG-OLD"] });
    expect(Number((await db.bomLine.findFirstOrThrow({ where: { kind: "RESIN" } })).pct)).toBe(90);
    expect(await db.bom.count()).toBe(1);
  });

  it("rejects the whole file when anything is wrong, naming each problem, and saves nothing", async () => {
    await db.item.create({ data: { code: "FG-2", name: "Second", category: "FG", uom: "NOS" } });
    const err = await rejected(load([
      line("FG-OLD", "RM-PP", 95), line("FG-OLD", "MB-1", 5), // fine
      line("FG-2", "GHOST", 100), // unknown material
      line("FG-GHOST", "RM-PP", 100), // unknown part
      { ...line("FG-2", "INS-1", 50), mould_code: "MLD-1" }, // pct on an insert
    ]));
    expect(err).toBeInstanceOf(ImportRejected);
    const msgs = (err as ImportRejected).errors.map((e) => e.message).join(" | ");
    expect(msgs).toMatch(/GHOST isn't in the item master/);
    expect(msgs).toMatch(/part FG-GHOST isn't in the item master/);
    expect(msgs).toMatch(/INS-1 is an insert: give qty_per_part, not pct/);
    expect(await db.bom.count()).toBe(0);
  });

  it("refuses an unknown mould, and a BOM that breaks the blend rules, rolling everything back", async () => {
    const noMould = await rejected(load([{ ...line("FG-OLD", "RM-PP", 100), mould_code: "NOPE" }]));
    expect(noMould.errors[0].message).toMatch(/mould NOPE isn't set up/);
    await db.item.create({ data: { code: "FG-2", name: "Second", category: "FG", uom: "NOS" } });
    const bad = await rejected(load([line("FG-OLD", "RM-PP", 60), line("FG-OLD", "MB-1", 5), line("FG-2", "RM-PP", 60), line("FG-2", "RG-PP", 40)]));
    expect(bad).toBeInstanceOf(ImportRejected);
    expect(bad.errors.map((e: { message: string }) => e.message).join(" | ")).toMatch(/FG-OLD: Resin \+ masterbatch \+ regrind must add up to 100%[\s\S]*FG-2: Regrind is 40% but this grade allows at most 25%/);
    expect(await db.bom.count()).toBe(0); // FG-OLD was valid on its own but is not kept
  });
});

describe("importBoms creating new parts, materials and suppliers' prices", () => {
  const newRows = () => [
    line("FG-NEW", "RM-NEW", 90, { fg_name: "New bracket", material_name: "PA6 GF30", material_type: "resin", polymer_grade: "PA6", max_regrind_pct: 15, min_stock: 500, reorder_point: 1000, max_stock: 3000, supplier_code: "SUP-A", price: 310 }),
    line("FG-NEW", "MB-1", 10),
    line("FG-NEW", "PK-NEW", null, { material_name: "New carton", material_type: "packaging", min_stock: 200, reorder_point: 400, max_stock: 1500, supplier_code: "SUP-A", price: 42 }),
  ];

  it("refuses unknown codes unless creation is switched on, then asks for the details it needs", async () => {
    const off = await rejected(load(newRows()));
    expect(off.errors.map((e: { message: string }) => e.message).join(" | ")).toMatch(/part FG-NEW isn't in the item master[\s\S]*RM-NEW isn't in the item master/);
    const thin = await rejected(load([line("FG-NEW", "RM-PP", 100)], { createMissing: true }));
    expect(thin.errors[0].message).toMatch(/part FG-NEW is new: add an fg_name/);
    const noName = await rejected(load([line("FG-OLD", "RM-X", 100)], { createMissing: true }));
    expect(noName.errors[0].message).toMatch(/RM-X is new: add material_name and material_type/);
    const badSup = await rejected(load([line("FG-OLD", "RM-X", 100, { material_name: "X", material_type: "resin", supplier_code: "NOPE", price: 1 })], { createMissing: true }));
    expect(badSup.errors[0].message).toMatch(/supplier "NOPE" isn't in the supplier list/);
    expect(await db.item.count()).toBe(5);
  });

  it("creates the part, the materials and their supplier prices together with the BOM", async () => {
    const r = await load(newRows(), { createMissing: true });
    expect(r.created).toEqual(["FG-NEW"]);
    expect(r.newItems.map((i) => [i.code, i.category, i.levelsSet, i.supplierSet])).toEqual([["FG-NEW", "FG", false, false], ["RM-NEW", "RM_RESIN", true, true], ["PK-NEW", "PACKAGING", true, true]]);
    const resin = await db.item.findFirstOrThrow({ where: { code: "RM-NEW" } });
    expect(resin).toMatchObject({ name: "PA6 GF30", uom: "KG", polymerGrade: "PA6", requiresCoa: true });
    expect([Number(resin.minStock), Number(resin.reorderPoint), Number(resin.maxStock), Number(resin.maxRegrindPct)]).toEqual([500, 1000, 3000, 15]);
    expect((await db.item.findFirstOrThrow({ where: { code: "PK-NEW" } })).uom).toBe("NOS");
    expect(Number((await db.priceMaster.findFirstOrThrow({ where: { itemId: resin.id } })).price)).toBe(310);
    expect((await db.bom.findFirstOrThrow({ include: { lines: true } })).lines).toHaveLength(3);
  });

  it("rolls back the new items too when a BOM in the file breaks the rules", async () => {
    const err = await rejected(load([
      line("FG-NEW", "RM-NEW", 80, { fg_name: "New bracket", material_name: "PA6", material_type: "resin", supplier_code: "SUP-A", price: 1 }),
    ], { createMissing: true }));
    expect(err.errors[0].message).toMatch(/FG-NEW: Resin \+ masterbatch \+ regrind must add up to 100%/);
    expect(await db.item.count({ where: { code: { in: ["FG-NEW", "RM-NEW"] } } })).toBe(0);
    expect(await db.priceMaster.count()).toBe(0);
  });
});

describe("a new material is tracked through Stores and can be ordered", () => {
  it("shows as low stock, offers Raise PO with its supplier, and is orderable from MRP", async () => {
    await load([
      line("FG-NEW", "RM-NEW", 100, { fg_name: "New bracket", material_name: "PA6 GF30", material_type: "resin", polymer_grade: "PA6", min_stock: 500, reorder_point: 1000, max_stock: 3000, supplier_code: "SUP-A", price: 310 }),
    ], { createMissing: true });
    const row = (await stockByItem(db)).find((r) => r.code === "RM-NEW")!;
    expect(row).toMatchObject({ onHand: 0, status: "RED", minStock: 500, reorderPoint: 1000, maxStock: 3000 });
    const step = supplySteps(row, { openPoQty: 0, toPutAway: 0 }).find((s) => s.kind === "raise-po")!;
    expect(step.links[0].href).toBe("/orders?new=po&item=RM-NEW&qty=3000");
    const plan = await planMrp({ horizonDays: 30, scrapPct: 0 }, db);
    const mrp = plan.rows.find((r) => r.code === "RM-NEW")!;
    expect(mrp.buyable).toBe(true);
    expect(mrp.supplier).toMatchObject({ name: "Alpha Poly", price: 310 });
  });

  it("without a price it still shows as low stock, but MRP says it has no supplier", async () => {
    await load([line("FG-NEW", "RM-NEW", 100, { fg_name: "New part", material_name: "PA6", material_type: "resin", min_stock: 5, reorder_point: 10, max_stock: 50 })], { createMissing: true });
    expect((await stockByItem(db)).find((r) => r.code === "RM-NEW")!.status).toBe("RED");
    expect((await planMrp({ horizonDays: 30, scrapPct: 0 }, db)).rows.find((r) => r.code === "RM-NEW")!.supplier).toBeNull();
  });
});

describe("supplier prices on an item", () => {
  it("creates an item with its supplier, and the price can be changed or removed later", async () => {
    const sup = await db.supplier.findFirstOrThrow();
    const item = await createItemWithSupplier({ code: "RM-Q", name: "Quick resin", category: "RM_RESIN", uom: "KG", minStock: 10, reorderPoint: 20, maxStock: 100 }, { supplierId: sup.id, price: 99 }, db);
    expect(Number((await db.priceMaster.findFirstOrThrow({ where: { itemId: item.id } })).price)).toBe(99);
    await setSupplierPrice(item.id, { supplierId: sup.id, price: 105 }, db);
    expect(await db.priceMaster.count({ where: { itemId: item.id } })).toBe(1);
    expect(Number((await db.priceMaster.findFirstOrThrow({ where: { itemId: item.id } })).price)).toBe(105);
    await removeSupplierPrice(item.id, sup.id, db);
    expect(await db.priceMaster.count({ where: { itemId: item.id } })).toBe(0);
    await expect(removeSupplierPrice(item.id, sup.id, db)).rejects.toThrow(/isn't listed/);
  });

  it("refuses a supplier for in-house items, a negative price, an unknown or inactive supplier", async () => {
    const sup = await db.supplier.findFirstOrThrow();
    await expect(createItemWithSupplier({ code: "FG-Q", name: "Quick part", category: "FG", uom: "NOS", minStock: 0, reorderPoint: 0, maxStock: 0 }, { supplierId: sup.id, price: 1 }, db)).rejects.toThrow(/made here/);
    await expect(createItemWithSupplier({ code: "RM-R", name: "Quick resin", category: "RM_RESIN", uom: "KG", minStock: 0, reorderPoint: 0, maxStock: 0 }, { supplierId: sup.id, price: -1 }, db)).rejects.toThrow(/can't be negative/);
    await expect(createItemWithSupplier({ code: "RM-S", name: "Quick resin", category: "RM_RESIN", uom: "KG", minStock: 0, reorderPoint: 0, maxStock: 0 }, { supplierId: "nope", price: 1 }, db)).rejects.toThrow(/active supplier/);
    expect(await db.item.count({ where: { code: { in: ["FG-Q", "RM-R", "RM-S"] } } })).toBe(0); // the item is not kept when its price fails
    await db.supplier.update({ where: { id: sup.id }, data: { active: false } });
    await expect(createItemWithSupplier({ code: "RM-T", name: "Quick resin", category: "RM_RESIN", uom: "KG", minStock: 0, reorderPoint: 0, maxStock: 0 }, { supplierId: sup.id, price: 1 }, db)).rejects.toThrow(/active supplier/);
  });
});
