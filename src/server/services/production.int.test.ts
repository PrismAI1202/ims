import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMaterialRequest, issueStock, pickableLots } from "./inventory";
import { bookProduction, saveBom, varianceReport } from "./production";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "BookingConsumption", "ProductionBooking", "BomLine", "Bom", "IssueLine", "MaterialRequestLine", "MaterialRequest",
    "StockTransaction", "StockBalance", "QcInspection", "Lot", "Mould", "Machine", "Location", "Warehouse", "Item",
  ]) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  }
  const mk = async (code: string, category: string, extra: Record<string, unknown> = {}) =>
    (await db.item.create({ data: { code, name: code, category: category as never, ...extra } })).id;
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const bin = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "01", bin: "01", type: "STORAGE", warehouseId: wh.id } });
  const machine = await db.machine.create({ data: { code: "IMM-1", name: "90T" } });
  const mould = await db.mould.create({ data: { code: "MLD-1", name: "Clip", cavities: 4, runnerWeightG: 8 } });
  ids = {
    bin: bin.id, machine: machine.id, mould: mould.id,
    fg: await mk("FG-CLIP", "FG"),
    pp: await mk("RM-PP", "RM_RESIN", { polymerGrade: "PP", maxRegrindPct: 25 }),
    abs: await mk("RM-ABS", "RM_RESIN", { polymerGrade: "ABS", maxRegrindPct: 20 }),
    mb: await mk("MB-BLK", "RM_MASTERBATCH"),
    rgPP: await mk("RG-PP", "REGRIND", { polymerGrade: "PP" }),
    rgABS: await mk("RG-ABS", "REGRIND", { polymerGrade: "ABS" }),
    insert: await mk("BOP-INS", "BOP", { uom: "NOS" }),
    box: await mk("PK-BOX", "PACKAGING", { uom: "NOS" }),
  };
});

const goodBom = () => ({
  fgItemId: ids.fg, mouldId: ids.mould, partWeightG: 10,
  lines: [
    { itemId: ids.pp, kind: "RESIN" as const, pct: 70 },
    { itemId: ids.mb, kind: "MASTERBATCH" as const, pct: 5 },
    { itemId: ids.rgPP, kind: "REGRIND" as const, pct: 25 },
    { itemId: ids.insert, kind: "BOP" as const, qtyPerPart: 2 },
  ],
});

describe("saveBom", () => {
  it("saves a valid BOM and replaces its lines on re-save (no duplicates)", async () => {
    const first = await saveBom(goodBom(), db);
    expect(first.lines).toHaveLength(4);
    const edit = goodBom();
    edit.lines = [
      { itemId: ids.pp, kind: "RESIN", pct: 95 }, { itemId: ids.mb, kind: "MASTERBATCH", pct: 5 },
    ] as never;
    const second = await saveBom(edit, db);
    expect(second.id).toBe(first.id);
    expect(await db.bomLine.count({ where: { bomId: first.id } })).toBe(2);
    expect(await db.bom.count()).toBe(1);
  });

  it("rejects a blend that does not add to 100%", async () => {
    const b = goodBom();
    b.lines[0] = { itemId: ids.pp, kind: "RESIN", pct: 60 };
    await expect(saveBom(b, db)).rejects.toThrow(/100%/);
  });

  it("enforces the resin's max regrind ratio", async () => {
    const b = goodBom();
    b.lines[0] = { itemId: ids.pp, kind: "RESIN", pct: 65 };
    b.lines[2] = { itemId: ids.rgPP, kind: "REGRIND", pct: 30 }; // PP allows 25
    await expect(saveBom(b, db)).rejects.toThrow(/at most 25%/);
  });

  it("rejects regrind of a different polymer than the resin", async () => {
    const b = goodBom();
    b.lines[2] = { itemId: ids.rgABS, kind: "REGRIND", pct: 25 };
    await expect(saveBom(b, db)).rejects.toThrow(/ABS.*PP/);
  });

  it("rejects an item used as the wrong kind, and a non-FG part", async () => {
    const b = goodBom();
    b.lines[1] = { itemId: ids.pp, kind: "MASTERBATCH", pct: 5 };
    await expect(saveBom(b, db)).rejects.toThrow(/can't be used as a masterbatch/);
    await expect(saveBom({ ...goodBom(), fgItemId: ids.pp }, db)).rejects.toThrow(/finished-goods/);
  });
});

describe("bookProduction", () => {
  const booking = (over: Record<string, unknown> = {}) => ({
    machineId: "", shift: "A" as const, shots: 1000, goodParts: 3900, rejectParts: 50, ...over,
  });

  it("freezes expected consumption and turns runners into an approved regrind lot", async () => {
    const bom = await saveBom(goodBom(), db);
    const { booking: b, regrindLotId } = await bookProduction({ ...booking(), bomId: bom.id, machineId: ids.machine }, db);

    const exp = Object.fromEntries(b.consumption.map((c) => [c.itemId, Number(c.expectedQty)]));
    expect(exp[ids.pp]).toBeCloseTo(33.6, 3); // 70% of 1000 shots × 48 g
    expect(exp[ids.insert]).toBe(2 * 3950);
    expect(Number(b.runnerKg)).toBe(8); // 1000 × 8 g

    const lot = await db.lot.findUniqueOrThrow({ where: { id: regrindLotId! } });
    expect(lot.itemId).toBe(ids.rgPP);
    expect(lot.qcStatus).toBe("APPROVED");
    const bal = await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(Number(bal.qty)).toBe(8);
    expect(await db.stockTransaction.count({ where: { lotId: lot.id, type: "REGRIND_IN" } })).toBe(1);
    // the regrind can be issued back to the floor through the normal flow
    expect((await pickableLots(ids.rgPP, db))[0].available).toBe(8);
  });

  it("uses a weighed runner figure over the calculated one", async () => {
    const bom = await saveBom(goodBom(), db);
    const { booking: b } = await bookProduction({ ...booking(), bomId: bom.id, machineId: ids.machine, runnerKgActual: 9.4 }, db);
    expect(Number(b.runnerKg)).toBe(9.4);
    const bal = await db.stockBalance.findFirstOrThrow({ where: { lot: { itemId: ids.rgPP } } });
    expect(Number(bal.qty)).toBe(9.4);
  });

  it("books but skips regrind stock when no regrind item exists for the grade", async () => {
    await db.item.delete({ where: { id: ids.rgPP } }).catch(() => undefined);
    const noRegrind = { ...goodBom(), lines: goodBom().lines.filter((l) => l.kind !== "REGRIND").map((l) => l.kind === "RESIN" ? { ...l, pct: 95 } : l) };
    await db.item.updateMany({ where: { category: "REGRIND" }, data: { active: false } });
    const bom = await saveBom(noRegrind, db);
    const r = await bookProduction({ ...booking(), bomId: bom.id, machineId: ids.machine }, db);
    expect(r.regrindSkipped).toBe(true);
    expect(r.regrindLotId).toBeUndefined();
    expect(Number(r.booking.runnerKg)).toBe(8); // still logged
  });

  it("rejects more parts than shots × cavities and unknown machines", async () => {
    const bom = await saveBom(goodBom(), db);
    await expect(
      bookProduction({ ...booking({ goodParts: 4001, rejectParts: 0 }), bomId: bom.id, machineId: ids.machine }, db),
    ).rejects.toThrow(/exceed/);
    await expect(bookProduction({ ...booking(), bomId: bom.id, machineId: "nope" }, db)).rejects.toThrow(/machine/);
    expect(await db.productionBooking.count()).toBe(0); // nothing half-written
  });
});

describe("varianceReport", () => {
  async function stockAndIssue(itemId: string, qty: number, issueQty: number) {
    const lot = await db.lot.create({ data: { lotNumber: `L-${itemId.slice(-4)}`, itemId, supplierLotNo: "S", receivedQty: qty, qcStatus: "APPROVED" } });
    await db.stockBalance.create({ data: { lotId: lot.id, locationId: ids.bin, qty } });
    const req = await createMaterialRequest({ lines: [{ itemId, qty: issueQty }] }, db);
    const line = await db.materialRequestLine.findFirstOrThrow({ where: { requestId: req.id } });
    await issueStock({ requestLineId: line.id, lotNumber: lot.lotNumber, locationCode: "A-01-01", qty: issueQty }, db);
  }

  it("compares BOM-expected use with what the store issued", async () => {
    const bom = await saveBom(goodBom(), db);
    await bookProduction({ shots: 1000, goodParts: 3900, rejectParts: 50, shift: "B", bomId: bom.id, machineId: ids.machine }, db);
    await stockAndIssue(ids.pp, 100, 40); // expected 33.6 → over-issued by 6.4

    const day = (d: number) => new Date(Date.now() + d * 86_400_000);
    const rep = await varianceReport(day(-1), day(1), db);
    const pp = rep.rows.find((r) => r.itemId === ids.pp)!;
    expect(pp.expected).toBeCloseTo(33.6, 3);
    expect(pp.issued).toBe(40);
    expect(pp.variance).toBeCloseTo(6.4, 3);
    expect(pp.variancePct).toBeCloseTo(19, 0);
    const mb = rep.rows.find((r) => r.itemId === ids.mb)!;
    expect(mb.issued).toBe(0);
    expect(mb.variance).toBeLessThan(0); // booked but nothing issued
    expect(rep.totals).toMatchObject({ bookings: 1, goodParts: 3900, rejectParts: 50, runnerKg: 8 });
  });

  it("ignores activity outside the date window", async () => {
    const bom = await saveBom(goodBom(), db);
    await bookProduction({ shots: 10, goodParts: 40, rejectParts: 0, shift: "A", bomId: bom.id, machineId: ids.machine }, db);
    const past = await varianceReport(new Date("2020-01-01"), new Date("2020-02-01"), db);
    expect(past.rows).toEqual([]);
    expect(past.totals.bookings).toBe(0);
  });
});
