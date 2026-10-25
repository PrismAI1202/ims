import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createGrn, createPurchaseOrder, recordQc } from "./inventory";
import { addGrade, createGroup, decideGrade, listGroups, moveGradeUp } from "./equivalents";
import { completePm, logRepair, machineReliability, mouldRows, PM_CHECKS } from "./maintenance";
import { blockSlot, clearSlot, mondayOf, parseDay, placeJob, planWeek } from "./planning";
import { logDowntime } from "./downtime";
import { computeMetrics } from "./metrics";
import { getShiftMinutes, setShiftMinutes } from "./settings";
import { saveBom } from "./production";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;
const NOW = new Date("2026-10-21T10:00:00.000Z"); // a Wednesday

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "Downtime", "PmRecord", "RepairTicket", "PlanSlot", "EquivalentGrade", "EquivalentGroup", "AppSetting", "DemandLine", "DemandImport",
    "BookingConsumption", "ProductionBooking", "BomLine", "Bom", "GrnLine", "Grn", "GateEntry", "PurchaseOrderLine", "PurchaseOrder",
    "StockTransaction", "StockBalance", "QcInspection", "Lot", "Mould", "Machine", "Location", "Warehouse", "Item", "Supplier", "Customer",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const stg = await db.location.create({ data: { code: "STG-01", rack: "STG", shelf: "01", bin: "01", type: "STAGING", warehouseId: wh.id } });
  const bin = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "01", bin: "01", type: "STORAGE", warehouseId: wh.id } });
  const sA = await db.supplier.create({ data: { code: "S-A", name: "Vendor A", leadTimeDays: 7 } });
  const sB = await db.supplier.create({ data: { code: "S-B", name: "Vendor B", leadTimeDays: 12 } });
  const pp = await db.item.create({ data: { code: "RM-PP", name: "PP Homo", category: "RM_RESIN", polymerGrade: "PP", minStock: 100, maxRegrindPct: 25 } });
  const mb = await db.item.create({ data: { code: "MB-BLK", name: "Black masterbatch 40%", category: "RM_MASTERBATCH" } });
  const mbGrey = await db.item.create({ data: { code: "MB-GRY", name: "Grey MB RAL 7035", category: "RM_MASTERBATCH" } });
  const rg = await db.item.create({ data: { code: "RG-PP", name: "PP regrind", category: "REGRIND", polymerGrade: "PP" } });
  const fgA = await db.item.create({ data: { code: "FG-A", name: "Part A", category: "FG", uom: "NOS" } });
  const fgB = await db.item.create({ data: { code: "FG-B", name: "Part B", category: "FG", uom: "NOS" } });
  const small = await db.machine.create({ data: { code: "M-01", name: "80T", tonnage: 80 } });
  const big = await db.machine.create({ data: { code: "M-07", name: "180T", tonnage: 180 } });
  const mouldA = await db.mould.create({ data: { code: "MD-A", name: "A", cavities: 4, idealCycleSec: 20, minTonnage: 150, openingShots: 1000, pmIntervalShots: 50000, machineId: big.id } });
  const mouldB = await db.mould.create({ data: { code: "MD-B", name: "B", cavities: 2, idealCycleSec: 30, machineId: big.id } });
  await saveBom({ fgItemId: fgA.id, mouldId: mouldA.id, partWeightG: 6, lines: [
    { itemId: pp.id, kind: "RESIN", pct: 82 }, { itemId: rg.id, kind: "REGRIND", pct: 15 }, { itemId: mb.id, kind: "MASTERBATCH", pct: 3 } ] }, db);
  await saveBom({ fgItemId: fgB.id, mouldId: mouldB.id, partWeightG: 6, lines: [
    { itemId: pp.id, kind: "RESIN", pct: 95 }, { itemId: rg.id, kind: "REGRIND", pct: 3 }, { itemId: mbGrey.id, kind: "MASTERBATCH", pct: 2 } ] }, db);
  ids = { stg: stg.id, bin: bin.id, sA: sA.id, sB: sB.id, pp: pp.id, fgA: fgA.id, fgB: fgB.id, small: small.id, big: big.id, mouldA: mouldA.id, mouldB: mouldB.id };
});

describe("equivalent groups", () => {
  it("creates a group once per item and enforces the grade workflow", async () => {
    const g = await createGroup({ name: "PP Homopolymer MFI 12", itemId: ids.pp, spec: "MFI 11–13, H2O ≤ 0.05%" }, db);
    expect(g.code).toBe("EQ-RM-001");
    await expect(createGroup({ name: "again", itemId: ids.pp }, db)).rejects.toThrow(/already has the group/);

    await expect(addGrade({ groupId: g.id, gradeName: "H110", supplierId: ids.sA }, db)).rejects.toThrow(/datasheet/i);
    const a = await addGrade({ groupId: g.id, gradeName: "H110", supplierId: ids.sA, datasheetRef: "file:ds-a" }, db);
    const b = await addGrade({ groupId: g.id, gradeName: "PH-12N", supplierId: ids.sB, datasheetRef: "file:ds-b", trialRef: "file:t-b" }, db);
    await expect(addGrade({ groupId: g.id, gradeName: "H110", supplierId: ids.sA, datasheetRef: "x" }, db)).rejects.toThrow(/already in this group/);
    expect(a.status).toBe("PENDING_QA");

    await decideGrade({ gradeId: a.id, decision: "APPROVE_ALL" }, db);
    await decideGrade({ gradeId: b.id, decision: "APPROVE_NON_AUTO" }, db);
    await expect(decideGrade({ gradeId: a.id, decision: "REJECT" }, db)).rejects.toThrow(/already approved/);

    let [view] = await listGroups(db);
    expect(view.grades.map((x) => [x.gradeName, x.rank, x.autoApproved])).toEqual([["H110", 1, true], ["PH-12N", 2, false]]);
    expect(view.warning).toBe("");
    await moveGradeUp(b.id, db);
    [view] = await listGroups(db);
    expect(view.grades.map((x) => x.gradeName)).toEqual(["PH-12N", "H110"]);
  });

  it("derives each grade's stock from lots received from that vendor", async () => {
    const g = await createGroup({ name: "PP", itemId: ids.pp }, db);
    for (const [supplierId, gradeName] of [[ids.sA, "H110"], [ids.sB, "PH-12N"]] as const) {
      const grade = await addGrade({ groupId: g.id, gradeName, supplierId, datasheetRef: "f" }, db);
      await decideGrade({ gradeId: grade.id, decision: "APPROVE_ALL" }, db);
    }
    for (const [supplierId, qty, heat] of [[ids.sA, 880, "H1"], [ids.sB, 550, "P1"]] as const) {
      const po = await createPurchaseOrder({ supplierId, segment: "NON_AUTOMOTIVE", lines: [{ itemId: ids.pp, qty }] }, db);
      const grn = await createGrn({ poId: po.id, vehicleNumber: "V", invoiceNumber: "I", lines: [{ poLineId: po.lines[0].id, qty, supplierLotNo: heat }] }, db);
      const lot = await db.lot.findFirstOrThrow({ where: { grnLine: { grnId: grn.id } } });
      await recordQc({ lotId: lot.id, decision: "APPROVED", putawayLocationCode: "A-01-01" }, db);
    }
    const [view] = await listGroups(db);
    expect(view.onHand).toBe(1430);
    expect(Object.fromEntries(view.grades.map((x) => [x.gradeName, x.stock]))).toEqual({ H110: 880, "PH-12N": 550 });
  });
});

describe("maintenance", () => {
  it("counts shots from the opening counter plus production bookings", async () => {
    const bom = await db.bom.findFirstOrThrow({ where: { mouldId: ids.mouldA } });
    await db.productionBooking.create({ data: { bookingNumber: "PB-1", bomId: bom.id, machineId: ids.big, shift: "A", shots: 49000, goodParts: 1, rejectParts: 0 } });
    const row = (await mouldRows(db)).find((m) => m.code === "MD-A")!;
    expect(row.shots).toBe(50000);
    expect(row.state).toBe("OVERDUE");
  });

  it("completes a PM only with all checks and a photo, then resets the counter", async () => {
    await expect(completePm({ mouldId: ids.mouldA, checks: [...PM_CHECKS].slice(0, 2), photoRef: "p" }, db)).rejects.toThrow(/2 of 5/);
    await expect(completePm({ mouldId: ids.mouldA, checks: [...PM_CHECKS], photoRef: undefined }, db)).rejects.toThrow(/photo/);
    await completePm({ mouldId: ids.mouldA, checks: [...PM_CHECKS], photoRef: "file:pm" }, db);
    const row = (await mouldRows(db)).find((m) => m.code === "MD-A")!;
    expect(row.lastPm).toBe(1000);
    expect(row.left).toBe(50000);
    expect(await db.pmRecord.count()).toBe(1);
  });

  it("logs repairs and rejects an empty description", async () => {
    await expect(logRepair({ mouldId: ids.mouldA, kind: "REPAIR", summary: " " }, db)).rejects.toThrow(/Describe/);
    await logRepair({ mouldId: ids.mouldA, kind: "REPAIR", summary: "Cavity 3 flash", downtimeMin: 25 }, db);
    expect(await db.repairTicket.count()).toBe(1);
  });

  it("works out MTBF and MTTR from breakdowns", async () => {
    const bom = await db.bom.findFirstOrThrow({ where: { mouldId: ids.mouldA } });
    for (const day of ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]) {
      await db.productionBooking.create({ data: { bookingNumber: `PB-${day}`, bomId: bom.id, machineId: ids.big, shift: "A", shots: 100, goodParts: 400, rejectParts: 0, producedAt: new Date(`${day}T08:00:00Z`) } });
    }
    await logDowntime({ machineId: ids.big, day: "2026-10-15", shift: "A", reason: "MACHINE_BREAKDOWN", minutes: 60 }, db);
    await logDowntime({ machineId: ids.big, day: "2026-10-16", shift: "A", reason: "MACHINE_BREAKDOWN", minutes: 100 }, db);
    const m7 = (await machineReliability(30, db, NOW)).find((m) => m.code === "M-07")!;
    // 4 shifts x 480 = 1920 planned - 160 down = 1760 run min = 29.3 h over 2 breakdowns => 15 h; repair 160 / 2 = 80 min
    expect(m7).toMatchObject({ breakdowns: 2, mtbfHours: 15, mttrMin: 80 });
  });
});

describe("planning", () => {
  const monday = parseDay("2026-10-19");

  it("refuses a mould on a press that is too small and a double booking", async () => {
    await expect(placeJob({ machineId: ids.small, day: "2026-10-20", fgItemId: ids.fgA }, db)).rejects.toThrow(/needs at least 150 T/);
    await placeJob({ machineId: ids.big, day: "2026-10-20", fgItemId: ids.fgA }, db);
    await expect(placeJob({ machineId: ids.big, day: "2026-10-20", fgItemId: ids.fgA }, db)).rejects.toThrow(/already booked/);
  });

  it("warns about a colour change from the day before", async () => {
    await placeJob({ machineId: ids.big, day: "2026-10-20", fgItemId: ids.fgA }, db);
    const r = await placeJob({ machineId: ids.big, day: "2026-10-21", fgItemId: ids.fgB }, db);
    expect(r.warning).toMatch(/Colour change Black → Grey/);
    const same = await placeJob({ machineId: ids.big, day: "2026-10-22", fgItemId: ids.fgB }, db);
    expect(same.warning).toBe("");
  });

  it("lists jobs from firm demand less stock and frees a slot again", async () => {
    const cust = await db.customer.create({ data: { code: "C1", name: "Cust", segment: "AUTOMOTIVE" } });
    await db.demandLine.create({ data: { customerId: cust.id, fgItemId: ids.fgA, dueDate: parseDay("2026-10-30"), qty: 40000, type: "FIRM" } });
    await db.demandLine.create({ data: { customerId: cust.id, fgItemId: ids.fgB, dueDate: parseDay("2026-10-30"), qty: 5000, type: "FORECAST" } });
    let week = await planWeek(monday, db, NOW);
    expect(week.jobs.map((j) => j.part)).toEqual(["FG-A"]); // forecast is not planned
    expect(week.jobs[0]).toMatchObject({ days: 3, planned: 0, left: 3, colour: "Black", minTonnage: 150 });

    await placeJob({ machineId: ids.big, day: "2026-10-22", fgItemId: ids.fgA }, db);
    week = await planWeek(monday, db, NOW);
    expect(week.jobs[0].left).toBe(2);
    const slot = week.slots[0];
    await clearSlot(slot.id, db);
    expect((await planWeek(monday, db, NOW)).slots).toHaveLength(0);
    await expect(clearSlot(slot.id, db)).rejects.toThrow(/no longer exists/);
  });

  it("blocks a machine-day for PM", async () => {
    await blockSlot({ machineId: ids.big, day: "2026-10-23", kind: "PM" }, db);
    await expect(placeJob({ machineId: ids.big, day: "2026-10-23", fgItemId: ids.fgA }, db)).rejects.toThrow(/already booked/);
    expect(mondayOf(NOW).toISOString().slice(0, 10)).toBe("2026-10-19");
  });
});

describe("downtime and metrics", () => {
  it("stores a stop and applies the shift-length setting", async () => {
    await expect(logDowntime({ machineId: ids.big, day: "2026-10-20", shift: "B", reason: "POWER_CUT", minutes: 600 }, db)).rejects.toThrow(/480-minute/);
    await setShiftMinutes(720, db);
    expect(await getShiftMinutes(db)).toBe(720);
    await logDowntime({ machineId: ids.big, day: "2026-10-20", shift: "B", reason: "POWER_CUT", minutes: 600 }, db);
    expect(await db.downtime.count()).toBe(1);
    await expect(setShiftMinutes(10, db)).rejects.toThrow(/between 60 and 720/);
  });

  it("computes OEE for a day from bookings and downtime", async () => {
    const bom = await db.bom.findFirstOrThrow({ where: { mouldId: ids.mouldA } });
    // 1000 shots x 20 s = 333.3 min ideal; 48 min down of 480 => A 0.9, P 333.3/432, Q 3900/4000
    await db.productionBooking.create({ data: { bookingNumber: "PB-1", bomId: bom.id, machineId: ids.big, shift: "A", shots: 1000, goodParts: 3900, rejectParts: 100, producedAt: new Date("2026-10-20T09:00:00Z") } });
    await logDowntime({ machineId: ids.big, day: "2026-10-20", shift: "A", reason: "MOULD_CHANGE", minutes: 48 }, db);
    const m = await computeMetrics(db, NOW);
    const daily = m.periods[0];
    const i = daily.labels.indexOf("Tue 20");
    expect(daily.A[i]).toBeCloseTo(0.9, 5);
    expect(daily.Q[i]).toBeCloseTo(0.975, 5);
    expect(daily.P[i]).toBeCloseTo(333.333 / 432, 3);
    expect(daily.pareto).toEqual([["Mould change", 48]]);
    expect(daily.machines.map((x) => x[0])).toEqual(["M-07"]);
    expect(m.hasData).toBe(true);
    expect(m.missingCycle).toEqual([]);
  });

  it("flags a mould with no standard cycle time instead of inventing performance", async () => {
    await db.mould.update({ where: { id: ids.mouldA }, data: { idealCycleSec: null } });
    const bom = await db.bom.findFirstOrThrow({ where: { mouldId: ids.mouldA } });
    await db.productionBooking.create({ data: { bookingNumber: "PB-2", bomId: bom.id, machineId: ids.big, shift: "A", shots: 1000, goodParts: 3900, rejectParts: 100, producedAt: new Date("2026-10-20T09:00:00Z") } });
    const m = await computeMetrics(db, NOW);
    const i = m.periods[0].labels.indexOf("Tue 20");
    expect(m.periods[0].P[i]).toBeNull();
    expect(m.missingCycle).toEqual(["MD-A"]);
  });
});
