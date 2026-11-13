import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { transferStock } from "./inventory";
import { mouldRows, machineReliability } from "./maintenance";
import { logDowntime } from "./downtime";
import { saveBom } from "./production";
import {
  addBin, removeMachine, removeMould, reactivateEquipment, updateMachine, updateMould, removeBin, removeCustomer, removeSupplier, updateCustomer, updateSupplier, removeRack, renameBin, renameRack, renameShelf, createCustomer, createItem, createLocation, createMachine, createMould, createSupplier,
  setActive, updateItem,
} from "./masters";
import { DomainError } from "./inventory";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["ReturnToVendor", "EquivalentGrade", "PurchaseOrder", "ReturnableLedger", "DemandLine", "DispatchLine", "Dispatch", "StockCount", "FgBox", "StockTransaction", "StockBalance", "Lot", "Mould", "Machine", "Customer", "Location", "Warehouse", "PriceMaster", "Item", "Supplier"]) {
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

  it("adds a bin to an existing rack in that rack's warehouse, or starts a new rack in the first warehouse", async () => {
    const a = await db.warehouse.create({ data: { code: "WH-A", name: "A" } });
    const b = await db.warehouse.create({ data: { code: "WH-B", name: "B" } });
    await createLocation({ warehouseId: b.id, rack: "Q", shelf: "1", bin: "1" }, db);
    const more = await addBin({ rack: "q", shelf: "2", bin: "1" }, db);
    expect(more).toMatchObject({ code: "Q-2-1", warehouseId: b.id, type: "STORAGE" });
    const fresh = await addBin({ rack: "R", shelf: "1", bin: "1" }, db);
    expect(fresh).toMatchObject({ code: "R-1-1", warehouseId: a.id });
    await expect(addBin({ rack: "R", shelf: "1", bin: "1" }, db)).rejects.toThrow(/already exists/);
    await expect(addBin({ rack: "stg", shelf: "1", bin: "1" }, db)).rejects.toThrow(/staging/);
    await expect(addBin({ rack: "", shelf: "1", bin: "1" }, db)).rejects.toBeInstanceOf(DomainError);
  });

  describe("customers and suppliers: edit and remove", () => {
    it("updates a customer and clears optional fields that are blanked out", async () => {
      const c = await createCustomer({ code: "c1", name: "Apex", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "27AAAAA0000A1Z5", address: "Pune" }, db);
      const u = await updateCustomer(c.id, { code: "C1", name: "Apex Motors", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC", gstin: "", address: "" }, db);
      expect(u).toMatchObject({ name: "Apex Motors", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC", gstin: null, address: null });
      await expect(updateCustomer(c.id, { code: "C1", name: "Xylem Ltd", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "nope" }, db)).rejects.toThrow(/GSTIN/);
    });

    it("deletes a supplier that was never used, along with its price list rows", async () => {
      const s = await createSupplier({ code: "s1", name: "Poly", leadTimeDays: 5 }, db);
      const it = await createItem(item({ code: "rm-a" }), db);
      await db.priceMaster.create({ data: { itemId: it.id, supplierId: s.id, price: 10 } });
      await expect(removeSupplier(s.id, db)).resolves.toBe("deleted");
      expect(await db.supplier.findUnique({ where: { id: s.id } })).toBeNull();
      expect(await db.priceMaster.count()).toBe(0);
      await expect(removeSupplier(s.id, db)).rejects.toThrow(/doesn't exist/);
    });

    it("deactivates a supplier with order history, but refuses while a PO is open", async () => {
      const s = await createSupplier({ code: "s2", name: "Poly", leadTimeDays: 5 }, db);
      const po = await db.purchaseOrder.create({ data: { poNumber: "PO-1", supplierId: s.id, segment: "NON_AUTOMOTIVE", status: "APPROVED" } });
      await expect(removeSupplier(s.id, db)).rejects.toThrow(/1 open PO/);
      await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "CLOSED" } });
      await expect(removeSupplier(s.id, db)).resolves.toBe("deactivated");
      expect(await db.supplier.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ active: false });
      await expect(removeSupplier(s.id, db)).rejects.toThrow(/already inactive/);
      await setActive("supplier", s.id, true, db);
      expect((await db.supplier.findUniqueOrThrow({ where: { id: s.id } })).active).toBe(true);
      await expect(updateSupplier(s.id, { code: "s2", name: "Poly Chem", leadTimeDays: 9 }, db)).resolves.toMatchObject({ name: "Poly Chem", leadTimeDays: 9 });
    });

    it("deletes an unused customer, deactivates one with history, and refuses while a dispatch is loading", async () => {
      const a = await createCustomer({ code: "ca", name: "Alpha Auto", segment: "AUTOMOTIVE", labelFormat: "OEM" }, db);
      await expect(removeCustomer(a.id, db)).resolves.toBe("deleted");
      expect(await db.customer.findUnique({ where: { id: a.id } })).toBeNull();

      const b = await createCustomer({ code: "cb", name: "Beta Parts", segment: "AUTOMOTIVE", labelFormat: "OEM" }, db);
      const d = await db.dispatch.create({ data: { dcNumber: "DC-1", customerId: b.id, vehicleNumber: "MH12", status: "LOADING" } });
      await expect(removeCustomer(b.id, db)).rejects.toThrow(/being loaded/);
      await db.dispatch.update({ where: { id: d.id }, data: { status: "DISPATCHED" } });
      await expect(removeCustomer(b.id, db)).resolves.toBe("deactivated");
      expect((await db.customer.findUniqueOrThrow({ where: { id: b.id } })).active).toBe(false);
    });
  });

  describe("machines and moulds: edit and remove", () => {
    const day = (offset: number) => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime() + offset * 86_400_000;

    it("edits details but never the code, and only fits a mould to a machine that is in service", async () => {
      const m = await createMachine({ code: "imm-1", name: "90T", tonnage: "90" }, db);
      expect(await updateMachine(m.id, { code: "SOMETHING-ELSE", name: "90T press", tonnage: "" }, db)).toMatchObject({ code: "IMM-1", name: "90T press", tonnage: null });
      const mould = await createMould({ code: "mld-1", name: "Clip", cavities: "4", shotWeightG: "38.5", runnerWeightG: "6", machineId: m.id }, db);
      const u = await updateMould(mould.id, { code: "xx", name: "Clip v2", cavities: "8", shotWeightG: "", runnerWeightG: "7.5", machineId: "" }, db);
      expect(u).toMatchObject({ code: "MLD-1", name: "Clip v2", cavities: 8, shotWeightG: null, machineId: null });
      expect(Number(u.runnerWeightG)).toBe(7.5);
      await db.machine.update({ where: { id: m.id }, data: { active: false } });
      await expect(updateMould(mould.id, { code: "MLD-1", name: "Clip", cavities: "4", machineId: m.id }, db)).rejects.toThrow(/still in service/);
      await expect(createMould({ code: "mld-2", name: "Other", cavities: "1", machineId: m.id }, db)).rejects.toThrow(/still in service/);
    });

    it("deletes equipment that was never used, and retires equipment with history", async () => {
      const fresh = await createMachine({ code: "imm-a", name: "Fresh" }, db);
      await expect(removeMachine(fresh.id, db)).resolves.toBe("deleted");
      expect(await db.machine.findUnique({ where: { id: fresh.id } })).toBeNull();
      await expect(removeMachine(fresh.id, db)).rejects.toThrow(/doesn't exist/);

      const used = await createMachine({ code: "imm-b", name: "Used" }, db);
      const mould = await createMould({ code: "mld-b", name: "Fitted", cavities: "2", machineId: used.id }, db);
      await db.downtime.create({ data: { machineId: used.id, day: new Date(day(-3)), shift: "A", reason: "MACHINE_BREAKDOWN", minutes: 30 } });
      await expect(removeMachine(used.id, db)).resolves.toBe("deactivated");
      expect(await db.machine.findUniqueOrThrow({ where: { id: used.id } })).toMatchObject({ active: false });
      expect((await db.mould.findUniqueOrThrow({ where: { id: mould.id } })).machineId).toBeNull(); // its mould is set free
      await expect(removeMachine(used.id, db)).rejects.toThrow(/already retired/);
      await reactivateEquipment("machine", used.id, db);
      expect((await db.machine.findUniqueOrThrow({ where: { id: used.id } })).active).toBe(true);

      await db.repairTicket.create({ data: { mouldId: mould.id, summary: "Polished" } });
      await expect(removeMould(mould.id, db)).resolves.toBe("deactivated");
      expect((await db.mould.findUniqueOrThrow({ where: { id: mould.id } })).active).toBe(false);
      await reactivateEquipment("mould", mould.id, db);
      await expect(reactivateEquipment("mould", "nope", db)).rejects.toThrow(/doesn't exist/);
    });

    it("won't remove a mould a BOM uses, or any equipment with plan days coming up", async () => {
      const m = await createMachine({ code: "imm-c", name: "Planned" }, db);
      const mould = await createMould({ code: "mld-c", name: "On a BOM", cavities: "2", machineId: m.id }, db);
      const fg = await db.item.create({ data: { code: "FG-EQ", name: "Eq part", category: "FG", uom: "NOS" } });
      const rm = await db.item.create({ data: { code: "RM-EQ", name: "Eq resin", category: "RM_RESIN", uom: "KG" } });
      await saveBom({ fgItemId: fg.id, mouldId: mould.id, partWeightG: 10, lines: [{ itemId: rm.id, kind: "RESIN", pct: 100 }] }, db);
      await expect(removeMould(mould.id, db)).rejects.toThrow(/used by the BOM for FG-EQ/);

      const other = await createMould({ code: "mld-d", name: "Planned mould", cavities: "1" }, db);
      await db.planSlot.create({ data: { machineId: m.id, day: new Date(day(2)), kind: "JOB", mouldId: other.id } });
      await expect(removeMachine(m.id, db)).rejects.toThrow(/1 planned day coming up/);
      await expect(removeMould(other.id, db)).rejects.toThrow(/1 planned day coming up/);
      await db.planSlot.deleteMany();
      await db.planSlot.create({ data: { machineId: m.id, day: new Date(day(-5)), kind: "JOB", mouldId: other.id } }); // a past plan is only history
      await expect(removeMould(other.id, db)).resolves.toBe("deactivated");
      await expect(removeMachine(m.id, db)).resolves.toBe("deactivated");
    });

    it("keeps retired equipment out of the lists and out of new records, but not out of history", async () => {
      const m = await createMachine({ code: "imm-e", name: "Old press" }, db);
      const live = await createMachine({ code: "imm-f", name: "Live press" }, db);
      const mould = await createMould({ code: "mld-e", name: "Old mould", cavities: "1" }, db);
      await db.downtime.create({ data: { machineId: m.id, day: new Date(day(-2)), shift: "A", reason: "NO_PLAN", minutes: 10 } });
      await db.repairTicket.create({ data: { mouldId: mould.id, summary: "Old repair" } });
      await removeMachine(m.id, db); await removeMould(mould.id, db);

      expect((await mouldRows(db)).map((r) => r.code)).not.toContain("MLD-E");
      expect((await mouldRows(db, { includeRetired: true })).map((r) => r.code)).toContain("MLD-E");
      expect((await machineReliability(30, db)).map((r) => r.code)).toEqual(["IMM-F"]);
      await expect(logDowntime({ machineId: m.id, day: new Date(day(0)).toISOString().slice(0, 10), shift: "A", reason: "NO_PLAN", minutes: 15 }, db)).rejects.toThrow(/in service/);
      await expect(logDowntime({ machineId: live.id, day: new Date(day(0)).toISOString().slice(0, 10), shift: "A", reason: "NO_PLAN", minutes: 15 }, db)).resolves.toBeTruthy();
      expect(await db.repairTicket.count({ where: { mouldId: mould.id } })).toBe(1); // history is still there
    });
  });

  describe("editing the layout", () => {
    let wh: string;
    const mk = async (rack: string, shelf: string, bin: string, type: "STORAGE" | "STAGING" = "STORAGE") =>
      db.location.create({ data: { code: `${rack}-${shelf}-${bin}`, rack, shelf, bin, type, warehouseId: wh } });
    // puts qty of a lot into a bin the way the app does: a balance row and a ledger row
    const stock = async (locationId: string, qty: number) => {
      const it = (await db.item.findFirst()) ?? (await db.item.create({ data: { code: "RM-X", name: "X", category: "RM_RESIN" } }));
      const lot = await db.lot.create({ data: { lotNumber: `L-${Math.random().toString(36).slice(2, 8)}`, itemId: it.id, supplierLotNo: "S", receivedQty: qty, qcStatus: "APPROVED" } });
      await db.stockBalance.create({ data: { lotId: lot.id, locationId, qty } });
      await db.stockTransaction.create({ data: { type: "GRN_IN", lotId: lot.id, locationId, qty } });
      return lot;
    };
    beforeEach(async () => { wh = (await db.warehouse.create({ data: { code: "WH", name: "Main" } })).id; });

    it("deletes a bin that was never used", async () => {
      const b = await mk("A", "1", "1");
      await removeBin(b.id, db);
      expect(await db.location.findUnique({ where: { id: b.id } })).toBeNull();
    });

    it("only hides a bin that has history, and adding the same code again brings it back", async () => {
      const b = await mk("A", "1", "1");
      const lot = await stock(b.id, 10);
      await expect(removeBin(b.id, db)).rejects.toThrow(/still holds stock/);
      await db.stockBalance.updateMany({ where: { lotId: lot.id }, data: { qty: 0 } });
      await removeBin(b.id, db);
      expect(await db.location.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ active: false });
      expect(await db.stockTransaction.count({ where: { locationId: b.id } })).toBe(1); // the ledger still points at it
      await expect(removeBin(b.id, db)).rejects.toThrow(/doesn't exist/);
      const back = await addBin({ rack: "a", shelf: "1", bin: "1" }, db);
      expect(back.id).toBe(b.id);
      expect(back.active).toBe(true);
    });

    it("won't remove a bin with labelled boxes or a count in progress, or the staging area", async () => {
      const b = await mk("A", "1", "1");
      const c = await mk("A", "1", "2");
      const stg = await mk("STG", "01", "01", "STAGING");
      const it = await db.item.create({ data: { code: "FG-1", name: "FG", category: "FG" } });
      const lot = await db.lot.create({ data: { lotNumber: "L-FG", itemId: it.id, supplierLotNo: "S", receivedQty: 5, qcStatus: "APPROVED" } });
      const cust = await db.customer.create({ data: { code: "C", name: "C", segment: "AUTOMOTIVE", labelFormat: "OEM" } });
      await db.fgBox.create({ data: { boxCode: "BX-1", lotId: lot.id, customerId: cust.id, locationId: b.id, qty: 5, producedDate: new Date() } });
      await expect(removeBin(b.id, db)).rejects.toThrow(/holds stock/);
      await db.stockCount.create({ data: { countNumber: "SC-1", locationId: c.id } });
      await expect(removeBin(c.id, db)).rejects.toThrow(/count in progress/);
      await expect(removeBin(stg.id, db)).rejects.toThrow(/staging/);
    });

    it("removes a whole rack only when every bin in it is empty", async () => {
      const a = await mk("R", "1", "1"); await mk("R", "1", "2"); const c = await mk("R", "2", "1");
      await stock(c.id, 4);
      await expect(removeRack("r", db)).rejects.toThrow(/R-2-1 is not empty/);
      expect(await db.location.count({ where: { rack: "R" } })).toBe(3); // nothing was removed
      await db.stockBalance.updateMany({ where: { locationId: c.id }, data: { qty: 0 } });
      expect(await removeRack("R", db)).toBe(3);
      expect(await db.location.count({ where: { rack: "R", active: true } })).toBe(0);
      expect(await db.location.findUnique({ where: { id: a.id } })).toBeNull(); // never used: really deleted
      expect(await db.location.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ active: false }); // had history: hidden
      await expect(removeRack("R", db)).rejects.toThrow(/doesn't exist/);
      await mk("STG", "01", "01", "STAGING");
      await expect(removeRack("STG", db)).rejects.toThrow(/staging/);
    });

    it("renames a bin, a shelf or a rack and rebuilds the scan codes, leaving stock where it is", async () => {
      const a = await mk("A", "1", "1"); await mk("A", "1", "2"); await mk("A", "2", "1");
      const lot = await stock(a.id, 7);
      await renameBin(a.id, "x", db);
      expect((await db.location.findUniqueOrThrow({ where: { id: a.id } })).code).toBe("A-1-X");
      expect(Number((await db.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } })).qty)).toBe(7);
      expect(await renameShelf("A", "1", "top", db)).toBe(2);
      expect((await db.location.findMany({ where: { rack: "A" }, orderBy: { code: "asc" } })).map((l) => l.code)).toEqual(["A-2-1", "A-TOP-2", "A-TOP-X"]);
      expect(await renameRack("A", "m", db)).toBe(3);
      expect((await db.location.findMany({ orderBy: { code: "asc" } })).map((l) => l.code)).toEqual(["M-2-1", "M-TOP-2", "M-TOP-X"]);
      expect((await db.location.findUniqueOrThrow({ where: { id: a.id } })).rack).toBe("M");
    });

    it("refuses a rename that would clash, change nothing, or touch staging", async () => {
      const a = await mk("A", "1", "1"); await mk("A", "1", "2"); await mk("B", "1", "1");
      await expect(renameBin(a.id, "2", db)).rejects.toThrow(/A-1-2 already exists/);
      await expect(renameBin(a.id, "1", db)).rejects.toThrow(/already the name/);
      await expect(renameRack("A", "B", db)).rejects.toThrow(/Rack B already exists/);
      await expect(renameShelf("A", "9", "3", db)).rejects.toThrow(/doesn't exist/);
      await expect(renameBin(a.id, "", db)).rejects.toThrow(/1 to 10 characters/);
      await mk("STG", "01", "01", "STAGING");
      await expect(renameRack("STG", "Z", db)).rejects.toThrow(/staging/);
      await expect(renameRack("A", "stg", db)).rejects.toThrow(/staging/);
      // a removed bin still owns its code, and the message says so
      const gone = await mk("C", "1", "1"); await stock(gone.id, 1);
      await db.stockBalance.updateMany({ where: { locationId: gone.id }, data: { qty: 0 } });
      await removeBin(gone.id, db);
      await expect(renameBin(a.id, "x", db)).resolves.toBeTruthy();
      await expect(renameRack("B", "C", db)).rejects.toThrow(/Rack C already exists/);
    });

    it("keeps removed bins out of stock moves", async () => {
      const a = await mk("A", "1", "1"); const b = await mk("A", "1", "2");
      const lot = await stock(a.id, 5);
      await db.stockBalance.updateMany({ where: { locationId: b.id }, data: { qty: 0 } });
      await removeBin(b.id, db); // never used, so deleted
      await expect(transferStock({ lotNumber: lot.lotNumber, fromCode: "A-1-1", toCode: "A-1-2", qty: 1 }, db)).rejects.toThrow(/Unknown bin/);
      const c = await mk("A", "1", "3"); await stock(c.id, 1);
      await db.stockBalance.updateMany({ where: { locationId: c.id }, data: { qty: 0 } });
      await removeBin(c.id, db); // had history, so hidden
      await expect(transferStock({ lotNumber: lot.lotNumber, fromCode: "A-1-1", toCode: "A-1-3", qty: 1 }, db)).rejects.toThrow(/Unknown bin/);
    });
  });

  it("refuses a bin when there is no warehouse", async () => {
    await expect(addBin({ rack: "Z", shelf: "1", bin: "1" }, db)).rejects.toThrow(/No warehouse/);
  });

  it("creates machines and moulds, linking a mould to a machine", async () => {
    const m = await createMachine({ code: "imm-9", name: "90T", tonnage: "90" }, db);
    const mould = await createMould({ code: "mld-9", name: "Clip", cavities: "4", shotWeightG: "38.5", machineId: m.id }, db);
    expect(mould.machineId).toBe(m.id);
    expect(mould.cavities).toBe(4);
    await expect(createMould({ code: "mld-x", name: "Bad", cavities: "0" }, db)).rejects.toBeInstanceOf(DomainError);
  });
});
