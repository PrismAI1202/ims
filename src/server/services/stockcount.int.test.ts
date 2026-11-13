import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decideCount, differences, saveCount, startCount, submitCount } from "./stockcount";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let bin: string, lotA: string, lotB: string, binId: string, lotAId: string;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["StockCountLine", "StockCount", "FgBox", "StockTransaction", "StockBalance", "Lot", "Location", "Warehouse", "Customer", "Item"])
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const loc = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "1", bin: "1", type: "STORAGE", warehouseId: wh.id } });
  const item = await db.item.create({ data: { code: "RM-1", name: "Resin", category: "RM_RESIN", uom: "KG" } });
  const a = await db.lot.create({ data: { lotNumber: "LOT-A", itemId: item.id, supplierLotNo: "S1", receivedQty: 100, qcStatus: "APPROVED" } });
  const b = await db.lot.create({ data: { lotNumber: "LOT-B", itemId: item.id, supplierLotNo: "S2", receivedQty: 50, qcStatus: "APPROVED" } });
  await db.stockBalance.create({ data: { lotId: a.id, locationId: loc.id, qty: 100 } });
  await db.stockBalance.create({ data: { lotId: b.id, locationId: loc.id, qty: 50 } });
  bin = loc.code; binId = loc.id; lotA = a.lotNumber; lotB = b.lotNumber; lotAId = a.id;
});

const qty = async (lotNumber: string) =>
  Number((await db.stockBalance.findFirst({ where: { lot: { lotNumber }, locationId: binId } }))?.qty ?? 0);

describe("stock count", () => {
  it("snapshots the bin, needs every lot counted, then posts only the differences on approval", async () => {
    const c = await startCount({ locationCode: bin }, db);
    expect(await db.stockCountLine.count({ where: { countId: c.id } })).toBe(2);
    await expect(startCount({ locationCode: bin }, db)).rejects.toThrow(/in progress/);

    await saveCount(c.id, [{ lotNumber: lotA, countedQty: 95 }], "store", db);
    await expect(submitCount(c.id, "store", db)).rejects.toThrow(/LOT-B/);
    await saveCount(c.id, [{ lotNumber: lotB, countedQty: 50 }], "store", db);
    await submitCount(c.id, "store", db);

    // nothing moves until a decision
    expect(await qty(lotA)).toBe(100);
    const r = await decideCount({ id: c.id, approve: true, userId: "admin" }, db);
    expect(r.adjusted).toBe(1);
    expect(await qty(lotA)).toBe(95);
    expect(await qty(lotB)).toBe(50);
    const txns = await db.stockTransaction.findMany({ where: { type: "ADJUST" } });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ refType: "STOCK_COUNT", refId: c.id, userId: "admin" });
    expect(Number(txns[0].qty)).toBe(-5);
    await expect(decideCount({ id: c.id, approve: true }, db)).rejects.toThrow(/only a submitted count/);
  });

  it("rejecting needs a remark and leaves stock alone", async () => {
    const c = await startCount({ locationCode: bin }, db);
    await saveCount(c.id, [{ lotNumber: lotA, countedQty: 10 }, { lotNumber: lotB, countedQty: 50 }], "store", db);
    await submitCount(c.id, "store", db);
    await expect(decideCount({ id: c.id, approve: false }, db)).rejects.toThrow(/why/);
    await decideCount({ id: c.id, approve: false, note: "Recount please" }, db);
    expect(await qty(lotA)).toBe(100);
    expect(await db.stockTransaction.count({ where: { type: "ADJUST" } })).toBe(0);
    expect((await db.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("REJECTED");
  });

  it("adds a lot found in the bin, and applies the difference to the stock as it is at approval", async () => {
    const other = await db.item.create({ data: { code: "RM-2", name: "Other", category: "RM_RESIN", uom: "KG" } });
    await db.lot.create({ data: { lotNumber: "LOT-C", itemId: other.id, supplierLotNo: "S3", receivedQty: 10, qcStatus: "APPROVED" } });
    const c = await startCount({ locationCode: bin }, db);
    await saveCount(c.id, [{ lotNumber: lotA, countedQty: 100 }, { lotNumber: lotB, countedQty: 40 }, { lotNumber: "LOT-C", countedQty: 7 }], "store", db);
    await submitCount(c.id, "store", db);
    // 20 kg of LOT-B is moved out before the approver looks at it: the -10 difference still applies on top
    await db.stockBalance.updateMany({ where: { lot: { lotNumber: lotB } }, data: { qty: 30 } });
    await decideCount({ id: c.id, approve: true }, db);
    expect(await qty(lotB)).toBe(20);
    expect(await qty("LOT-C")).toBe(7);
  });

  it("refuses to count below parts already in labelled boxes, and below zero", async () => {
    const cust = await db.customer.create({ data: { code: "C", name: "C", segment: "AUTOMOTIVE", labelFormat: "OEM" } });
    await db.fgBox.create({ data: { boxCode: "BX-1", lotId: lotAId, customerId: cust.id, locationId: binId, qty: 80, producedDate: new Date() } });
    const c = await startCount({ locationCode: bin }, db);
    await saveCount(c.id, [{ lotNumber: lotA, countedQty: 60 }, { lotNumber: lotB, countedQty: 50 }], "store", db);
    await submitCount(c.id, "store", db);
    await expect(decideCount({ id: c.id, approve: true }, db)).rejects.toThrow(/labelled boxes/);
    // the failed approval rolled back, so the count is still open for a decision
    expect((await db.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("SUBMITTED");
    expect(await qty(lotA)).toBe(100);
  });

  it("computes differences for display", () => {
    expect(differences([
      { lotNumber: "A", systemQty: 10, countedQty: 10 }, { lotNumber: "B", systemQty: 10, countedQty: 7.5 }, { lotNumber: "C", systemQty: 0, countedQty: null },
    ])).toEqual([{ lotNumber: "B", delta: -2.5 }]);
  });
});
