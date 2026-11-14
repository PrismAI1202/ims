import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { debitNoteData, rejectedLots, returnToVendor, suggestReason } from "./rtv";
import { createGrn, createPurchaseOrder, recordQc } from "./inventory";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let lotNumber: string;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["ReturnToVendor", "QcInspection", "StockTransaction", "StockBalance", "Lot", "GrnLine", "Grn", "GateEntry", "PurchaseOrderLine", "PurchaseOrder", "PriceMaster", "Supplier", "Location", "Warehouse", "Item"])
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  await db.location.create({ data: { code: "STG", rack: "S", shelf: "1", bin: "1", type: "STAGING", warehouseId: wh.id } });
  const sup = await db.supplier.create({ data: { code: "S1", name: "PolyChem", leadTimeDays: 5 } });
  const item = await db.item.create({ data: { code: "RM-1", name: "Resin", category: "RM_RESIN", uom: "KG", hsnCode: "3902" } });
  const po = await createPurchaseOrder({ supplierId: sup.id, segment: "NON_AUTOMOTIVE", lines: [{ itemId: item.id, qty: 1000, price: 120 }] }, db);
  const poLine = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
  const grn = await createGrn({ poId: po.id, vehicleNumber: "MH12", invoiceNumber: "INV1", lines: [{ poLineId: poLine.id, qty: 400, supplierLotNo: "HEAT-9" }] }, db);
  const lot = await db.lot.findFirstOrThrow({ where: { grnLine: { grnId: grn.id } } });
  lotNumber = lot.lotNumber;
});

describe("the QC behind a return", () => {
  it("shows what the inspector recorded and offers it as the reason on the debit note", async () => {
    const lot = await db.lot.findUniqueOrThrow({ where: { lotNumber } });
    await recordQc({ lotId: lot.id, decision: "REJECTED", mfi: 18.2, moisturePct: 0.4, remarks: "Wet material, MFI out of spec", countedQty: 380 }, db);
    const [l] = await rejectedLots(db);
    expect(l).toMatchObject({ receivedQty: 400, supplierLotNo: "HEAT-9" });
    expect(l.grnNumber).toMatch(/^GRN-/);
    expect(l.qc).toMatchObject({ remarks: "Wet material, MFI out of spec", mfi: 18.2, moisturePct: 0.4, density: null, countedQty: 380 });
    expect(l.suggestedReason).toBe("Wet material, MFI out of spec. Results: MFI 18.2 g/10min, moisture 0.4%.");
  });

  it("builds the reason from whatever was recorded", () => {
    const base = { decidedAt: new Date(), inspector: null, remarks: null, mfi: null, moisturePct: null, density: null, tensile: null, countedQty: null, coaUrl: null };
    expect(suggestReason(null)).toBe("");
    expect(suggestReason(base)).toBe("Failed inward QC.");
    expect(suggestReason({ ...base, remarks: "  Contaminated.  ", tensile: 31 })).toBe("Contaminated. Results: tensile 31 MPa.");
  });
});

describe("return to supplier", () => {
  it("only offers rejected lots, then removes the stock and prices the debit note from the PO", async () => {
    expect(await rejectedLots(db)).toEqual([]);
    await expect(returnToVendor({ lotNumber, qty: 100, reason: "Bad MFI" }, db)).rejects.toThrow(/only a rejected lot/);

    const lot = await db.lot.findUniqueOrThrow({ where: { lotNumber } });
    await recordQc({ lotId: lot.id, decision: "REJECTED", remarks: "MFI out of spec" }, db);
    expect((await rejectedLots(db))[0]).toMatchObject({ lotNumber, supplier: "PolyChem", onHand: 400 });

    await expect(returnToVendor({ lotNumber, qty: 0, reason: "x" }, db)).rejects.toThrow(/positive/);
    await expect(returnToVendor({ lotNumber, qty: 100, reason: " " }, db)).rejects.toThrow(/reason/);
    await expect(returnToVendor({ lotNumber, qty: 401, reason: "x" }, db)).rejects.toThrow(/Only 400/);

    const rtv = await returnToVendor({ lotNumber, qty: 150, reason: "MFI out of spec", userId: "u1" }, db);
    const left = await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(Number(left.qty)).toBe(250);
    const txn = await db.stockTransaction.findFirstOrThrow({ where: { type: "RTV_OUT" } });
    expect(Number(txn.qty)).toBe(-150);
    expect(txn).toMatchObject({ refType: "RTV", refId: rtv.id });

    const note = await debitNoteData(rtv.id, db);
    expect(note).toMatchObject({ qty: 150, rate: 120, value: 18000 });
    expect(note.rtv.debitNoteNumber).toMatch(/^DN-\d{6}-0001$/);
    expect(note.poNumber).toMatch(/^PO-/);

    await returnToVendor({ lotNumber, qty: 250, reason: "Rest of the lot" }, db);
    expect(await rejectedLots(db)).toEqual([]);
    expect(await db.returnToVendor.count()).toBe(2);
  });
});
