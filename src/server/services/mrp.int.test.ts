import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomerOrder, importDemand, removeOrderLine, undoImport } from "./demand";
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
    "StockBalance", "Lot", "PlanSlot", "Mould", "Machine", "Location", "Warehouse", "Customer", "Supplier", "Item",
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

describe("entering a customer order by hand", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const order = (over: Record<string, unknown> = {}) => createCustomerOrder({
    customerId: ids.ind, type: "FIRM", ref: "CPO-7731", lines: [{ fgItemId: ids.fg, qty: 4000, dueDate: d("2026-11-05") }, { fgItemId: ids.fg, qty: 2000, dueDate: d("2026-11-20") }], ...over,
  } as never, db);

  it("adds each line as ordinary demand with the customer's PO number, and the plan counts it", async () => {
    expect(await order()).toEqual({ lines: 2, ref: "CPO-7731" });
    const lines = await db.demandLine.findMany({ orderBy: { dueDate: "asc" } });
    expect(lines.map((l) => [l.type, l.qty, l.customerRef, l.importId])).toEqual([["FIRM", 4000, "CPO-7731", null], ["FIRM", 2000, "CPO-7731", null]]);
    const fg = (await planMrp(opts, db)).rows.find((r) => r.code === "FG-CLIP")!;
    expect(fg.gross).toBe(6000);
    expect(fg.demandLines).toHaveLength(2);
  });

  it("refuses a bad order, naming the field, and adds nothing", async () => {
    const fails = async (over: Record<string, unknown>, msg: RegExp, field?: string) => {
      const e = await order(over).catch((x) => x);
      expect(e.message).toMatch(msg);
      if (field) expect(e.fields).toContain(field);
    };
    await fails({ lines: [] }, /at least one line/);
    await fails({ type: "FORECAST" }, /firm or spot/, "type");
    await fails({ customerId: "nope" }, /active customer/, "customerId");
    await fails({ lines: [{ fgItemId: ids.pp, qty: 5, dueDate: d("2026-11-05") }] }, /isn't a finished part/, "itemId");
    await fails({ lines: [{ fgItemId: ids.fg, qty: 0, dueDate: d("2026-11-05") }] }, /whole number above 0/, "qty");
    await fails({ lines: [{ fgItemId: ids.fg, qty: 1.5, dueDate: d("2026-11-05") }] }, /whole number/, "qty");
    await fails({ lines: [{ fgItemId: ids.fg, qty: 5, dueDate: new Date("nope") }] }, /due date/, "date");
    await fails({ lines: [{ fgItemId: ids.fg, qty: 5, dueDate: d("2026-11-05") }, { fgItemId: ids.fg, qty: 6, dueDate: d("2026-11-05") }] }, /listed twice/);
    await db.customer.update({ where: { id: ids.ind }, data: { active: false } });
    await fails({}, /active customer/, "customerId");
    expect(await db.demandLine.count()).toBe(0);
  });

  it("enters a customer's PO number only once, but lets two customers use the same number", async () => {
    await order();
    const again = await order().catch((e) => e);
    expect(again.message).toMatch(/already has an order with PO number CPO-7731 \(2 lines\)/);
    expect(again.fields).toEqual(["customerRef"]);
    await order({ customerId: ids.auto }); // another customer, same number: fine
    await order({ ref: "" }); // no number: no clash
    await order({ ref: undefined });
    expect(await db.demandLine.count()).toBe(2 + 2 + 2 + 2);
  });

  it("takes a po_ref column from a file too, and removes a line nothing has shipped against", async () => {
    await doImport([demand({ po_ref: "FILE-1" })]);
    expect((await db.demandLine.findFirstOrThrow()).customerRef).toBe("FILE-1");
    const [a, b] = [await db.demandLine.findFirstOrThrow(), await db.demandLine.create({ data: { customerId: ids.ind, fgItemId: ids.fg, qty: 10, dueDate: d("2026-12-01"), type: "SPOT", shippedQty: 4 } })];
    await removeOrderLine(a.id, db);
    expect(await db.demandLine.count()).toBe(1);
    await expect(removeOrderLine(b.id, db)).rejects.toThrow(/already shipped 4/);
    await expect(removeOrderLine("nope", db)).rejects.toThrow(/doesn't exist/);
  });
});

describe("planMrp: what is behind each row", () => {
  it("lists the customer demand behind a part and the parts behind a material, and gives each preset horizon its own need", async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-10-25" }), demand({ qty: 3000, due_date: "2026-12-10" })]);
    const { rows } = await planMrp({ horizonDays: 90, scrapPct: 0, today: TODAY }, db);
    const by = (code: string) => rows.find((r) => r.code === code)!;

    const fg = by("FG-CLIP");
    expect(fg.demandLines.map((d) => [d.customer, d.type, d.qty])).toEqual([["Ind Co", "FIRM", 5000], ["Ind Co", "FIRM", 3000]]);
    // 5000 is due inside the first week, 3000 only inside the quarter
    expect([fg.needBy[7], fg.needBy[30], fg.needBy[90]]).toEqual([5000, 5000, 8000]);

    const ins = by("INS");
    expect(ins.partDrivers).toHaveLength(1);
    expect(ins.partDrivers[0]).toMatchObject({ code: "FG-CLIP", customers: ["Ind Co"] });
    expect(ins.partDrivers[0].qty).toBe(ins.gross);
    expect(ins.demandLines).toEqual([]);
  });

  it("plans only what is still to ship: a completed order drops out and a part-shipped one counts what is left", async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-10-25" }), demand({ qty: 3000, due_date: "2026-10-26" }), demand({ qty: 2000, due_date: "2026-10-27" })]);
    const lines = await db.demandLine.findMany({ orderBy: { qty: "desc" } });
    await db.demandLine.update({ where: { id: lines[0].id }, data: { shippedQty: 5000 } }); // completed
    await db.demandLine.update({ where: { id: lines[1].id }, data: { shippedQty: 1000 } }); // 2000 left
    const { rows, demandLines, demandSpread } = await planMrp(opts, db);
    const fg = rows.find((r) => r.code === "FG-CLIP")!;
    expect(fg.gross).toBe(4000); // 2000 + 2000
    expect(demandLines).toBe(2);
    expect(fg.demandLines.map((d) => d.qty)).toEqual([2000, 2000]);
    expect(demandSpread.find((b) => b.key === "week")).toMatchObject({ lines: 2, parts: 4000 });
  });

  it("shows how demand is spread over time, with overdue lines in every horizon", async () => {
    await doImport([
      demand({ qty: 100, due_date: "2026-10-10" }),  // overdue on 20 Oct
      demand({ qty: 5000, due_date: "2026-10-25" }), // within a week
      demand({ qty: 2000, due_date: "2026-11-10" }), // within a month
      demand({ qty: 3000, due_date: "2026-12-10" }), // within a quarter
      demand({ qty: 700, due_date: "2027-03-01" }),  // beyond
    ]);
    const { rows, demandSpread } = await planMrp({ horizonDays: 30, scrapPct: 0, today: TODAY }, db);
    expect(demandSpread.map((b) => [b.key, b.lines, b.parts])).toEqual([
      ["overdue", 1, 100], ["week", 1, 5000], ["month", 1, 2000], ["quarter", 1, 3000], ["later", 1, 700],
    ]);
    const fg = rows.find((r) => r.code === "FG-CLIP")!;
    expect([fg.needBy[7], fg.needBy[30], fg.needBy[90]]).toEqual([5100, 7100, 10100]); // the overdue 100 counts in all three
    expect(fg.gross).toBe(7100);
  });

  it("counts what the machine plan will make as already coming, so a planned part is not asked for again", async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-10-25" })]);
    const before = (await planMrp(opts, db)).rows.find((r) => r.code === "FG-CLIP")!;
    expect(before).toMatchObject({ inProduction: 0, suggested: 15000 });

    const machine = await db.machine.create({ data: { code: "M1", name: "Press 1" } });
    await db.mould.update({ where: { id: ids.mouldId }, data: { idealCycleSec: 20 } });
    await db.planSlot.create({ data: { machineId: machine.id, day: new Date("2026-10-22"), kind: "JOB", mouldId: ids.mouldId, fgItemId: ids.fg } });
    const after = (await planMrp(opts, db)).rows.find((r) => r.code === "FG-CLIP")!;
    expect(after.plannedDays).toBe(1);
    expect(after.inProduction).toBeGreaterThan(5000); // one machine-day on a 4-cavity mould at a 20 s cycle
    expect(after.suggested).toBeLessThan(before.suggested);
    expect(after.incoming).toBe(after.inProduction);
  });

  it("lists the open POs for a material and the stock waiting for QC", async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-10-25" })]);
    const po = await db.purchaseOrder.create({ data: { poNumber: "PO-T-1", supplierId: ids.cheap, segment: "NON_AUTOMOTIVE", status: "APPROVED" } });
    await db.purchaseOrderLine.create({ data: { poId: po.id, itemId: ids.pp, qty: 400, receivedQty: 100, price: 100 } });
    const pp = (await planMrp(opts, db)).rows.find((r) => r.code === "RM-PP")!;
    expect(pp.openPos).toMatchObject([{ poNumber: "PO-T-1", supplier: "Cheap Poly", qty: 300 }]);
    expect(pp.onOrder).toBe(300);
  });
});

describe("createPosFromPlan: choosing the supplier and clubbing items", () => {
  const sel = (itemId: string, extra: Record<string, unknown> = {}) => ({ itemId, ...extra });
  // An order we raise counts as on order, so the item stops needing one; clear them between steps of a test.
  const clear = () => db.$executeRawUnsafe(`TRUNCATE TABLE "PurchaseOrderLine", "PurchaseOrder" RESTART IDENTITY CASCADE`);
  beforeEach(async () => {
    await doImport([demand({ qty: 5000, due_date: "2026-10-25" })]);
    await db.priceMaster.create({ data: { itemId: ids.ins, supplierId: ids.cheap, price: 3.5 } }); // Cheap Poly also supplies the inserts
  });

  it("offers every priced supplier, cheapest first, and the cheapest is the default", async () => {
    const pp = (await planMrp(opts, db)).rows.find((r) => r.code === "RM-PP")!;
    expect(pp.options.map((o) => [o.name, o.price, o.leadTimeDays])).toEqual([["Cheap Poly", 100, 14], ["Dear Poly", 120, 3]]);
    expect(pp.supplier?.name).toBe("Cheap Poly");
  });

  it("orders from the supplier the buyer picked, at that supplier's price, and refuses one with no price on file", async () => {
    await expect(createPosFromPlan({ selections: [sel(ids.pp, { supplierId: ids.ins1 })], opts }, db)).rejects.toThrow(/no price on file for RM-PP/);
    const [po] = await createPosFromPlan({ selections: [sel(ids.pp, { supplierId: ids.dear })], opts }, db);
    expect(po.supplierId).toBe(ids.dear);
    expect(Number(po.lines[0].price)).toBe(120);
  });

  it("clubs items for the same supplier on one PO, or raises one each when clubbing is off", async () => {
    const both = [sel(ids.pp, { supplierId: ids.cheap }), sel(ids.ins, { supplierId: ids.cheap })];
    const clubbed = await createPosFromPlan({ selections: both, opts }, db);
    expect(clubbed).toHaveLength(1);
    expect(clubbed[0].lines.map((l) => l.itemId).sort()).toEqual([ids.pp, ids.ins].sort());
    await clear();
    const apart = await createPosFromPlan({ selections: both, opts, club: false }, db);
    expect(apart).toHaveLength(2);
    await clear();
    // different suppliers never share a PO
    expect(await createPosFromPlan({ selections: [sel(ids.pp, { supplierId: ids.cheap }), sel(ids.ins, { supplierId: ids.ins1 })], opts }, db)).toHaveLength(2);
  });

  it("flags a PO as expedite, with the note, and takes a chosen expected date", async () => {
    const date = new Date("2026-10-30");
    const [po] = await createPosFromPlan({ selections: [sel(ids.pp, { supplierId: ids.cheap, expectedDate: date })], opts, expedite: true, expediteNote: "Line stops on 30 Oct" }, db);
    expect(po).toMatchObject({ expedite: true, expediteNote: "Line stops on 30 Oct" });
    expect(po.lines[0].expectedDate?.toISOString().slice(0, 10)).toBe("2026-10-30");
    await clear();
    const [plain] = await createPosFromPlan({ selections: [sel(ids.ins)], opts }, db);
    expect(plain).toMatchObject({ expedite: false, expediteNote: null });
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
