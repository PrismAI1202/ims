import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decideFirstOff, hasApprovedFirstOff, requestFirstOff } from "./firstoff";
import { bookProduction, saveBom } from "./production";
import { setRule } from "./settings";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(async () => { await setRule("requireFirstOff", false, db); await db.$disconnect(); });

let ids: Record<string, string>;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["FirstOff", "BookingConsumption", "ProductionBooking", "BomLine", "Bom", "StockTransaction", "StockBalance", "Lot", "Mould", "Machine", "Location", "Warehouse", "Item"])
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  await setRule("requireFirstOff", false, db);
  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "1", bin: "1", type: "STORAGE", warehouseId: wh.id } });
  const machine = await db.machine.create({ data: { code: "IMM-1", name: "90T" } });
  const mould = await db.mould.create({ data: { code: "MLD-1", name: "Clip", cavities: 4, runnerWeightG: 8 } });
  const fg = await db.item.create({ data: { code: "FG-CLIP", name: "Clip", category: "FG", uom: "NOS" } });
  const pp = await db.item.create({ data: { code: "RM-PP", name: "PP", category: "RM_RESIN", polymerGrade: "PP" } });
  const bom = await saveBom({ fgItemId: fg.id, mouldId: mould.id, partWeightG: 10, lines: [{ itemId: pp.id, kind: "RESIN", pct: 100 }] }, db);
  ids = { machine: machine.id, bom: bom.id };
});

const book = (shift: "A" | "B" = "A") => bookProduction({ bomId: ids.bom, machineId: ids.machine, shift, shots: 100, goodParts: 380, rejectParts: 20 }, db);

describe("first-off approval", () => {
  it("is not enforced until the plant rule is on", async () => {
    await expect(book()).resolves.toBeTruthy();
  });

  it("blocks booking until QA approves that machine, part and shift", async () => {
    await setRule("requireFirstOff", true, db);
    await expect(book()).rejects.toThrow(/No approved first-off for IMM-1 · FG-CLIP · shift A/);

    const f = await requestFirstOff({ machineId: ids.machine, bomId: ids.bom, shift: "A", note: "New mould set-up", userId: "prod" }, db);
    await expect(requestFirstOff({ machineId: ids.machine, bomId: ids.bom, shift: "A" }, db)).rejects.toThrow(/already waiting/);
    await expect(book()).rejects.toThrow(/No approved first-off/); // still pending

    await expect(decideFirstOff({ id: f.id, approve: false }, db)).rejects.toThrow(/what is wrong/);
    await decideFirstOff({ id: f.id, approve: true, userId: "qa" }, db);
    await expect(decideFirstOff({ id: f.id, approve: true }, db)).rejects.toThrow(/already been decided/);

    await expect(book("A")).resolves.toBeTruthy();
    await expect(book("B")).rejects.toThrow(/shift B/); // approval is per shift
  });

  it("a rejection doesn't unlock booking, and an approval lapses after 24 hours", async () => {
    await setRule("requireFirstOff", true, db);
    const f = await requestFirstOff({ machineId: ids.machine, bomId: ids.bom, shift: "A" }, db);
    await decideFirstOff({ id: f.id, approve: false, note: "Short shots" }, db);
    expect(await hasApprovedFirstOff(ids.machine, ids.bom, "A", db)).toBe(false);

    const g = await requestFirstOff({ machineId: ids.machine, bomId: ids.bom, shift: "A" }, db);
    await decideFirstOff({ id: g.id, approve: true }, db);
    expect(await hasApprovedFirstOff(ids.machine, ids.bom, "A", db)).toBe(true);
    expect(await hasApprovedFirstOff(ids.machine, ids.bom, "A", db, new Date(Date.now() + 25 * 3_600_000))).toBe(false);
  });
});
