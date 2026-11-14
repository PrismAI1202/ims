import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createGrn, createMaterialRequest, createPurchaseOrder, DomainError, issueStock,
  pickableLots, recordQc, transferStock,
} from "./inventory";
import { stockByItem } from "./stock";
import { decideCount } from "./stockcount";
import { setPoExpedite } from "./purchase";

// Runs against the dedicated ims_test database, never the dev database.
const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });

async function reset() {
  for (const t of [
    "IssueLine", "MaterialRequestLine", "MaterialRequest", "StockTransaction", "StockBalance",
    "StockCountLine", "StockCount", "QcInspection", "Lot", "GrnLine", "Grn", "GateEntry", "PurchaseOrderLine", "PurchaseOrder",
    "PriceMaster", "Item", "Supplier", "Location", "Warehouse",
  ]) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  }
}

let supplierId: string, resinId: string, boxId: string;

beforeAll(async () => {
  expect(url).toContain("ims_test");
});
afterAll(() => db.$disconnect());

beforeEach(async () => {
  await reset();
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  for (const [code, type] of [["STG", "STAGING"], ["A-01-01", "STORAGE"], ["A-01-02", "STORAGE"]] as const) {
    await db.location.create({ data: { code, rack: "A", shelf: "01", bin: "01", type, warehouseId: wh.id } });
  }
  supplierId = (await db.supplier.create({ data: { code: "S1", name: "Sup", leadTimeDays: 5 } })).id;
  resinId = (await db.item.create({ data: { code: "RM1", name: "PP", category: "RM_RESIN", minStock: 100, reorderPoint: 200, maxStock: 1000 } })).id;
  boxId = (await db.item.create({ data: { code: "BX1", name: "Box", category: "PACKAGING", uom: "NOS", requiresCoa: false } })).id;
});

async function receiveLot(qty: number, lotNo: string, opts: { coa?: string; segment?: "AUTOMOTIVE" | "NON_AUTOMOTIVE"; itemId?: string } = {}) {
  const itemId = opts.itemId ?? resinId;
  const po = await createPurchaseOrder({
    supplierId, segment: opts.segment ?? "NON_AUTOMOTIVE", lines: [{ itemId, qty, price: 10 }],
  }, db);
  const grn = await createGrn({
    poId: po.id, vehicleNumber: "MH12AB1234", invoiceNumber: "INV-1", coaUrl: opts.coa,
    lines: [{ poLineId: po.lines[0].id, qty, supplierLotNo: lotNo }],
  }, db);
  const lot = await db.lot.findFirstOrThrow({ where: { grnLine: { grnId: grn.id } } });
  return { po, grn, lot };
}

describe("GRN", () => {
  it("creates a PENDING_QC lot in staging and ledgers the receipt", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    expect(lot.qcStatus).toBe("PENDING_QC");
    const bal = await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id }, include: { location: true } });
    expect(bal.location.code).toBe("STG");
    expect(Number(bal.qty)).toBe(500);
    expect(await db.stockTransaction.count({ where: { lotId: lot.id, type: "GRN_IN" } })).toBe(1);
  });

  it("requires a COA for automotive POs", async () => {
    await expect(receiveLot(100, "HEAT-A", { segment: "AUTOMOTIVE" })).rejects.toThrow(/COA/);
    await expect(receiveLot(100, "HEAT-A", { segment: "AUTOMOTIVE", coa: "coa-001.pdf" })).resolves.toBeTruthy();
  });

  it("does not count pending-QC stock as usable on-hand", async () => {
    await receiveLot(500, "HEAT-1");
    const row = (await stockByItem(db)).find((r) => r.code === "RM1");
    expect(row?.onHand).toBe(0);
    expect(row?.pendingQc).toBe(500);
  });
});

describe("asking a supplier to expedite", () => {
  const make = (extra: Record<string, unknown> = {}) =>
    createPurchaseOrder({ supplierId, segment: "NON_AUTOMOTIVE", lines: [{ itemId: resinId, qty: 100, price: 10 }], ...extra }, db);

  it("is off by default, can be set when the PO is raised, and can be changed while goods are still expected", async () => {
    const plain = await make();
    expect(plain).toMatchObject({ expedite: false, expediteNote: null });
    const urgent = await make({ expedite: true, expediteNote: "  Line stops on the 30th  " });
    expect(urgent).toMatchObject({ expedite: true, expediteNote: "Line stops on the 30th" });

    expect(await setPoExpedite(plain.id, true, "Customer pulled the date in", db)).toMatchObject({ expedite: true, expediteNote: "Customer pulled the date in" });
    expect(await setPoExpedite(plain.id, false, "ignored when switching off", db)).toMatchObject({ expedite: false, expediteNote: null });
  });

  it("can't be set on a PO that is closed or cancelled", async () => {
    const po = await make();
    await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELLED" } });
    await expect(setPoExpedite(po.id, true, undefined, db)).rejects.toThrow(/nothing to expedite/);
    await expect(setPoExpedite("nope", true, undefined, db)).rejects.toThrow(/Unknown purchase order/);
  });
});

describe("QC and put-away", () => {
  it("approval with a bin moves stock out of staging and makes it usable", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    await recordQc({ lotId: lot.id, decision: "APPROVED", mfi: 12, moisturePct: 0.02, putawayLocationCode: "A-01-01" }, db);
    const bal = await db.stockBalance.findMany({ where: { lotId: lot.id, qty: { gt: 0 } }, include: { location: true } });
    expect(bal.map((b) => b.location.code)).toEqual(["A-01-01"]);
    expect((await pickableLots(resinId, db))[0].available).toBe(500);
  });

  it("rejected lots are never pickable and a decision can't be made twice", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    await recordQc({ lotId: lot.id, decision: "REJECTED", remarks: "wet" }, db);
    expect(await pickableLots(resinId, db)).toHaveLength(0);
    await expect(recordQc({ lotId: lot.id, decision: "APPROVED" }, db)).rejects.toThrow(DomainError);
  });

  it("a deviation needs remarks", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    await expect(recordQc({ lotId: lot.id, decision: "DEVIATED" }, db)).rejects.toThrow(/remarks/);
  });

  it("a count that matches the GRN is kept on the inspection and the lot is put away as usual", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    const r = await recordQc({ lotId: lot.id, decision: "APPROVED", countedQty: 500, putawayLocationCode: "A-01-01" }, db);
    expect(r.countDifference).toBeNull();
    expect(Number((await db.qcInspection.findFirstOrThrow({ where: { lotId: lot.id } })).countedQty)).toBe(500);
    expect(await db.stockCount.count()).toBe(0);
    const bal = await db.stockBalance.findMany({ where: { lotId: lot.id, qty: { gt: 0 } }, include: { location: true } });
    expect(bal.map((b) => b.location.code)).toEqual(["A-01-01"]);
  });

  it("a count that differs goes for approval and keeps the lot in staging until it is decided", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    const r = await recordQc({ lotId: lot.id, decision: "APPROVED", countedQty: 480, putawayLocationCode: "A-01-01" }, db);
    expect(r.countDifference).toBe(-20);
    expect(r.qcStatus).toBe("APPROVED");
    const count = await db.stockCount.findFirstOrThrow({ include: { lines: true, location: true } });
    expect(count).toMatchObject({ status: "SUBMITTED" });
    expect(count.location.code).toBe("STG");
    expect([Number(count.lines[0].systemQty), Number(count.lines[0].countedQty)]).toEqual([500, 480]);
    const bal = await db.stockBalance.findMany({ where: { lotId: lot.id, qty: { gt: 0 } }, include: { location: true } });
    expect(bal.map((b) => [b.location.code, Number(b.qty)])).toEqual([["STG", 500]]); // not stored on a quantity nobody agreed
    await expect(recordQc({ lotId: lot.id, decision: "APPROVED", countedQty: -1 }, db)).rejects.toThrow(DomainError);

    // Once the approver agrees, staging holds the counted quantity and Store can put it away.
    await decideCount({ id: count.id, approve: true, userId: "boss" }, db);
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id, qty: { gt: 0 } } })).qty)).toBe(480);
    await transferStock({ lotNumber: lot.lotNumber, fromCode: "STG", toCode: "A-01-01", qty: 480 }, db);
    const after = await db.stockBalance.findMany({ where: { lotId: lot.id, qty: { gt: 0 } }, include: { location: true } });
    expect(after.map((b) => [b.location.code, Number(b.qty)])).toEqual([["A-01-01", 480]]);
  });
});

describe("transfer", () => {
  it("is idempotent on clientUuid", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    await recordQc({ lotId: lot.id, decision: "APPROVED", putawayLocationCode: "A-01-01" }, db);
    const t = { lotNumber: lot.lotNumber, fromCode: "A-01-01", toCode: "A-01-02", qty: 100, clientUuid: "u-1" };
    expect((await transferStock(t, db)).replayed).toBe(false);
    expect((await transferStock(t, db)).replayed).toBe(true);
    const b2 = await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id, location: { code: "A-01-02" } } });
    expect(Number(b2.qty)).toBe(100);
  });

  it("refuses to move a pending-QC lot into storage", async () => {
    const { lot } = await receiveLot(500, "HEAT-1");
    await expect(
      transferStock({ lotNumber: lot.lotNumber, fromCode: "STG", toCode: "A-01-01", qty: 10 }, db),
    ).rejects.toThrow(/PENDING_QC/);
  });
});

describe("issue", () => {
  async function twoApprovedLots() {
    const a = await receiveLot(100, "HEAT-OLD");
    await recordQc({ lotId: a.lot.id, decision: "APPROVED", putawayLocationCode: "A-01-01" }, db);
    // make lot A clearly older
    await db.lot.update({ where: { id: a.lot.id }, data: { receivedAt: new Date("2026-01-01") } });
    const b = await receiveLot(100, "HEAT-NEW");
    await recordQc({ lotId: b.lot.id, decision: "APPROVED", putawayLocationCode: "A-01-02" }, db);
    const req = await createMaterialRequest({ lines: [{ itemId: resinId, qty: 150 }] }, db);
    const line = await db.materialRequestLine.findFirstOrThrow({ where: { requestId: req.id } });
    return { a: a.lot, b: b.lot, line };
  }

  it("rejects a newer lot while an older one has stock, unless overridden", async () => {
    const { b, line } = await twoApprovedLots();
    await expect(
      issueStock({ requestLineId: line.id, lotNumber: b.lotNumber, locationCode: "A-01-02", qty: 50 }, db),
    ).rejects.toThrow(/FIFO/);
    await expect(
      issueStock({ requestLineId: line.id, lotNumber: b.lotNumber, locationCode: "A-01-02", qty: 50, fifoOverrideReason: "oldest lot damaged" }, db),
    ).resolves.toBeTruthy();
  });

  it("issues oldest-first, updates balances and request status, and is idempotent", async () => {
    const { a, b, line } = await twoApprovedLots();
    const first = { requestLineId: line.id, lotNumber: a.lotNumber, locationCode: "A-01-01", qty: 100, clientUuid: "i-1" };
    expect((await issueStock(first, db)).replayed).toBe(false);
    expect((await issueStock(first, db)).replayed).toBe(true); // replay is a no-op
    await issueStock({ requestLineId: line.id, lotNumber: b.lotNumber, locationCode: "A-01-02", qty: 50 }, db);

    const balA = await db.stockBalance.findFirstOrThrow({ where: { lotId: a.id, location: { code: "A-01-01" } } });
    expect(Number(balA.qty)).toBe(0);
    const req = await db.materialRequest.findFirstOrThrow({ where: { id: line.requestId } });
    expect(req.status).toBe("ISSUED");
    // ledger sum equals balance sum for the item
    const ledger = await db.stockTransaction.aggregate({ _sum: { qty: true }, where: { lot: { itemId: resinId } } });
    const bals = await db.stockBalance.aggregate({ _sum: { qty: true }, where: { lot: { itemId: resinId } } });
    expect(Number(ledger._sum.qty)).toBe(Number(bals._sum.qty));
    expect(Number(bals._sum.qty)).toBe(50);
  });

  it("cannot over-issue a request line or issue a lot of another item", async () => {
    const { a, line } = await twoApprovedLots();
    await expect(
      issueStock({ requestLineId: line.id, lotNumber: a.lotNumber, locationCode: "A-01-01", qty: 151 }, db),
    ).rejects.toThrow(/left to issue|Insufficient/);
    const box = await receiveLot(10, "BOX-1", { itemId: boxId });
    await recordQc({ lotId: box.lot.id, decision: "APPROVED", putawayLocationCode: "A-01-01" }, db);
    await expect(
      issueStock({ requestLineId: line.id, lotNumber: box.lot.lotNumber, locationCode: "A-01-01", qty: 5 }, db),
    ).rejects.toThrow(/different item/);
  });

  it("cannot issue a pending-QC lot", async () => {
    const { lot } = await receiveLot(100, "HEAT-P");
    const req = await createMaterialRequest({ lines: [{ itemId: resinId, qty: 10 }] }, db);
    const line = await db.materialRequestLine.findFirstOrThrow({ where: { requestId: req.id } });
    await expect(
      issueStock({ requestLineId: line.id, lotNumber: lot.lotNumber, locationCode: "STG", qty: 10 }, db),
    ).rejects.toThrow(/PENDING_QC/);
  });
});
