import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCustomer, createItem, createLocation, createMachine, createMould, createSupplier,
  setActive, updateItem,
} from "./masters";
import { DomainError } from "./inventory";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["Mould", "Machine", "Customer", "Location", "Warehouse", "PriceMaster", "Item", "Supplier"]) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  }
});
afterAll(() => db.$disconnect());

const item = (over: Record<string, unknown> = {}) => ({
  code: "rm-pp-9", name: "PP Test", category: "RM_RESIN", uom: "kg",
  minStock: "100", reorderPoint: "200", maxStock: "1000", ...over,
});

describe("items", () => {
  it("normalises codes/units and stores numbers from form strings", async () => {
    const i = await createItem(item(), db);
    expect(i.code).toBe("RM-PP-9");
    expect(i.uom).toBe("KG");
    expect(Number(i.reorderPoint)).toBe(200);
    expect(i.requiresCoa).toBe(false);
  });

  it("rejects a duplicate code with a friendly message", async () => {
    await createItem(item(), db);
    await expect(createItem(item(), db)).rejects.toThrow(/already exists/);
  });

  it("enforces Min <= ROP <= Max", async () => {
    await expect(createItem(item({ reorderPoint: "50" }), db)).rejects.toThrow(/Reorder point/);
    await expect(createItem(item({ maxStock: "150" }), db)).rejects.toThrow(/Maximum/);
    await expect(createItem(item({ maxStock: "0" }), db)).resolves.toBeTruthy(); // 0 = no max set
  });

  it("rejects bad input as DomainError, not a crash", async () => {
    await expect(createItem(item({ code: "bad code!" }), db)).rejects.toBeInstanceOf(DomainError);
    await expect(createItem(item({ category: "NOPE" }), db)).rejects.toBeInstanceOf(DomainError);
    await expect(createItem(item({ minStock: "-1" }), db)).rejects.toBeInstanceOf(DomainError);
  });

  it("updates levels and can deactivate instead of deleting", async () => {
    const i = await createItem(item(), db);
    const u = await updateItem(i.id, item({ reorderPoint: "300" }), db);
    expect(Number(u.reorderPoint)).toBe(300);
    await setActive("item", i.id, false, db);
    expect((await db.item.findUniqueOrThrow({ where: { id: i.id } })).active).toBe(false);
  });

  it("treats blank optional numbers as not set, not as 0", async () => {
    const i = await createItem(item({ maxRegrindPct: "", shelfLifeDays: "", polymerGrade: "" }), db);
    expect(i.maxRegrindPct).toBeNull(); // 0 would wrongly mean "no regrind allowed"
    expect(i.shelfLifeDays).toBeNull();
    expect(i.polymerGrade).toBeNull();
    const z = await createItem(item({ code: "rm-z", maxRegrindPct: "0" }), db);
    expect(Number(z.maxRegrindPct)).toBe(0); // an explicit 0 is still honoured
  });

  it("clears a field on update when the form field is blanked", async () => {
    const i = await createItem(item({ maxRegrindPct: "25", shelfLifeDays: "90", polymerGrade: "PP" }), db);
    const u = await updateItem(i.id, item({ maxRegrindPct: "", shelfLifeDays: "", polymerGrade: "" }), db);
    expect(u.maxRegrindPct).toBeNull();
    expect(u.shelfLifeDays).toBeNull();
    expect(u.polymerGrade).toBeNull();
  });

  it("treats blank machine tonnage and mould weights as not set", async () => {
    const m = await createMachine({ code: "imm-b", name: "Blank", tonnage: "" }, db);
    expect(m.tonnage).toBeNull();
    const mould = await createMould({ code: "mld-b", name: "Blank", cavities: "2", shotWeightG: "", runnerWeightG: "" }, db);
    expect(mould.shotWeightG).toBeNull();
    expect(mould.runnerWeightG).toBeNull();
  });

  it("takes optional COA flag and regrind limit", async () => {
    const i = await createItem(item({ requiresCoa: "on", maxRegrindPct: "25", shelfLifeDays: "365" }), db);
    expect(i.requiresCoa).toBe(true);
    expect(Number(i.maxRegrindPct)).toBe(25);
    expect(i.shelfLifeDays).toBe(365);
  });
});

describe("other masters", () => {
  it("creates suppliers and customers with validation", async () => {
    const s = await createSupplier({ code: "sup-1", name: "Poly Co", leadTimeDays: "12" }, db);
    expect(s.leadTimeDays).toBe(12);
    await expect(createSupplier({ code: "sup-1", name: "Dup", leadTimeDays: "1" }, db)).rejects.toThrow(/already exists/);
    const c = await createCustomer({ code: "c1", name: "Apex", segment: "AUTOMOTIVE", labelFormat: "OEM" }, db);
    expect(c.segment).toBe("AUTOMOTIVE");
    await expect(createCustomer({ code: "c2", name: "X", segment: "OTHER", labelFormat: "OEM" }, db)).rejects.toBeInstanceOf(DomainError);
  });

  it("derives the bin code from rack-shelf-bin and blocks duplicates", async () => {
    const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
    const loc = await createLocation({ warehouseId: wh.id, rack: "d", shelf: "1", bin: "2" }, db);
    expect(loc.code).toBe("D-1-2");
    expect(loc.type).toBe("STORAGE");
    await expect(createLocation({ warehouseId: wh.id, rack: "D", shelf: "1", bin: "2" }, db)).rejects.toThrow(/already exists/);
  });

  it("creates machines and moulds, linking a mould to a machine", async () => {
    const m = await createMachine({ code: "imm-9", name: "90T", tonnage: "90" }, db);
    const mould = await createMould({ code: "mld-9", name: "Clip", cavities: "4", shotWeightG: "38.5", machineId: m.id }, db);
    expect(mould.machineId).toBe(m.id);
    expect(mould.cavities).toBe(4);
    await expect(createMould({ code: "mld-x", name: "Bad", cavities: "0" }, db)).rejects.toBeInstanceOf(DomainError);
  });
});
