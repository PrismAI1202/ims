import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cancelPurchaseOrder, closePurchaseOrderShort, updatePurchaseOrder } from "./purchase";
import { changeOwnPassword, checkPassword, createUser, resetPassword, updateUser } from "./users";
import { createGrn, createPurchaseOrder } from "./inventory";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });
afterAll(() => db.$disconnect());

let ids: Record<string, string>;

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of [
    "ApiToken", "User", "QcInspection", "StockTransaction", "StockBalance", "Lot", "GrnLine", "Grn", "GateEntry",
    "PurchaseOrderLine", "PurchaseOrder", "PriceMaster", "Supplier", "Location", "Warehouse", "Item",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  await db.location.create({ data: { code: "STG", rack: "S", shelf: "1", bin: "1", type: "STAGING", warehouseId: wh.id } });
  ids = {
    sup: (await db.supplier.create({ data: { code: "S1", name: "Sup", leadTimeDays: 5 } })).id,
    a: (await db.item.create({ data: { code: "A", name: "A", category: "BOP", uom: "NOS" } })).id,
    b: (await db.item.create({ data: { code: "B", name: "B", category: "BOP", uom: "NOS" } })).id,
    off: (await db.item.create({ data: { code: "OFF", name: "Off", category: "BOP", active: false } })).id,
  };
});

const newPo = () => createPurchaseOrder({ supplierId: ids.sup, segment: "NON_AUTOMOTIVE", lines: [{ itemId: ids.a, qty: 100, price: 5 }] }, db);

describe("purchase orders: edit, cancel, close short", () => {
  it("edits an untouched PO, replacing its lines", async () => {
    const po = await newPo();
    const edited = await updatePurchaseOrder(po.id, [{ itemId: ids.a, qty: 150, price: 6 }, { itemId: ids.b, qty: 20, price: 2 }], db);
    expect(edited.lines).toHaveLength(2);
    expect(await db.purchaseOrderLine.count({ where: { poId: po.id } })).toBe(2);
    expect(Number(edited.lines.find((l) => l.itemId === ids.a)!.qty)).toBe(150);
  });

  it("validates edits: lines, quantities, duplicates and inactive items", async () => {
    const po = await newPo();
    await expect(updatePurchaseOrder(po.id, [], db)).rejects.toThrow(/at least one/);
    await expect(updatePurchaseOrder(po.id, [{ itemId: ids.a, qty: 0, price: 1 }], db)).rejects.toThrow(/above 0/);
    await expect(updatePurchaseOrder(po.id, [{ itemId: ids.a, qty: 1, price: -1 }], db)).rejects.toThrow(/negative/);
    await expect(updatePurchaseOrder(po.id, [{ itemId: ids.a, qty: 1, price: 1 }, { itemId: ids.a, qty: 2, price: 1 }], db)).rejects.toThrow(/once/);
    await expect(updatePurchaseOrder(po.id, [{ itemId: ids.off, qty: 1, price: 1 }], db)).rejects.toThrow(/inactive/);
    expect(await db.purchaseOrderLine.count({ where: { poId: po.id } })).toBe(1); // untouched after the failures
  });

  it("can't edit or cancel once goods are received; close short instead", async () => {
    const po = await newPo();
    await createGrn({ poId: po.id, vehicleNumber: "V", invoiceNumber: "I", lines: [{ poLineId: po.lines[0].id, qty: 40, supplierLotNo: "L1" }] }, db);
    await expect(updatePurchaseOrder(po.id, [{ itemId: ids.a, qty: 1, price: 1 }], db)).rejects.toThrow(/can't be edited|can no longer be edited/);
    await expect(cancelPurchaseOrder(po.id, db)).rejects.toThrow(/Close short/);
    expect((await closePurchaseOrderShort(po.id, db)).status).toBe("CLOSED");
    await expect(createGrn({ poId: po.id, vehicleNumber: "V", invoiceNumber: "I", lines: [{ poLineId: po.lines[0].id, qty: 10, supplierLotNo: "L2" }] }, db)).rejects.toThrow(/CLOSED/);
  });

  it("cancels an untouched PO once, and a cancelled PO can't be received against", async () => {
    const po = await newPo();
    expect((await cancelPurchaseOrder(po.id, db)).status).toBe("CANCELLED");
    await expect(cancelPurchaseOrder(po.id, db)).rejects.toThrow(/already cancelled/);
    await expect(closePurchaseOrderShort(po.id, db)).rejects.toThrow(/partly received/);
    await expect(updatePurchaseOrder(po.id, [{ itemId: ids.a, qty: 1, price: 1 }], db)).rejects.toThrow(/cancelled/);
    await expect(createGrn({ poId: po.id, vehicleNumber: "V", invoiceNumber: "I", lines: [{ poLineId: po.lines[0].id, qty: 1, supplierLotNo: "L" }] }, db)).rejects.toThrow(/CANCELLED/);
  });
});

describe("password rules", () => {
  it("rejects short, repeated, common and email-equal passwords", () => {
    expect(checkPassword("short1")).toMatch(/at least 8/);
    expect(checkPassword("aaaaaaaaaa")).toMatch(/repeated/);
    expect(checkPassword("Password123")).toMatch(/too common/);
    expect(checkPassword("me@plant.local", "me@plant.local")).toMatch(/same as the email/);
    expect(checkPassword("x".repeat(101))).toMatch(/too long/);
  });
  it("accepts a reasonable passphrase", () => expect(checkPassword("Blue-Mould-42!")).toBeNull());
});

describe("user management", () => {
  const mk = (over: Record<string, unknown> = {}) => createUser({ email: "Ops@Plant.Local ", name: "Ops One", role: "STORE_INCHARGE", password: "Blue-Mould-42!", ...over }, db);

  it("creates a user with a lower-cased email and a hashed password", async () => {
    const u = await mk();
    expect(u.email).toBe("ops@plant.local");
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.passwordHash).not.toContain("Blue-Mould");
    expect(await bcrypt.compare("Blue-Mould-42!", row.passwordHash)).toBe(true);
  });

  it("rejects duplicates, bad emails, bad roles and weak passwords", async () => {
    await mk();
    await expect(mk()).rejects.toThrow(/already exists/);
    await expect(mk({ email: "nope" })).rejects.toThrow(/valid email/);
    await expect(mk({ email: "b@plant.local", role: "GOD" })).rejects.toThrow(/role/);
    await expect(mk({ email: "c@plant.local", password: "short" })).rejects.toThrow(/at least 8/);
    expect(await db.user.count()).toBe(1);
  });

  it("protects the last active admin and your own account", async () => {
    const admin = await mk({ email: "admin@plant.local", role: "ADMIN" });
    await expect(updateUser(admin.id, admin.id, { name: "Admin", role: "ADMIN", active: false }, db)).rejects.toThrow(/own account/);
    const other = await mk({ email: "o@plant.local", role: "ADMIN" });
    // two admins: demoting one is fine
    await updateUser(other.id, admin.id, { name: "Other", role: "QA_INSPECTOR", active: true }, db);
    // now only one admin is left, so nobody can demote or deactivate them
    await expect(updateUser(admin.id, other.id, { name: "Admin", role: "STORE_INCHARGE", active: true }, db)).rejects.toThrow(/at least one active admin/);
    await expect(updateUser(admin.id, other.id, { name: "Admin", role: "ADMIN", active: false }, db)).rejects.toThrow(/at least one active admin/);
  });

  it("deactivated users can be re-activated and roles changed", async () => {
    const admin = await mk({ email: "admin@plant.local", role: "ADMIN" });
    const u = await mk();
    await updateUser(u.id, admin.id, { name: "Ops One", role: "QA_INSPECTOR", active: false }, db);
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ role: "QA_INSPECTOR", active: false });
    await updateUser(u.id, admin.id, { name: "Ops One", role: "QA_INSPECTOR", active: true }, db);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).active).toBe(true);
  });

  it("reset replaces the password and revokes device tokens", async () => {
    const u = await mk();
    await db.apiToken.create({ data: { userId: u.id, label: "scanner", tokenHash: "h1" } });
    await expect(resetPassword(u.id, "weak", db)).rejects.toThrow(/at least 8/);
    await resetPassword(u.id, "New-Resin-77!", db);
    expect(await bcrypt.compare("New-Resin-77!", (await db.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);
    expect(await db.apiToken.count({ where: { userId: u.id } })).toBe(0);
  });

  it("changing your own password needs the current one", async () => {
    const u = await mk();
    await expect(changeOwnPassword(u.id, "wrong-one-1", "New-Resin-77!", db)).rejects.toThrow(/current password is wrong/);
    await expect(changeOwnPassword(u.id, "Blue-Mould-42!", "Blue-Mould-42!", db)).rejects.toThrow(/different/);
    await changeOwnPassword(u.id, "Blue-Mould-42!", "New-Resin-77!", db);
    expect(await bcrypt.compare("New-Resin-77!", (await db.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);
  });
});
