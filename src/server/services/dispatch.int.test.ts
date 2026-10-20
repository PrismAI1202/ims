import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cancelDispatch, completeDispatch, createDispatch, dispatchProgress, recordReturnable, returnableBalances, scanBox, unscanBox } from "./dispatch";
import { boxLabel, packBoxes, unboxedQty } from "./fg";
import { transferStock } from "./inventory";
import { bookProduction, saveBom } from "./production";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;
let lotNumber: string;
let fgLotId: string;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "ReturnableLedger", "FgBox", "DispatchLine", "Dispatch", "BookingConsumption", "ProductionBooking", "BomLine", "Bom",
    "IssueLine", "MaterialRequestLine", "MaterialRequest", "StockTransaction", "StockBalance", "QcInspection", "Lot",
    "Mould", "Machine", "Location", "Warehouse", "Customer", "Item",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const mk = async (code: string, category: string, extra: Record<string, unknown> = {}) =>
    (await db.item.create({ data: { code, name: code, category: category as never, ...extra } })).id;
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const binA = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "01", bin: "01", type: "STORAGE", warehouseId: wh.id } });
  const binB = await db.location.create({ data: { code: "A-01-02", rack: "A", shelf: "01", bin: "02", type: "STORAGE", warehouseId: wh.id } });
  const machine = await db.machine.create({ data: { code: "IMM-1", name: "90T" } });
  const mould = await db.mould.create({ data: { code: "MLD-1", name: "Clip", cavities: 4, runnerWeightG: 8 } });
  ids = {
    binA: binA.id, binB: binB.id, machine: machine.id, mould: mould.id,
    fg: await mk("FG-CLIP", "FG", { hsnCode: "39269099", unitPrice: 4.25, uom: "NOS" }),
    fg2: await mk("FG-OTHER", "FG", { uom: "NOS" }),
    pp: await mk("RM-PP", "RM_RESIN", { polymerGrade: "PP" }),
    crate: await mk("CRATE-A", "RETURNABLE", { uom: "NOS" }),
    apex: (await db.customer.create({ data: { code: "APEX", name: "Apex Motors", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "27BBBBB1111B1Z6" } })).id,
    bright: (await db.customer.create({ data: { code: "BRIGHT", name: "Bright Home", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC" } })).id,
  };
  const bom = await saveBom({ fgItemId: ids.fg, mouldId: ids.mould, partWeightG: 10, lines: [{ itemId: ids.pp, kind: "RESIN", pct: 100 }] }, db);
  const r = await bookProduction({ bomId: bom.id, machineId: ids.machine, shift: "B", shots: 1000, goodParts: 3000, rejectParts: 100 }, db);
  fgLotId = r.fgLotId!;
  lotNumber = (await db.lot.findUniqueOrThrow({ where: { id: fgLotId } })).lotNumber;
});

const pack = (over: Record<string, unknown> = {}) =>
  packBoxes({ lotNumber, binCode: "A-01-01", customerId: ids.apex, qtyPerBox: 500, boxCount: 2, ...over } as never, db);

async function openDispatch(qty = 1000, customerId = ids.apex) {
  return createDispatch({ customerId, vehicleNumber: "mh12ab1234", lines: [{ itemId: ids.fg, qty }] }, db);
}

describe("finished goods from production", () => {
  it("booking creates an approved FG lot with stock in a bin", async () => {
    const lot = await db.lot.findUniqueOrThrow({ where: { id: fgLotId }, include: { item: true } });
    expect(lot.item.code).toBe("FG-CLIP");
    expect(lot.qcStatus).toBe("APPROVED");
    const bal = await db.stockBalance.findFirstOrThrow({ where: { lotId: fgLotId } });
    expect(Number(bal.qty)).toBe(3000);
    expect((await db.productionBooking.findFirstOrThrow()).fgLotId).toBe(fgLotId);
  });
});

describe("packBoxes and labels", () => {
  it("makes numbered boxes for a customer that reserve stock", async () => {
    const boxes = await pack();
    expect(boxes).toHaveLength(2);
    expect(new Set(boxes.map((b) => b.boxCode)).size).toBe(2);
    expect(await unboxedQty(db, fgLotId, ids.binA)).toBe(2000);
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: fgLotId } })).qty)).toBe(3000); // stock unchanged
  });

  it("will not box more than is unboxed in that bin", async () => {
    await expect(pack({ qtyPerBox: 1000, boxCount: 4 })).rejects.toThrow(/Only 3000 unboxed/);
    await pack({ qtyPerBox: 1000, boxCount: 2 });
    await expect(pack({ qtyPerBox: 1000, boxCount: 2 })).rejects.toThrow(/Only 1000 unboxed/);
  });

  it("rejects bad quantities, non-FG lots and unknown bins", async () => {
    await expect(pack({ qtyPerBox: 0 })).rejects.toThrow(/above 0/);
    await expect(pack({ boxCount: 201 })).rejects.toThrow(/between 1 and 200/);
    await expect(pack({ binCode: "NOPE" })).rejects.toThrow(/Unknown bin/);
    await expect(pack({ lotNumber: "LOT-X" })).rejects.toThrow(/Unknown lot/);
    const rm = await db.lot.create({ data: { lotNumber: "L-RM", itemId: ids.pp, supplierLotNo: "S", receivedQty: 1, qcStatus: "APPROVED" } });
    await expect(pack({ lotNumber: rm.lotNumber })).rejects.toThrow(/not a finished-goods/);
  });

  it("uses the customer's label format and the production run's traceability data", async () => {
    const [oem] = await pack();
    const l = (await boxLabel(oem.boxCode, db))!;
    expect(l.title).toBe("OEM PART LABEL");
    expect(Object.fromEntries(l.fields)).toMatchObject({ "Part No": "FG-CLIP", Shift: "B", "Machine ID": "IMM-1", Quantity: "500" });
    expect(l.qrPayload.endsWith(oem.boxCode)).toBe(true);
    const [gen] = await pack({ customerId: ids.bright });
    expect((await boxLabel(gen.boxCode, db))!.qrPayload).toBe(gen.boxCode);
    expect(await boxLabel("BX-NOPE", db)).toBeNull();
  });

  it("stops a transfer from moving boxed parts out of their bin", async () => {
    await pack({ qtyPerBox: 1000, boxCount: 2 }); // 2000 boxed, 1000 free
    await expect(
      transferStock({ lotNumber, fromCode: "A-01-01", toCode: "A-01-02", qty: 1500 }, db),
    ).rejects.toThrow(/already in labelled boxes; only 1000/);
    await expect(transferStock({ lotNumber, fromCode: "A-01-01", toCode: "A-01-02", qty: 1000 }, db)).resolves.toBeTruthy();
  });
});

describe("dispatch scanning", () => {
  it("accepts matching boxes, by bare code or full OEM record, and tracks progress", async () => {
    const [b1, b2] = await pack();
    const d = await openDispatch();
    await scanBox({ dispatchId: d.id, scan: b1.boxCode.toLowerCase() }, db);
    const oemScan = (await boxLabel(b2.boxCode, db))!.qrPayload;
    const r = await scanBox({ dispatchId: d.id, scan: oemScan }, db);
    expect(r).toMatchObject({ scannedForLine: 1000, ordered: 1000 });
    const p = await dispatchProgress(d.id, db);
    expect(p.complete).toBe(true);
    expect(p.boxes).toHaveLength(2);
  });

  it("refuses unknown, duplicate, wrong-customer and off-list boxes", async () => {
    const [mine] = await pack();
    const [theirs] = await pack({ customerId: ids.bright });
    const d = await openDispatch();
    await expect(scanBox({ dispatchId: d.id, scan: "BX-NOPE" }, db)).rejects.toThrow(/Unknown box/);
    await scanBox({ dispatchId: d.id, scan: mine.boxCode }, db);
    await expect(scanBox({ dispatchId: d.id, scan: mine.boxCode }, db)).rejects.toThrow(/already scanned/);
    await expect(scanBox({ dispatchId: d.id, scan: theirs.boxCode }, db)).rejects.toThrow(/different customer/);

    const lot2 = await db.lot.create({ data: { lotNumber: "L-2", itemId: ids.fg2, supplierLotNo: "S", receivedQty: 100, qcStatus: "APPROVED" } });
    await db.stockBalance.create({ data: { lotId: lot2.id, locationId: ids.binA, qty: 100 } });
    const [other] = await packBoxes({ lotNumber: "L-2", binCode: "A-01-01", customerId: ids.apex, qtyPerBox: 100, boxCount: 1 }, db);
    await expect(scanBox({ dispatchId: d.id, scan: other.boxCode }, db)).rejects.toThrow(/isn't on this pick list/);
  });

  it("will not let scans exceed the pick list and blocks a box on two dispatches", async () => {
    const [b1, b2, b3] = await pack({ boxCount: 3 });
    const d = await openDispatch(1000);
    await scanBox({ dispatchId: d.id, scan: b1.boxCode }, db);
    await scanBox({ dispatchId: d.id, scan: b2.boxCode }, db);
    await expect(scanBox({ dispatchId: d.id, scan: b3.boxCode }, db)).rejects.toThrow(/exceed the pick list/);
    const d2 = await openDispatch(500);
    await expect(scanBox({ dispatchId: d2.id, scan: b1.boxCode }, db)).rejects.toThrow(/another dispatch/);
  });

  it("lets a mistaken scan be undone", async () => {
    const [b1] = await pack();
    const d = await openDispatch(500);
    await scanBox({ dispatchId: d.id, scan: b1.boxCode }, db);
    await unscanBox({ dispatchId: d.id, boxCode: b1.boxCode }, db);
    expect((await dispatchProgress(d.id, db)).boxes).toHaveLength(0);
    await expect(unscanBox({ dispatchId: d.id, boxCode: b1.boxCode }, db)).rejects.toThrow(/isn't on this dispatch/);
  });
});

describe("completeDispatch", () => {
  async function fullyLoaded() {
    const boxes = await pack();
    const d = await openDispatch(1000);
    for (const b of boxes) await scanBox({ dispatchId: d.id, scan: b.boxCode }, db);
    return { d, boxes };
  }

  it("moves stock out box by box, marks boxes dispatched and keeps the ledger balanced", async () => {
    const { d, boxes } = await fullyLoaded();
    const done = await completeDispatch({ dispatchId: d.id }, db);
    expect(done.status).toBe("DISPATCHED");
    expect(done.dispatchedAt).not.toBeNull();
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: fgLotId } })).qty)).toBe(2000);
    expect(await db.stockTransaction.count({ where: { type: "DISPATCH", lotId: fgLotId } })).toBe(boxes.length);
    expect((await db.fgBox.findMany({ where: { dispatchId: d.id } })).every((b) => b.status === "DISPATCHED")).toBe(true);
    const ledger = await db.stockTransaction.aggregate({ _sum: { qty: true }, where: { lotId: fgLotId } });
    const bals = await db.stockBalance.aggregate({ _sum: { qty: true }, where: { lotId: fgLotId } });
    expect(Number(ledger._sum.qty)).toBe(Number(bals._sum.qty));
  });

  it("refuses to dispatch a short or empty load and can't be completed twice", async () => {
    const boxes = await pack();
    const d = await openDispatch(1000);
    await expect(completeDispatch({ dispatchId: d.id }, db)).rejects.toThrow(/at least one box/);
    await scanBox({ dispatchId: d.id, scan: boxes[0].boxCode }, db);
    await expect(completeDispatch({ dispatchId: d.id }, db)).rejects.toThrow(/500 short/);
    await scanBox({ dispatchId: d.id, scan: boxes[1].boxCode }, db);
    await completeDispatch({ dispatchId: d.id }, db);
    await expect(completeDispatch({ dispatchId: d.id }, db)).rejects.toThrow(/already dispatched/);
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: fgLotId } })).qty)).toBe(2000); // not deducted twice
  });

  it("records crates going out and builds the customer balance", async () => {
    const { d } = await fullyLoaded();
    await completeDispatch({ dispatchId: d.id, crates: [{ itemId: ids.crate, qty: 20 }] }, db);
    const [row] = await returnableBalances(db);
    expect(row).toMatchObject({ customerName: "Apex Motors", itemCode: "CRATE-A", issued: 20, returned: 0, balance: 20 });
  });

  it("rejects crate lines that aren't returnable containers", async () => {
    const { d } = await fullyLoaded();
    await expect(completeDispatch({ dispatchId: d.id, crates: [{ itemId: ids.pp, qty: 5 }] }, db)).rejects.toThrow(/returnable/);
    expect((await db.dispatch.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("LOADING"); // rolled back
  });

  it("cancel releases the boxes for another dispatch", async () => {
    const { d, boxes } = await fullyLoaded();
    await cancelDispatch(d.id, db);
    const d2 = await openDispatch(1000);
    await expect(scanBox({ dispatchId: d2.id, scan: boxes[0].boxCode }, db)).resolves.toBeTruthy();
    await expect(scanBox({ dispatchId: d.id, scan: boxes[1].boxCode }, db)).rejects.toThrow(/cancelled/);
  });
});

describe("returnable ledger", () => {
  it("tracks returns against what is outstanding", async () => {
    await recordReturnable({ customerId: ids.apex, itemId: ids.crate, move: "ISSUED", qty: 100, note: "Opening balance" }, db);
    await recordReturnable({ customerId: ids.apex, itemId: ids.crate, move: "RETURNED", qty: 30 }, db);
    expect((await returnableBalances(db))[0]).toMatchObject({ issued: 100, returned: 30, balance: 70 });
    await expect(
      recordReturnable({ customerId: ids.apex, itemId: ids.crate, move: "RETURNED", qty: 71 }, db),
    ).rejects.toThrow(/only has 70.*outstanding/);
  });

  it("keeps customers separate and validates the item and quantity", async () => {
    await recordReturnable({ customerId: ids.apex, itemId: ids.crate, move: "ISSUED", qty: 10 }, db);
    await expect(
      recordReturnable({ customerId: ids.bright, itemId: ids.crate, move: "RETURNED", qty: 1 }, db),
    ).rejects.toThrow(/only has 0/);
    await expect(recordReturnable({ customerId: ids.apex, itemId: ids.pp, move: "ISSUED", qty: 1 }, db)).rejects.toThrow(/returnable/);
    await expect(recordReturnable({ customerId: ids.apex, itemId: ids.crate, move: "ISSUED", qty: 1.5 }, db)).rejects.toThrow(/whole number/);
  });
});

describe("createDispatch validation", () => {
  it("needs a vehicle, lines, FG parts and no duplicate parts", async () => {
    const base = { customerId: ids.apex, vehicleNumber: "MH12", lines: [{ itemId: ids.fg, qty: 10 }] };
    await expect(createDispatch({ ...base, vehicleNumber: " " }, db)).rejects.toThrow(/Vehicle/);
    await expect(createDispatch({ ...base, lines: [] }, db)).rejects.toThrow(/at least one/);
    await expect(createDispatch({ ...base, lines: [{ itemId: ids.pp, qty: 1 }] }, db)).rejects.toThrow(/finished-goods/);
    await expect(createDispatch({ ...base, lines: [{ itemId: ids.fg, qty: 1 }, { itemId: ids.fg, qty: 2 }] }, db)).rejects.toThrow(/once/);
    const d = await createDispatch({ ...base, vehicleNumber: "mh12 ab" }, db);
    expect(d.vehicleNumber).toBe("MH12 AB");
    expect(d.dcNumber).toMatch(/^DC-/);
  });
});
