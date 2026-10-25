import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { completeDispatch, createDispatch, scanBox } from "./dispatch";
import { packBoxes } from "./fg";
import { bookProduction, saveBom } from "./production";
import { traceQuery, type FgTrace, type MaterialTrace } from "./trace";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "ReturnableLedger", "FgBox", "DispatchLine", "Dispatch", "ProductionLotUse", "BookingConsumption", "ProductionBooking",
    "BomLine", "Bom", "QcInspection", "StockTransaction", "StockBalance", "Lot", "GrnLine", "Grn", "GateEntry",
    "PurchaseOrderLine", "PurchaseOrder", "Mould", "Machine", "Location", "Warehouse", "Customer", "Supplier", "Item",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const mk = async (code: string, category: string, extra: Record<string, unknown> = {}) =>
    (await db.item.create({ data: { code, name: code, category: category as never, ...extra } })).id;
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const bin = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "01", bin: "01", type: "STORAGE", warehouseId: wh.id } });
  const machine = await db.machine.create({ data: { code: "IMM-1", name: "90T" } });
  const mould = await db.mould.create({ data: { code: "MLD-1", name: "Clip", cavities: 4, runnerWeightG: 8 } });
  ids = {
    bin: bin.id, machine: machine.id,
    fg: await mk("FG-CLIP", "FG", { uom: "NOS" }),
    pp: await mk("RM-PP", "RM_RESIN", { polymerGrade: "PP" }),
    mb: await mk("MB-BLK", "RM_MASTERBATCH"),
    rg: await mk("RG-PP", "REGRIND", { polymerGrade: "PP" }),
    apex: (await db.customer.create({ data: { code: "APEX", name: "Apex Motors", segment: "AUTOMOTIVE", labelFormat: "OEM" } })).id,
    bright: (await db.customer.create({ data: { code: "BRIGHT", name: "Bright Home", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC" } })).id,
  };
  const sup = await db.supplier.create({ data: { code: "SUP", name: "PolyChem" } });
  ids.sup = sup.id;
  await saveBom({
    fgItemId: ids.fg, mouldId: mould.id, partWeightG: 10,
    lines: [{ itemId: ids.pp, kind: "RESIN", pct: 70 }, { itemId: ids.mb, kind: "MASTERBATCH", pct: 5 }, { itemId: ids.rg, kind: "REGRIND", pct: 25 }],
  }, db);
});

// A received, QC-approved raw material lot with a real GRN → PO → supplier chain.
async function receivedLot(itemId: string, heat: string, qty = 1000) {
  const po = await db.purchaseOrder.create({ data: { poNumber: `PO-${heat}`, supplierId: ids.sup, segment: "AUTOMOTIVE", status: "CLOSED" } });
  const poLine = await db.purchaseOrderLine.create({ data: { poId: po.id, itemId, qty, receivedQty: qty, price: 10 } });
  const gate = await db.gateEntry.create({ data: { entryNumber: `GE-${heat}`, poId: po.id, vehicleNumber: "MH12AB1", invoiceNumber: `INV-${heat}` } });
  const grn = await db.grn.create({ data: { grnNumber: `GRN-${heat}`, poId: po.id, gateEntryId: gate.id, coaUrl: `coa-${heat}.pdf` } });
  const gl = await db.grnLine.create({ data: { grnId: grn.id, poLineId: poLine.id } });
  const lot = await db.lot.create({ data: { lotNumber: `LOT-${heat}`, itemId, grnLineId: gl.id, supplierLotNo: heat, receivedQty: qty, qcStatus: "APPROVED" } });
  await db.qcInspection.create({ data: { lotId: lot.id, decision: "APPROVED", mfi: 12.5, moisturePct: 0.02 } });
  return lot;
}

async function produce(lots: { lotNumber: string; qty: number }[], opts: { shots?: number; good?: number } = {}) {
  const bom = await db.bom.findFirstOrThrow();
  return bookProduction({
    bomId: bom.id, machineId: ids.machine, shift: "B", shots: opts.shots ?? 1000, goodParts: opts.good ?? 3800, rejectParts: 100, materialLots: lots,
  }, db);
}

describe("recording material lots on a booking", () => {
  it("stores which lots fed the run", async () => {
    const pp = await receivedLot(ids.pp, "HEAT-PP-1");
    const mb = await receivedLot(ids.mb, "HEAT-MB-1");
    const r = await produce([{ lotNumber: pp.lotNumber, qty: 30 }, { lotNumber: mb.lotNumber, qty: 2 }]);
    expect(await db.productionLotUse.count({ where: { bookingId: r.booking.id } })).toBe(2);
  });

  it("rejects unknown lots, unapproved lots, lots outside the BOM and missing quantities", async () => {
    const pp = await receivedLot(ids.pp, "HEAT-PP-1");
    await expect(produce([{ lotNumber: "LOT-NOPE", qty: 1 }])).rejects.toThrow(/Unknown material lot/);
    await expect(produce([{ lotNumber: pp.lotNumber, qty: 0 }])).rejects.toThrow(/quantity used/);
    await db.lot.update({ where: { id: pp.id }, data: { qcStatus: "PENDING_QC" } });
    await expect(produce([{ lotNumber: pp.lotNumber, qty: 5 }])).rejects.toThrow(/PENDING_QC/);
    const other = await db.item.create({ data: { code: "RM-OTHER", name: "x", category: "RM_RESIN" } });
    const lot = await db.lot.create({ data: { lotNumber: "L-O", itemId: other.id, supplierLotNo: "S", receivedQty: 5, qcStatus: "APPROVED" } });
    await expect(produce([{ lotNumber: lot.lotNumber, qty: 5 }])).rejects.toThrow(/not part of this part's BOM/);
    expect(await db.productionBooking.count()).toBe(0);
  });

  it("when required, insists every resin and masterbatch is covered", async () => {
    const pp = await receivedLot(ids.pp, "HEAT-PP-1");
    const bom = await db.bom.findFirstOrThrow();
    const base = { bomId: bom.id, machineId: ids.machine, shift: "A" as const, shots: 100, goodParts: 300, rejectParts: 0, requireMaterialLots: true };
    await expect(bookProduction({ ...base }, db)).rejects.toThrow(/Scan the lot of RM-PP/);
    await expect(bookProduction({ ...base, materialLots: [{ lotNumber: pp.lotNumber, qty: 3 }] }, db)).rejects.toThrow(/Scan the lot of MB-BLK/);
    const mb = await receivedLot(ids.mb, "HEAT-MB-1");
    await expect(bookProduction({ ...base, materialLots: [{ lotNumber: pp.lotNumber, qty: 3 }, { lotNumber: mb.lotNumber, qty: 1 }] }, db)).resolves.toBeTruthy();
  });
});

describe("traceQuery: box back to supplier", () => {
  async function shipped() {
    const pp = await receivedLot(ids.pp, "HEAT-PP-1");
    const mb = await receivedLot(ids.mb, "HEAT-MB-1");
    const r = await produce([{ lotNumber: pp.lotNumber, qty: 30 }, { lotNumber: mb.lotNumber, qty: 2 }]);
    const fgLot = await db.lot.findUniqueOrThrow({ where: { id: r.fgLotId! } });
    const [b1, b2] = await packBoxes({ lotNumber: fgLot.lotNumber, binCode: "A-01-01", customerId: ids.apex, qtyPerBox: 500, boxCount: 2 }, db);
    const [b3] = await packBoxes({ lotNumber: fgLot.lotNumber, binCode: "A-01-01", customerId: ids.bright, qtyPerBox: 300, boxCount: 1 }, db);
    const fgItem = ids.fg;
    const d = await createDispatch({ customerId: ids.apex, vehicleNumber: "MH12", lines: [{ itemId: fgItem, qty: 1000 }] }, db);
    await scanBox({ dispatchId: d.id, scan: b1.boxCode }, db);
    await scanBox({ dispatchId: d.id, scan: b2.boxCode }, db);
    await completeDispatch({ dispatchId: d.id }, db);
    return { pp, mb, r, fgLot, b1, b3, d };
  }

  it("answers: which machine, shift, mould, resin heat lot, supplier invoice and QC for this box?", async () => {
    const { b1, r } = await shipped();
    const t = (await traceQuery(b1.boxCode.toLowerCase(), db)) as FgTrace;
    expect(t.kind).toBe("FG");
    expect(t.box).toMatchObject({ boxCode: b1.boxCode, customer: "Apex Motors", status: "DISPATCHED" });
    expect(t.booking).toMatchObject({ number: r.booking.bookingNumber, shift: "B", machine: "IMM-1", mould: "MLD-1", good: 3800 });
    const pp = t.materials.find((m) => m.itemCode === "RM-PP")!;
    expect(pp).toMatchObject({ supplierLotNo: "HEAT-PP-1", qtyUsed: 30 });
    expect(pp.po).toEqual({ number: "PO-HEAT-PP-1", supplier: "PolyChem" });
    expect(pp.grn).toMatchObject({ number: "GRN-HEAT-PP-1", invoice: "INV-HEAT-PP-1", coa: "coa-HEAT-PP-1.pdf" });
    expect(pp.qc).toMatchObject({ decision: "APPROVED", mfi: 12.5 });
    expect(t.dispatches).toHaveLength(1);
    expect(t.dispatches[0]).toMatchObject({ customer: "Apex Motors", boxes: 1 }); // only this box's shipment, not the whole lot
    expect(t.warnings).toEqual([]);
  });

  it("recall: from a supplier heat number, finds every customer who got parts made from it", async () => {
    await shipped();
    const t = (await traceQuery("heat-pp-1", db)) as MaterialTrace;
    expect(t.kind).toBe("MATERIAL");
    expect(t.lots[0]).toMatchObject({ supplierLotNo: "HEAT-PP-1", supplier: "PolyChem", grn: "GRN-HEAT-PP-1" });
    expect(t.bookings).toHaveLength(1);
    expect(t.boxes).toHaveLength(3);
    const apex = t.customers.find((c) => c.name === "Apex Motors")!;
    const bright = t.customers.find((c) => c.name === "Bright Home")!;
    expect(apex).toMatchObject({ boxes: 2, qty: 1000, shipped: 1000 });
    expect(bright).toMatchObject({ boxes: 1, qty: 300, shipped: 0 }); // boxed but still in our stock
  });

  it("also resolves an internal lot number and a finished-goods lot or booking number", async () => {
    const { pp, fgLot, r } = await shipped();
    expect(((await traceQuery(pp.lotNumber, db)) as MaterialTrace).kind).toBe("MATERIAL");
    expect(((await traceQuery(fgLot.lotNumber, db)) as FgTrace).fgLot.lotNumber).toBe(fgLot.lotNumber);
    expect(((await traceQuery(r.booking.bookingNumber, db)) as FgTrace).kind).toBe("FG"); // not the regrind lot sharing that reference
  });

  it("says plainly when nothing matches", async () => {
    expect((await traceQuery("BX-NOPE", db)).kind).toBe("NONE");
    expect((await traceQuery("   ", db)).kind).toBe("NONE");
  });
});

describe("traceability gaps are warned about, not hidden", () => {
  it("warns when a run didn't record its material lots", async () => {
    const r = await produce([]);
    const fgLot = await db.lot.findUniqueOrThrow({ where: { id: r.fgLotId! } });
    const t = (await traceQuery(fgLot.lotNumber, db)) as FgTrace;
    expect(t.materials).toEqual([]);
    expect(t.warnings[0]).toMatch(/no material lots recorded/);
  });

  it("warns when a lot has no production use yet", async () => {
    const pp = await receivedLot(ids.pp, "HEAT-IDLE");
    const t = (await traceQuery("HEAT-IDLE", db)) as MaterialTrace;
    expect(t.bookings).toEqual([]);
    expect(t.warnings[0]).toMatch(/No production run has recorded using this material/);
    expect(t.lots[0].lotNumber).toBe(pp.lotNumber);
  });
});

describe("regrind chains back to the run that made it", () => {
  it("follows regrind to the original resin lot, and forward from that resin through the regrind", async () => {
    const pp = await receivedLot(ids.pp, "HEAT-PP-1");
    const mb = await receivedLot(ids.mb, "HEAT-MB-1");
    const first = await produce([{ lotNumber: pp.lotNumber, qty: 30 }, { lotNumber: mb.lotNumber, qty: 2 }]);
    const regrind = await db.lot.findUniqueOrThrow({ where: { id: first.regrindLotId! } });

    // second run uses the regrind from the first plus a fresh resin lot
    const pp2 = await receivedLot(ids.pp, "HEAT-PP-2");
    const second = await produce([{ lotNumber: pp2.lotNumber, qty: 20 }, { lotNumber: mb.lotNumber, qty: 2 }, { lotNumber: regrind.lotNumber, qty: 8 }]);
    const fg2 = await db.lot.findUniqueOrThrow({ where: { id: second.fgLotId! } });

    const back = (await traceQuery(fg2.lotNumber, db)) as FgTrace;
    const rg = back.materials.find((m) => m.itemCode === "RG-PP")!;
    expect(rg.regrindFrom?.bookingNumber).toBe(first.booking.bookingNumber);
    expect(rg.regrindFrom?.materials.map((m) => m.supplierLotNo).sort()).toEqual(["HEAT-MB-1", "HEAT-PP-1"]);

    // recall HEAT-PP-1: it reached run 1 directly and run 2 through regrind
    const fwd = (await traceQuery("HEAT-PP-1", db)) as MaterialTrace;
    expect(fwd.bookings.map((b) => b.number).sort()).toEqual([first.booking.bookingNumber, second.booking.bookingNumber].sort());
  });
});
