import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { returnableLots, returnMaterial } from "./returns";
import { varianceReport } from "./production";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["IssueLine", "MaterialRequestLine", "MaterialRequest", "ProductionLotUse", "StockTransaction", "StockBalance", "Lot", "Location", "Warehouse", "Item"])
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const bin = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "1", bin: "1", type: "STORAGE", warehouseId: wh.id } });
  const stg = await db.location.create({ data: { code: "STG", rack: "S", shelf: "1", bin: "1", type: "STAGING", warehouseId: wh.id } });
  const item = await db.item.create({ data: { code: "RM-1", name: "Resin", category: "RM_RESIN", uom: "KG" } });
  const lot = await db.lot.create({ data: { lotNumber: "LOT-1", itemId: item.id, supplierLotNo: "S", receivedQty: 500, qcStatus: "APPROVED" } });
  const req = await db.materialRequest.create({ data: { requestNumber: "MR-1", lines: { create: [{ itemId: item.id, qty: 100 }] } }, include: { lines: true } });
  await db.issueLine.create({ data: { requestLineId: req.lines[0].id, lotId: lot.id, qty: 100 } });
  ids = { bin: bin.id, stg: stg.id, lot: lot.id, item: item.id };
});

describe("return unused material", () => {
  it("puts material back into the same lot and bin, as a RETURN ledger row", async () => {
    await returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 30, userId: "u1" }, db);
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: ids.lot, locationId: ids.bin } })).qty)).toBe(30);
    const t = await db.stockTransaction.findFirstOrThrow({ where: { type: "RETURN" } });
    expect(t).toMatchObject({ refType: "MACHINE_RETURN", userId: "u1" });
    expect(Number(t.qty)).toBe(30);
  });

  it("can't return more than is out at the machines, counting use and earlier returns", async () => {
    await expect(returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 101 }, db)).rejects.toThrow(/Only 100/);
    await returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 60 }, db);
    await expect(returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 41 }, db)).rejects.toThrow(/Only 40/);
    const left = await returnableLots(db);
    expect(left.map((l) => [l.lotNumber, l.atMachine])).toEqual([["LOT-1", 40]]);
  });

  it("refuses staging bins, rejected lots and lots never issued", async () => {
    await expect(returnMaterial({ lotNumber: "LOT-1", locationCode: "STG", qty: 1 }, db)).rejects.toThrow(/storage bin/);
    await expect(returnMaterial({ lotNumber: "NOPE", locationCode: "A-01-01", qty: 1 }, db)).rejects.toThrow(/Unknown lot/);
    await expect(returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 0 }, db)).rejects.toThrow(/positive/);
    await db.lot.update({ where: { id: ids.lot }, data: { qcStatus: "REJECTED" } });
    await expect(returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 1 }, db)).rejects.toThrow(/REJECTED/);
    const other = await db.lot.create({ data: { lotNumber: "LOT-2", itemId: ids.item, supplierLotNo: "S", receivedQty: 5, qcStatus: "APPROVED" } });
    expect(other.id).toBeTruthy();
    await expect(returnMaterial({ lotNumber: "LOT-2", locationCode: "A-01-01", qty: 1 }, db)).rejects.toThrow(/Nothing of LOT-2/);
  });

  it("takes returned material off 'issued' in the BOM variance report", async () => {
    const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 86_400_000);
    expect((await varianceReport(from, to, db)).rows[0].issued).toBe(100);
    await returnMaterial({ lotNumber: "LOT-1", locationCode: "A-01-01", qty: 35 }, db);
    expect((await varianceReport(from, to, db)).rows[0].issued).toBe(65);
  });
});
