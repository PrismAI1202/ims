import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importPurchaseOrders, ImportRejected, parsePoRows } from "./po-import";
import { createPurchaseOrder } from "./inventory";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let sup: string;
const load = (rows: Record<string, unknown>[], userId?: string) => {
  const p = parsePoRows(rows);
  return importPurchaseOrders({ groups: p.groups, rowErrors: p.errors, userId }, db);
};

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["PurchaseOrderLine", "PurchaseOrder", "PriceMaster", "Supplier", "Item"]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  const s = await db.supplier.create({ data: { code: "SUP-A", name: "Alpha Poly", leadTimeDays: 10 } });
  await db.supplier.create({ data: { code: "SUP-OFF", name: "Closed Co", leadTimeDays: 5, active: false } });
  sup = s.id;
  const pp = await db.item.create({ data: { code: "RM-PP", name: "PP", category: "RM_RESIN", uom: "KG" } });
  await db.item.create({ data: { code: "MB-1", name: "MB", category: "RM_MASTERBATCH", uom: "KG" } });
  await db.item.create({ data: { code: "FG-1", name: "FG", category: "FG", uom: "NOS" } });
  await db.priceMaster.create({ data: { itemId: pp.id, supplierId: s.id, price: 100 } });
});

describe("importPurchaseOrders", () => {
  it("creates approved POs with their reference, using the price master where the file has no price", async () => {
    const r = await load([
      { po_ref: "EXT-1", supplier_code: "SUP-A", item_code: "RM-PP", qty: 500, expected_date: "2026-12-01" },
      { po_ref: "EXT-1", supplier_code: "SUP-A", item_code: "MB-1", qty: 20, price: 260 },
      { po_ref: "EXT-2", supplier_code: "SUP-A", item_code: "RM-PP", qty: 80, price: 95.5, segment: "AUTOMOTIVE" },
    ], "u1");
    expect(r.created.map((c) => [c.ref, c.lines])).toEqual([["EXT-1", 2], ["EXT-2", 1]]);
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { externalRef: "EXT-1" }, include: { lines: { include: { item: true } } } });
    expect(po).toMatchObject({ status: "APPROVED", supplierId: sup, createdById: "u1", segment: "NON_AUTOMOTIVE" });
    const price = (code: string) => Number(po.lines.find((l) => l.item.code === code)!.price);
    expect(price("RM-PP")).toBe(100); // price master
    expect(price("MB-1")).toBe(260); // from the file
    expect(po.lines.find((l) => l.item.code === "RM-PP")!.expectedDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect((await db.purchaseOrder.findFirstOrThrow({ where: { externalRef: "EXT-2" } })).segment).toBe("AUTOMOTIVE");
  });

  it("skips a PO whose reference is already loaded, so the same file can be uploaded twice", async () => {
    const rows = [{ po_ref: "EXT-1", supplier_code: "SUP-A", item_code: "RM-PP", qty: 5 }, { po_ref: "EXT-9", supplier_code: "SUP-A", item_code: "MB-1", qty: 1 }];
    expect((await load(rows)).created).toHaveLength(2);
    const again = await load(rows);
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual(["EXT-1", "EXT-9"]);
    expect(await db.purchaseOrder.count()).toBe(2);
  });

  it("creates nothing when any row is wrong, and names every problem", async () => {
    const err = await load([
      { po_ref: "OK-1", supplier_code: "SUP-A", item_code: "RM-PP", qty: 5 },
      { po_ref: "BAD", supplier_code: "NOPE", item_code: "RM-PP", qty: 5 },
      { po_ref: "BAD", supplier_code: "SUP-OFF", item_code: "RM-PP", qty: 5 },
      { po_ref: "BAD", supplier_code: "SUP-A", item_code: "GHOST", qty: 5 },
      { po_ref: "BAD", supplier_code: "SUP-A", item_code: "FG-1", qty: 5 },
      { po_ref: "BAD", supplier_code: "SUP-A", item_code: "MB-1", qty: 0 },
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(ImportRejected);
    const rows = (err as ImportRejected).errors;
    expect(rows.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(rows.map((e) => e.message).join(" | ")).toMatch(/isn't in the supplier list[\s\S]*inactive[\s\S]*isn't in the item master[\s\S]*finished good[\s\S]*quantity/);
    expect(err.message).toMatch(/^Nothing was imported\. 5 problems/);
    expect(await db.purchaseOrder.count()).toBe(0); // the good first row was not kept either
  });

  it("makes one PO per supplier for rows without a reference", async () => {
    const r = await load([{ supplier_code: "SUP-A", item_code: "RM-PP", qty: 1 }, { supplier_code: "SUP-A", item_code: "MB-1", qty: 2 }]);
    expect(r.created).toEqual([expect.objectContaining({ ref: null, lines: 2 })]);
    expect((await db.purchaseOrder.findFirstOrThrow()).externalRef).toBeNull();
  });
});

describe("createPurchaseOrder with a reference", () => {
  it("refuses a second PO with the same reference for a supplier, and a repeated item", async () => {
    const item = await db.item.findFirstOrThrow({ where: { code: "RM-PP" } });
    const mk = (extra: object = {}, lines = [{ itemId: item.id, qty: 5 }]) => createPurchaseOrder({ supplierId: sup, segment: "NON_AUTOMOTIVE", lines, ...extra }, db);
    await mk({ externalRef: " REF-7 " });
    expect((await db.purchaseOrder.findFirstOrThrow()).externalRef).toBe("REF-7");
    await expect(mk({ externalRef: "REF-7" })).rejects.toThrow(/already has a PO with reference REF-7/);
    await expect(mk({}, [{ itemId: item.id, qty: 1 }, { itemId: item.id, qty: 2 }])).rejects.toThrow(/once on a PO/);
    await expect(mk({}, [{ itemId: "ghost", qty: 1 }])).rejects.toThrow(/doesn't exist/);
    await mk(); await mk(); // no reference: any number
    expect(await db.purchaseOrder.count()).toBe(3);
  });
});
