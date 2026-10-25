import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { completeDispatch, createDispatch, recordReturnable, returnableBalances, scanBox } from "./dispatch";
import { packBoxes } from "./fg";
import { bookProduction, saveBom } from "./production";
import { approveScrap, pendingScrap } from "./scrap";
import { traceQuery, type FgTrace } from "./trace";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "ScrapDisposition", "ReturnableLedger", "FgBox", "DispatchLine", "Dispatch", "ProductionLotUse", "BookingConsumption", "ProductionBooking",
    "BomLine", "Bom", "QcInspection", "StockTransaction", "StockBalance", "Lot", "Mould", "Machine", "Location", "Warehouse", "Customer", "Item",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const mk = async (code: string, category: string, extra: Record<string, unknown> = {}) =>
    (await db.item.create({ data: { code, name: code, category: category as never, ...extra } })).id;
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const bin = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "01", bin: "01", type: "STORAGE", warehouseId: wh.id } });
  const stg = await db.location.create({ data: { code: "STG", rack: "S", shelf: "1", bin: "1", type: "STAGING", warehouseId: wh.id } });
  const machine = await db.machine.create({ data: { code: "IMM-1", name: "90T" } });
  const mould = await db.mould.create({ data: { code: "MLD-1", name: "Clip", cavities: 4, runnerWeightG: 8 } });
  ids = {
    bin: bin.id, stg: stg.id, machine: machine.id, mould: mould.id,
    fg: await mk("FG-CLIP", "FG", { uom: "NOS" }), fgIns: await mk("FG-INSERT", "FG", { uom: "NOS" }),
    pp: await mk("RM-PP", "RM_RESIN", { polymerGrade: "PP" }),
    rg: await mk("RG-PP", "REGRIND", { polymerGrade: "PP" }),
    ins: await mk("INS", "BOP", { uom: "NOS" }),
    ownCrate: await mk("CRATE-OWN", "RETURNABLE", { uom: "NOS", stockTracked: true }),
    custCrate: await mk("CRATE-CUST", "RETURNABLE", { uom: "NOS", stockTracked: false }),
    apex: (await db.customer.create({ data: { code: "APEX", name: "Apex", segment: "AUTOMOTIVE", labelFormat: "OEM" } })).id,
  };
  await saveBom({ fgItemId: ids.fg, mouldId: ids.mould, partWeightG: 10, lines: [{ itemId: ids.pp, kind: "RESIN", pct: 100 }] }, db);
  await saveBom({ fgItemId: ids.fgIns, mouldId: ids.mould, partWeightG: 12, lines: [{ itemId: ids.pp, kind: "RESIN", pct: 100 }, { itemId: ids.ins, kind: "BOP", qtyPerPart: 1 }] }, db);
});

const run = async (fgItemId: string, good = 3800, rejects = 100) => {
  const bom = await db.bom.findFirstOrThrow({ where: { fgItemId } });
  return bookProduction({ bomId: bom.id, machineId: ids.machine, shift: "A", shots: 1000, goodParts: good, rejectParts: rejects }, db);
};

describe("scrap approval", () => {
  it("lists bookings with undecided rejects", async () => {
    await run(ids.fg, 3800, 100);
    await run(ids.fg, 4000, 0); // no rejects: not listed
    const p = await pendingScrap(db);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ rejectParts: 100, remaining: 100, hasInserts: false, part: "FG-CLIP" });
  });

  it("regrind turns the parts' weight into approved regrind stock tagged with the booking", async () => {
    const r = await run(ids.fg);
    const d = await approveScrap({ bookingId: r.booking.id, parts: 60, kind: "REGRIND", userId: "qa1" }, db);
    expect(Number(d.weightKg)).toBe(0.6); // 60 × 10 g
    const lot = await db.lot.findUniqueOrThrow({ where: { id: d.regrindLotId! } });
    expect(lot).toMatchObject({ itemId: ids.rg, qcStatus: "APPROVED", supplierLotNo: r.booking.bookingNumber });
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } })).qty)).toBe(0.6);
    expect(await db.stockTransaction.count({ where: { lotId: lot.id, type: "REGRIND_IN", refType: "SCRAP" } })).toBe(1);
    expect((await pendingScrap(db))[0].remaining).toBe(40);
  });

  it("waste is recorded without touching stock", async () => {
    const r = await run(ids.fg);
    const before = await db.stockBalance.count();
    const d = await approveScrap({ bookingId: r.booking.id, parts: 100, kind: "WASTE" }, db);
    expect(d.regrindLotId).toBeNull();
    expect(await db.stockBalance.count()).toBe(before);
    expect(await pendingScrap(db)).toEqual([]);
  });

  it("won't regrind parts that contain inserts, but will scrap them", async () => {
    const r = await run(ids.fgIns);
    await expect(approveScrap({ bookingId: r.booking.id, parts: 10, kind: "REGRIND" }, db)).rejects.toThrow(/contain inserts/);
    expect((await pendingScrap(db))[0].hasInserts).toBe(true);
    await expect(approveScrap({ bookingId: r.booking.id, parts: 10, kind: "WASTE" }, db)).resolves.toBeTruthy();
  });

  it("can't decide on more parts than were rejected, across several decisions", async () => {
    const r = await run(ids.fg);
    await approveScrap({ bookingId: r.booking.id, parts: 70, kind: "WASTE" }, db);
    await expect(approveScrap({ bookingId: r.booking.id, parts: 31, kind: "WASTE" }, db)).rejects.toThrow(/Only 30/);
    await expect(approveScrap({ bookingId: r.booking.id, parts: 0, kind: "WASTE" }, db)).rejects.toThrow(/above 0/);
    await expect(approveScrap({ bookingId: r.booking.id, parts: 1.5, kind: "WASTE" }, db)).rejects.toThrow(/whole number/);
    await approveScrap({ bookingId: r.booking.id, parts: 30, kind: "WASTE" }, db);
  });

  it("needs a regrind item and a storage bin for regrind", async () => {
    const r = await run(ids.fg);
    await db.item.update({ where: { id: ids.rg }, data: { active: false } });
    await expect(approveScrap({ bookingId: r.booking.id, parts: 5, kind: "REGRIND" }, db)).rejects.toThrow(/no regrind item/);
    await db.item.update({ where: { id: ids.rg }, data: { active: true } });
    await expect(approveScrap({ bookingId: r.booking.id, parts: 5, kind: "REGRIND", regrindLocationCode: "STG" }, db)).rejects.toThrow(/storage bin/);
    await expect(approveScrap({ bookingId: "nope", parts: 5, kind: "WASTE" }, db)).rejects.toThrow(/Unknown production booking/);
  });

  it("crushed rejects stay traceable to the run that made them", async () => {
    const r = await run(ids.fg);
    const d = await approveScrap({ bookingId: r.booking.id, parts: 10, kind: "REGRIND" }, db);
    const lot = await db.lot.findUniqueOrThrow({ where: { id: d.regrindLotId! } });
    expect(lot.supplierLotNo).toBe(r.booking.bookingNumber);
    // tracing the booking number resolves to its finished-goods lot, as before
    expect(((await traceQuery(r.booking.bookingNumber, db)) as FgTrace).kind).toBe("FG");
  });
});

describe("crate stock", () => {
  async function loaded(crates: { itemId: string; qty: number }[]) {
    const r = await run(ids.fg, 1000, 0);
    const fgLot = await db.lot.findUniqueOrThrow({ where: { id: r.fgLotId! } });
    const [b] = await packBoxes({ lotNumber: fgLot.lotNumber, binCode: "A-01-01", customerId: ids.apex, qtyPerBox: 1000, boxCount: 1 }, db);
    const d = await createDispatch({ customerId: ids.apex, vehicleNumber: "MH12", lines: [{ itemId: ids.fg, qty: 1000 }] }, db);
    await scanBox({ dispatchId: d.id, scan: b.boxCode }, db);
    return { d, complete: () => completeDispatch({ dispatchId: d.id, crates }, db) };
  }
  const stockOf = async (itemId: string) =>
    Number((await db.stockBalance.aggregate({ _sum: { qty: true }, where: { lot: { itemId } } }))._sum.qty ?? 0);
  const addCrates = async (itemId: string, qty: number) => {
    const lot = await db.lot.create({ data: { lotNumber: `L-${Math.random().toString(36).slice(2, 8)}`, itemId, supplierLotNo: "S", receivedQty: qty, qcStatus: "APPROVED" } });
    await db.stockBalance.create({ data: { lotId: lot.id, locationId: ids.bin, qty } });
  };

  it("crates we own come out of stock when sent", async () => {
    await addCrates(ids.ownCrate, 100);
    const { complete } = await loaded([{ itemId: ids.ownCrate, qty: 30 }]);
    await complete();
    expect(await stockOf(ids.ownCrate)).toBe(70);
    expect((await returnableBalances(db))[0]).toMatchObject({ itemCode: "CRATE-OWN", issued: 30, balance: 30 });
  });

  it("takes crates oldest-lot-first across lots", async () => {
    await addCrates(ids.ownCrate, 20);
    await addCrates(ids.ownCrate, 50);
    const { complete } = await loaded([{ itemId: ids.ownCrate, qty: 30 }]);
    await complete();
    expect(await stockOf(ids.ownCrate)).toBe(40);
    const lots = await db.lot.findMany({ where: { itemId: ids.ownCrate }, orderBy: { receivedAt: "asc" }, include: { balances: true } });
    expect(Number(lots[0].balances[0].qty)).toBe(0); // oldest emptied first
  });

  it("refuses to send more crates than we have, rolling the whole dispatch back", async () => {
    await addCrates(ids.ownCrate, 10);
    const { d, complete } = await loaded([{ itemId: ids.ownCrate, qty: 30 }]);
    await expect(complete()).rejects.toThrow(/Only 10 CRATE-OWN in stock/);
    expect((await db.dispatch.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("LOADING");
    expect(await stockOf(ids.ownCrate)).toBe(10);
    expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lot: { itemId: ids.fg } } })).qty)).toBe(1000); // FG not deducted either
  });

  it("customer-owned crates are ledger-only and need no stock", async () => {
    const { complete } = await loaded([{ itemId: ids.custCrate, qty: 25 }]);
    await complete();
    expect(await stockOf(ids.custCrate)).toBe(0);
    expect((await returnableBalances(db))[0]).toMatchObject({ itemCode: "CRATE-CUST", issued: 25 });
  });

  it("a return of crates we own goes back into stock; customer-owned returns do not", async () => {
    await addCrates(ids.ownCrate, 100);
    const { complete } = await loaded([{ itemId: ids.ownCrate, qty: 30 }]);
    await complete();
    await recordReturnable({ customerId: ids.apex, itemId: ids.ownCrate, move: "RETURNED", qty: 12 }, db);
    expect(await stockOf(ids.ownCrate)).toBe(82);
    expect(await db.stockTransaction.count({ where: { type: "RETURN" } })).toBe(1);

    await recordReturnable({ customerId: ids.apex, itemId: ids.custCrate, move: "ISSUED", qty: 5, note: "opening" }, db);
    await recordReturnable({ customerId: ids.apex, itemId: ids.custCrate, move: "RETURNED", qty: 5 }, db);
    expect(await stockOf(ids.custCrate)).toBe(0);
  });

  it("an opening balance of owned crates doesn't invent stock, and a bad return bin is refused", async () => {
    await recordReturnable({ customerId: ids.apex, itemId: ids.ownCrate, move: "ISSUED", qty: 40, note: "opening" }, db);
    expect(await stockOf(ids.ownCrate)).toBe(0);
    await expect(
      recordReturnable({ customerId: ids.apex, itemId: ids.ownCrate, move: "RETURNED", qty: 5, binCode: "STG" }, db),
    ).rejects.toThrow(/storage bin/);
    expect((await returnableBalances(db))[0].balance).toBe(40);
  });
});
