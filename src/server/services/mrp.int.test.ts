import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importDemand, undoImport } from "./demand";
import { parseDemandRows } from "./demand-import";
import { createPosFromPlan, planMrp } from "./mrp";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;
const TODAY = new Date("2026-10-20T08:00:00Z");
const opts = { horizonDays: 90, scrapPct: 0, today: TODAY };

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "DemandLine", "DemandImport", "PurchaseOrderLine", "PurchaseOrder", "PriceMaster", "BomLine", "Bom", "StockTransaction",
    "StockBalance", "Lot", "Mould", "Location", "Warehouse", "Customer", "Supplier", "Item",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const mk = async (code: string, category: string, extra: Record<string, unknown> = {}) =>
    (await db.item.create({ data: { code, name: code, category: category as never, ...extra } })).id;
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const bin = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "01", bin: "01", type: "STORAGE", warehouseId: wh.id } });
  const mould = await db.mould.create({ data: { code: "MLD", name: "Clip", cavities: 4, runnerWeightG: 8 } });
  ids = {
    bin: bin.id,
    fg: await mk("FG-CLIP", "FG", { uom: "NOS", minStock: 1000, reorderPoint: 2000, maxStock: 10000 }),
    pp: await mk("RM-PP", "RM_RESIN", { polymerGrade: "PP", minStock: 100, reorderPoint: 200, maxStock: 2000 }),
    ins: await mk("INS", "BOP", { uom: "NOS", reorderPoint: 5000, maxStock: 50000 }),
    auto: (await db.customer.create({ data: { code: "AUTO", name: "Auto Co", segment: "AUTOMOTIVE", labelFormat: "OEM" } })).id,
    ind: (await db.customer.create({ data: { code: "IND", name: "Ind Co", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC" } })).id,
    cheap: (await db.supplier.create({ data: { code: "CHEAP", name: "Cheap Poly", leadTimeDays: 14 } })).id,
    dear: (await db.supplier.create({ data: { code: "DEAR", name: "Dear Poly", leadTimeDays: 3 } })).id,
    ins1: (await db.supplier.create({ data: { code: "INSCO", name: "Inserts Ltd", leadTimeDays: 10 } })).id,
    mouldId: mould.id,
  };
  await db.priceMaster.createMany({
    data: [
      { itemId: ids.pp, supplierId: ids.cheap, price: 100 },
      { itemId: ids.pp, supplierId: ids.dear, price: 120 },
      { itemId: ids.ins, supplierId: ids.ins1, price: 3 },
    ],
  });
  await db.bom.create({
    data: {
      fgItemId: ids.fg, mouldId: ids.mouldId, partWeightG: 10,
      lines: { create: [{ itemId: ids.pp, kind: "RESIN", pct: 100 }, { itemId: ids.ins, kind: "BOP", qtyPerPart: 2 }] },
    },
  });
});

const csvRows = (rows: object[]) => parseDemandRows(rows as Record<string, unknown>[]);
const demand = (over: Record<string, unknown> = {}) => ({ customer_code: "IND", part_code: "FG-CLIP", due_date: "2026-11-10", qty: 5000, type: "FIRM", ...over });
const doImport = (rows: object[], replaceForecast = false) => {
  const p = csvRows(rows);
  return importDemand({ fileName: "t.csv", rows: p.ok, rowErrors: p.errors, replaceForecast }, db);
};

describe("importDemand", () => {
  it("loads valid rows and records the upload", async () => {
    const r = await doImport([demand(), demand({ due_date: "2026-11-20", qty: 1000, type: "FORECAST" })]);
    expect(r.imported).toBe(2);
    expect(await db.demandLine.count()).toBe(2);
    expect((await db.demandImport.findUniqueOrThrow({ where: { id: r.importId } })).rowCount).toBe(2);
  });

  it("is all-or-nothing: one unknown part rejects the file and loads nothing", async () => {
    await expect(doImport([demand(), demand({ part_code: "NOPE" })])).rejects.toThrow(/unknown part NOPE/);
    expect(await db.demandLine.count()).toBe(0);
  });

  it("rejects unknown/inactive customers, non-FG parts and rows that failed parsing", async () => {
    await expect(doImport([demand({ customer_code: "GHOST" })])).rejects.toThrow(/unknown customer GHOST/);
    await expect(doImport([demand({ part_code: "RM-PP" })])).rejects.toThrow(/not a finished-goods/);
    await db.customer.update({ where: { id: ids.ind }, data: { active: false } });
    await expect(doImport([demand()])).rejects.toThrow(/inactive/);
    await expect(doImport([demand({ qty: 0 })])).rejects.toThrow(/row 2/);
    await expect(doImport([])).rejects.toThrow(/no demand rows/);
  });

  it("replaceForecast supersedes old forecast for that customer+part but keeps firm and spot", async () => {
    await doImport([demand({ type: "FORECAST", qty: 100 }), demand({ type: "FIRM", qty: 200 }), demand({ type: "SPOT", qty: 300 })]);
    const r = await doImport([demand({ type: "FORECAST", qty: 999 })], true);
    expect(r.replaced).toBe(1);
    const lines = await db.demandLine.findMany({ orderBy: { qty: "asc" } });
    expect(lines.map((l) => [l.type, l.qty])).toEqual([["FIRM", 200], ["SPOT", 300], ["FORECAST", 999]]);
  });

  it("without replaceForecast, forecasts are added alongside", async () => {
    await doImport([demand({ type: "FORECAST" })]);
    await doImport([demand({ type: "FORECAST" })]);
    expect(await db.demandLine.count()).toBe(2);
  });

  it("undoes an upload", async () => {
    const r = await doImport([demand(), demand({ qty: 10 })]);
    expect(await undoImport(r.importId, db)).toBe(2);
    expect(await db.demandLine.count()).toBe(0);
    await expect(undoImport(r.importId, db)).rejects.toThrow(/Unknown import/);
  });
});

describe("planMrp", () => {
  it("plans FG, resin and inserts from demand, stock and BOM", async () => {
    await doImport([demand({ qty: 5000 })]);
    const { rows } = await planMrp(opts, db);
    const by = (code: string) => rows.find((r) => r.code === code)!;
    expect(by("FG-CLIP")).toMatchObject({ gross: 5000, projected: -5000, suggested: 15000, policy: "ROP" });
    expect(by("RM-PP").buyable).toBe(true);
    expect(by("RM-PP").gross).toBeGreaterThan(0);
    expect(by("INS").gross).toBe(30000); // 15000 parts × 2
    expect(by("FG-CLIP").buyable).toBe(false); // finished goods are made, not bought
  });

  it("picks the cheapest supplier, and dates the order back from the need by lead time", async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-11-10" })]);
    const pp = (await planMrp(opts, db)).rows.find((r) => r.code === "RM-PP")!;
    expect(pp.supplier).toMatchObject({ name: "Cheap Poly", price: 100, leadTimeDays: 14 });
    expect(pp.orderBy!.toISOString().slice(0, 10)).toBe("2026-10-27"); // 10 Nov − 14 days
    expect(pp.late).toBe(false);
  });

  it("flags an order as late when the lead time can no longer be met", async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-10-25" })]);
    expect((await planMrp(opts, db)).rows.find((r) => r.code === "RM-PP")!.late).toBe(true);
  });

  it("counts usable stock and open purchase orders as supply", async () => {
    await doImport([demand({ qty: 5000 })]);
    const lot = await db.lot.create({ data: { lotNumber: "L1", itemId: ids.fg, supplierLotNo: "S", receivedQty: 50000, qcStatus: "APPROVED" } });
    await db.stockBalance.create({ data: { lotId: lot.id, locationId: ids.bin, qty: 50000 } });
    const covered = (await planMrp(opts, db)).rows.find((r) => r.code === "FG-CLIP")!;
    expect(covered.suggested).toBe(0);

    // pending-QC stock is not usable yet
    await db.lot.update({ where: { id: lot.id }, data: { qcStatus: "PENDING_QC" } });
    expect((await planMrp(opts, db)).rows.find((r) => r.code === "FG-CLIP")!.suggested).toBeGreaterThan(0);
  });

  it("uses KANBAN for automotive demand", async () => {
    await doImport([demand({ customer_code: "AUTO", qty: 300 })]);
    const fg = (await planMrp(opts, db)).rows.find((r) => r.code === "FG-CLIP")!;
    expect(fg.policy).toBe("KANBAN");
    expect(fg.suggested).toBe(2300); // 0 on hand − 300 = −300 → refill to ROP 2000
  });

  it("proposes plain reorders for stocked materials even with no demand", async () => {
    const { rows } = await planMrp(opts, db);
    expect(rows.find((r) => r.code === "RM-PP")).toMatchObject({ role: "STOCK", suggested: 2000 }); // 0 on hand → up to max 2000
  });
});

describe("createPosFromPlan", () => {
  it("creates approved POs per supplier from the server-computed plan", async () => {
    await doImport([demand({ qty: 5000 })]);
    const pos = await createPosFromPlan({
      selections: [{ itemId: ids.pp }, { itemId: ids.ins }], opts, userId: "u1",
    }, db);
    expect(pos).toHaveLength(2); // different suppliers
    const ppPo = await db.purchaseOrder.findFirstOrThrow({ where: { supplierId: ids.cheap }, include: { lines: true } });
    expect(ppPo.status).toBe("APPROVED");
    expect(Number(ppPo.lines[0].price)).toBe(100); // from the price master, not the client
    expect(ppPo.lines[0].expectedDate).not.toBeNull();
  });

  it("marks material for automotive demand as an AUTOMOTIVE PO, so COA is required at GRN", async () => {
    await doImport([demand({ customer_code: "AUTO", qty: 5000 })]);
    await createPosFromPlan({ selections: [{ itemId: ids.pp }], opts }, db);
    expect((await db.purchaseOrder.findFirstOrThrow()).segment).toBe("AUTOMOTIVE");
  });

  it("lets the planner override the quantity but never zero", async () => {
    await doImport([demand({ qty: 5000 })]);
    const [po] = await createPosFromPlan({ selections: [{ itemId: ids.pp, qty: 3000 }], opts }, db);
    expect(Number(po.lines[0].qty)).toBe(3000);
    await expect(createPosFromPlan({ selections: [{ itemId: ids.ins, qty: 0 }], opts }, db)).rejects.toThrow(/above 0/);
  });

  it("refuses finished goods, stale selections and items with no supplier price", async () => {
    await doImport([demand({ qty: 5000 })]);
    await expect(createPosFromPlan({ selections: [{ itemId: ids.fg }], opts }, db)).rejects.toThrow(/no longer needs ordering/);
    await expect(createPosFromPlan({ selections: [], opts }, db)).rejects.toThrow(/at least one/);
    await db.priceMaster.deleteMany({ where: { itemId: ids.ins } });
    await expect(createPosFromPlan({ selections: [{ itemId: ids.ins }], opts }, db)).rejects.toThrow(/no supplier price/);
    expect(await db.purchaseOrder.count()).toBe(0);
  });
});
