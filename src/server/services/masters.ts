import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { db as defaultDb } from "@/server/db";
import {
  binPart, customerSchema, itemSchema, locationSchema, machineSchema, mouldSchema, supplierSchema,
} from "@/lib/schemas/masters";
import { DomainError } from "./inventory";

type Db = PrismaClient;

// Turns zod and unique-constraint failures into messages the form can show.
function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    // Our own refine() messages already read as sentences; built-in zod ones need the field name for context.
    const field = String(first.path[0] ?? "").replace(/([A-Z])/g, " $1").toLowerCase();
    throw new DomainError(first.code === "custom" || !field ? first.message : `${field[0].toUpperCase()}${field.slice(1)}: ${first.message}`);
  }
  return r.data;
}

async function guarded<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError(`${what} already exists with that code.`);
    }
    throw e;
  }
}

export async function createItem(raw: unknown, db: Db = defaultDb) {
  const v = parse(itemSchema, raw);
  return guarded("An item", () => db.item.create({ data: v }));
}

export interface SupplierPriceInput { supplierId: string; price: number }

/** Items that are made in-house have no supplier to buy from. */
const BOUGHT = (category: string) => category !== "FG" && category !== "REGRIND";

/**
 * Creates an item and, optionally, the supplier and buying price that make it purchasable: the price master is what MRP
 * and "Raise PO" use to pick a supplier, so an item without one can be tracked in Stores but not ordered automatically.
 */
export async function createItemWithSupplier(raw: unknown, supplier: SupplierPriceInput | null, db: Db = defaultDb) {
  return db.$transaction((tx) => createItemIn(tx, raw, supplier));
}

/** The same, inside a transaction you already have (the BOM import creates items and BOMs together). */
export async function createItemIn(tx: Prisma.TransactionClient, raw: unknown, supplier: SupplierPriceInput | null) {
  const v = parse(itemSchema, raw);
  if (supplier && !BOUGHT(v.category)) throw new DomainError(`${v.category === "FG" ? "Finished goods are made here" : "Regrind is made here"}, so there is no supplier to set.`);
  const item = await guarded("An item", () => tx.item.create({ data: v }));
  if (supplier) await upsertSupplierPrice(tx, item.id, supplier);
  return item;
}

async function upsertSupplierPrice(db: Db | Prisma.TransactionClient, itemId: string, s: SupplierPriceInput) {
  if (!Number.isFinite(s.price) || s.price < 0) throw new DomainError("The buying price can't be negative.");
  const sup = await db.supplier.findUnique({ where: { id: s.supplierId } });
  if (!sup || !sup.active) throw new DomainError("Choose an active supplier.");
  return db.priceMaster.upsert({
    where: { itemId_supplierId: { itemId, supplierId: s.supplierId } },
    update: { price: s.price }, create: { itemId, supplierId: s.supplierId, price: s.price },
  });
}

/** Sets (or changes) what a supplier charges for an item. */
export async function setSupplierPrice(itemId: string, s: SupplierPriceInput, db: Db = defaultDb) {
  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) throw new DomainError("That item doesn't exist any more.");
  if (!BOUGHT(item.category)) throw new DomainError(`${item.code} is made here, so it has no supplier.`);
  return upsertSupplierPrice(db, itemId, s);
}

export async function removeSupplierPrice(itemId: string, supplierId: string, db: Db = defaultDb) {
  const r = await db.priceMaster.deleteMany({ where: { itemId, supplierId } });
  if (r.count === 0) throw new DomainError("That supplier isn't listed for this item.");
}

export async function updateItem(id: string, raw: unknown, db: Db = defaultDb) {
  const v = parse(itemSchema, raw);
  // Prisma skips undefined on update, so a blanked-out field must be sent as null to actually clear it.
  const data = {
    ...v,
    polymerGrade: v.polymerGrade ?? null,
    shelfLifeDays: v.shelfLifeDays ?? null,
    maxRegrindPct: v.maxRegrindPct ?? null,
    hsnCode: v.hsnCode ?? null,
    unitPrice: v.unitPrice ?? null,
  };
  return guarded("An item", () => db.item.update({ where: { id }, data }));
}

export async function createSupplier(raw: unknown, db: Db = defaultDb) {
  const v = parse(supplierSchema, raw);
  return guarded("A supplier", () => db.supplier.create({ data: v }));
}

export async function updateSupplier(id: string, raw: unknown, db: Db = defaultDb) {
  const v = parse(supplierSchema, raw);
  return guarded("A supplier", () => db.supplier.update({ where: { id }, data: v }));
}

export async function createCustomer(raw: unknown, db: Db = defaultDb) {
  const v = parse(customerSchema, raw);
  return guarded("A customer", () => db.customer.create({ data: v }));
}

export async function updateCustomer(id: string, raw: unknown, db: Db = defaultDb) {
  const v = parse(customerSchema, raw);
  // Blanked-out optional fields must be sent as null, or Prisma leaves the old value.
  return guarded("A customer", () => db.customer.update({ where: { id }, data: { ...v, gstin: v.gstin ?? null, address: v.address ?? null } }));
}

export type RemoveOutcome = "deleted" | "deactivated";

/**
 * Takes a supplier out of the list. One that was never used is deleted; one with orders, returns or approved grades is
 * deactivated instead (its history stays readable). Refused while it has open POs.
 */
export async function removeSupplier(id: string, db: Db = defaultDb): Promise<RemoveOutcome> {
  return db.$transaction(async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id } });
    if (!s) throw new DomainError("That supplier doesn't exist any more.");
    if (!s.active) throw new DomainError(`${s.name} is already inactive.`);
    const open = await tx.purchaseOrder.count({ where: { supplierId: id, status: { in: ["APPROVED", "PARTIAL"] } } });
    if (open > 0) throw new DomainError(`${s.name} has ${open} open PO${open === 1 ? "" : "s"}. Close or cancel ${open === 1 ? "it" : "them"} first.`);
    const history = (await Promise.all([
      tx.purchaseOrder.count({ where: { supplierId: id } }), tx.returnToVendor.count({ where: { supplierId: id } }), tx.equivalentGrade.count({ where: { supplierId: id } }),
    ])).some((n) => n > 0);
    if (history) {
      await tx.supplier.update({ where: { id }, data: { active: false } });
      return "deactivated";
    }
    await tx.priceMaster.deleteMany({ where: { supplierId: id } }); // price list rows are set-up data, not history
    await tx.supplier.delete({ where: { id } });
    return "deleted";
  });
}

/** Same rule for customers: delete if never used, otherwise deactivate. Refused while a dispatch is being loaded. */
export async function removeCustomer(id: string, db: Db = defaultDb): Promise<RemoveOutcome> {
  return db.$transaction(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id } });
    if (!c) throw new DomainError("That customer doesn't exist any more.");
    if (!c.active) throw new DomainError(`${c.name} is already inactive.`);
    const loading = await tx.dispatch.count({ where: { customerId: id, status: "LOADING" } });
    if (loading > 0) throw new DomainError(`${c.name} has ${loading} dispatch${loading === 1 ? "" : "es"} being loaded. Finish or cancel ${loading === 1 ? "it" : "them"} first.`);
    const history = (await Promise.all([
      tx.dispatch.count({ where: { customerId: id } }), tx.fgBox.count({ where: { customerId: id } }),
      tx.returnableLedger.count({ where: { customerId: id } }), tx.demandLine.count({ where: { customerId: id } }),
    ])).some((n) => n > 0);
    if (history) {
      await tx.customer.update({ where: { id }, data: { active: false } });
      return "deactivated";
    }
    await tx.customer.delete({ where: { id } });
    return "deleted";
  });
}

// The scannable bin code is derived from rack-shelf-bin so labels and scans always agree.
export async function createLocation(raw: unknown, db: Db = defaultDb) {
  const v = parse(locationSchema, raw);
  const code = `${v.rack}-${v.shelf}-${v.bin}`;
  return guarded("A bin", () => db.location.create({ data: { ...v, code } }));
}

/**
 * Adds a bin to a rack from the Stores bin map. The rack's warehouse is reused (a new rack goes in the first warehouse),
 * and STG is reserved for the staging area, so storage racks can't be given that name.
 */
export async function addBin(raw: { rack: unknown; shelf: unknown; bin: unknown }, db: Db = defaultDb) {
  const rack = String(raw.rack ?? "").trim().toUpperCase();
  if (rack === "STG") throw new DomainError("STG is the staging area; choose another rack name.");
  const inRack = rack ? await db.location.findFirst({ where: { rack } }) : null;
  const warehouseId = inRack?.warehouseId ?? (await db.warehouse.findFirst({ orderBy: { code: "asc" } }))?.id;
  if (!warehouseId) throw new DomainError("No warehouse is set up yet.");
  const part = (v: unknown, what: string) => {
    const r = binPart.safeParse(v);
    if (!r.success) throw new DomainError(`${what}: enter 1 to 10 characters.`);
    return r.data;
  };
  // A bin removed earlier is only hidden (its stock history stays), so adding the same code again brings it back.
  const code = `${part(raw.rack, "Rack")}-${part(raw.shelf, "Shelf")}-${part(raw.bin, "Bin")}`;
  const retired = await db.location.findFirst({ where: { code, active: false } });
  if (retired) return db.location.update({ where: { id: retired.id }, data: { active: true } });
  return createLocation({ warehouseId, rack: raw.rack, shelf: raw.shelf, bin: raw.bin, type: "STORAGE" }, db);
}

// ───────── Editing the store layout: remove and rename ─────────

type Loc = { id: string; code: string; rack: string; shelf: string; bin: string; type: string };

/** Why a bin can't be taken out of the layout right now, or null when it is empty and idle. */
async function blocker(db: Db | Prisma.TransactionClient, l: Loc): Promise<string | null> {
  if (l.type === "STAGING") return `${l.code} is the staging area and can't be removed.`;
  const [stock, boxes, counts] = await Promise.all([
    db.stockBalance.count({ where: { locationId: l.id, qty: { gt: 0 } } }),
    db.fgBox.count({ where: { locationId: l.id, status: "IN_STOCK" } }),
    db.stockCount.count({ where: { locationId: l.id, status: { in: ["OPEN", "SUBMITTED"] } } }),
  ]);
  if (stock > 0 || boxes > 0) return `${l.code} still holds stock. Move it out first.`;
  if (counts > 0) return `${l.code} has a stock count in progress.`;
  return null;
}

/** Deletes a bin that was never used; hides one that has history, so the ledger and old counts keep pointing at it. */
async function drop(tx: Prisma.TransactionClient, l: Loc) {
  const [a, b, c, d] = await Promise.all([
    tx.stockBalance.count({ where: { locationId: l.id } }), tx.stockTransaction.count({ where: { locationId: l.id } }),
    tx.fgBox.count({ where: { locationId: l.id } }), tx.stockCount.count({ where: { locationId: l.id } }),
  ]);
  if (a + b + c + d === 0) await tx.location.delete({ where: { id: l.id } });
  else await tx.location.update({ where: { id: l.id }, data: { active: false } });
}

export async function removeBin(id: string, db: Db = defaultDb) {
  return db.$transaction(async (tx) => {
    const l = await tx.location.findFirst({ where: { id, active: true } });
    if (!l) throw new DomainError("That bin doesn't exist any more.");
    const why = await blocker(tx, l);
    if (why) throw new DomainError(why);
    await drop(tx, l);
  });
}

/** Removes a whole rack, but only when every bin in it is empty. Returns how many bins went. */
export async function removeRack(rack: string, db: Db = defaultDb) {
  const name = String(rack).trim().toUpperCase();
  return db.$transaction(async (tx) => {
    const bins = await tx.location.findMany({ where: { rack: name, active: true } });
    if (bins.length === 0) throw new DomainError(`Rack ${name} doesn't exist any more.`);
    if (bins.some((b) => b.type === "STAGING")) throw new DomainError("The staging area can't be removed.");
    const stuck = (await Promise.all(bins.map((b) => blocker(tx, b).then((why) => (why ? b.code : null))))).filter((c): c is string => !!c);
    if (stuck.length) throw new DomainError(`Rack ${name} can't be removed yet: ${stuck.join(", ")} ${stuck.length === 1 ? "is" : "are"} not empty.`);
    for (const b of bins) await drop(tx, b);
    return bins.length;
  });
}

// Renaming rewrites the scan code (RACK-SHELF-BIN) of every bin it touches. Stock stays where it is, but the printed labels
// for those bins are out of date, so callers tell the user to reprint.
async function renameRows(db: Db, where: Prisma.LocationWhereInput, change: Partial<Pick<Loc, "rack" | "shelf" | "bin">>, none: string) {
  return db.$transaction(async (tx) => {
    const rows = await tx.location.findMany({ where, orderBy: { code: "asc" } });
    if (rows.length === 0) throw new DomainError(none);
    if (rows.some((r) => r.type === "STAGING")) throw new DomainError("The staging area can't be renamed.");
    const next = rows.map((r) => { const n = { rack: r.rack, shelf: r.shelf, bin: r.bin, ...change }; return { r, ...n, code: `${n.rack}-${n.shelf}-${n.bin}` }; });
    if (next.every((n) => n.code === n.r.code)) throw new DomainError("That is already the name.");
    const taken = await tx.location.findMany({ where: { code: { in: next.map((n) => n.code) }, id: { notIn: rows.map((r) => r.id) } } });
    if (taken.length) throw new DomainError(`${taken.map((t) => t.code).join(", ")} already ${taken.length === 1 ? "exists" : "exist"}${taken.some((t) => !t.active) ? " (a removed bin still uses the code)" : ""}.`);
    for (const n of next) await tx.location.update({ where: { id: n.r.id }, data: { rack: n.rack, shelf: n.shelf, bin: n.bin, code: n.code } });
    return next.length;
  });
}

const partOf = (v: unknown, what: string) => {
  const r = binPart.safeParse(v);
  if (!r.success) throw new DomainError(`${what}: enter 1 to 10 characters.`);
  return r.data;
};

export async function renameBin(id: string, to: unknown, db: Db = defaultDb) {
  return renameRows(db, { id }, { bin: partOf(to, "Bin") }, "That bin doesn't exist any more.");
}

export async function renameShelf(rack: string, shelf: string, to: unknown, db: Db = defaultDb) {
  return renameRows(db, { rack: rack.trim().toUpperCase(), shelf: shelf.trim().toUpperCase() }, { shelf: partOf(to, "Shelf") }, `Shelf ${shelf} doesn't exist in rack ${rack}.`);
}

export async function renameRack(rack: string, to: unknown, db: Db = defaultDb) {
  const from = rack.trim().toUpperCase(), next = partOf(to, "Rack");
  if (from === "STG" || next === "STG") throw new DomainError("STG is the staging area; choose another rack name.");
  if (from !== next && (await db.location.findFirst({ where: { rack: next } }))) throw new DomainError(`Rack ${next} already exists. Pick a different name.`);
  return renameRows(db, { rack: from }, { rack: next }, `Rack ${from} doesn't exist any more.`);
}

export async function createMachine(raw: unknown, db: Db = defaultDb) {
  const v = parse(machineSchema, raw);
  return guarded("A machine", () => db.machine.create({ data: v }));
}

const activeMachine = async (db: Db | Prisma.TransactionClient, id: string | undefined) => {
  if (!id) return;
  const m = await db.machine.findUnique({ where: { id } });
  if (!m || !m.active) throw new DomainError("Choose a machine that is still in service.");
};

export async function createMould(raw: unknown, db: Db = defaultDb) {
  const v = parse(mouldSchema, raw);
  await activeMachine(db, v.machineId);
  return guarded("A mould", () => db.mould.create({ data: v }));
}

// The code is the identity (it is on labels, plans and history), so an edit changes the details but never the code.
export async function updateMachine(id: string, raw: unknown, db: Db = defaultDb) {
  const v = parse(machineSchema, raw);
  return guarded("A machine", () => db.machine.update({ where: { id }, data: { name: v.name, tonnage: v.tonnage ?? null } }));
}

export async function updateMould(id: string, raw: unknown, db: Db = defaultDb) {
  const v = parse(mouldSchema, raw);
  await activeMachine(db, v.machineId);
  return guarded("A mould", () => db.mould.update({
    where: { id },
    data: { name: v.name, cavities: v.cavities, shotWeightG: v.shotWeightG ?? null, runnerWeightG: v.runnerWeightG ?? null, machineId: v.machineId ?? null },
  }));
}

const startOfToday = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

/**
 * Takes a machine out of the list. One that was never used is deleted; one with bookings, stops, plans or first-offs is retired
 * (hidden from pickers, history kept) and its moulds are set free. Refused while it has upcoming plan slots.
 */
export async function removeMachine(id: string, db: Db = defaultDb): Promise<RemoveOutcome> {
  return db.$transaction(async (tx) => {
    const m = await tx.machine.findUnique({ where: { id } });
    if (!m) throw new DomainError("That machine doesn't exist any more.");
    if (!m.active) throw new DomainError(`${m.code} is already retired.`);
    const planned = await tx.planSlot.count({ where: { machineId: id, day: { gte: startOfToday() } } });
    if (planned > 0) throw new DomainError(`${m.code} has ${planned} planned day${planned === 1 ? "" : "s"} coming up. Clear ${planned === 1 ? "it" : "them"} on Planning first.`);
    const history = (await Promise.all([
      tx.productionBooking.count({ where: { machineId: id } }), tx.downtime.count({ where: { machineId: id } }),
      tx.planSlot.count({ where: { machineId: id } }), tx.firstOff.count({ where: { machineId: id } }),
    ])).some((n) => n > 0);
    await tx.mould.updateMany({ where: { machineId: id }, data: { machineId: null } });
    if (history) {
      await tx.machine.update({ where: { id }, data: { active: false } });
      return "deactivated";
    }
    await tx.machine.delete({ where: { id } });
    return "deleted";
  });
}

/** The same for a mould. Refused while any BOM runs on it (move those parts to another mould first) or it has upcoming plan slots. */
export async function removeMould(id: string, db: Db = defaultDb): Promise<RemoveOutcome> {
  return db.$transaction(async (tx) => {
    const m = await tx.mould.findUnique({ where: { id }, include: { boms: { include: { fgItem: true } } } });
    if (!m) throw new DomainError("That mould doesn't exist any more.");
    if (!m.active) throw new DomainError(`${m.code} is already retired.`);
    if (m.boms.length > 0) {
      const parts = m.boms.map((b) => b.fgItem.code);
      throw new DomainError(`${m.code} is used by the BOM${parts.length === 1 ? "" : "s"} for ${parts.slice(0, 4).join(", ")}${parts.length > 4 ? "…" : ""}. Move ${parts.length === 1 ? "it" : "them"} to another mould first.`);
    }
    const planned = await tx.planSlot.count({ where: { mouldId: id, day: { gte: startOfToday() } } });
    if (planned > 0) throw new DomainError(`${m.code} has ${planned} planned day${planned === 1 ? "" : "s"} coming up. Clear ${planned === 1 ? "it" : "them"} on Planning first.`);
    const history = (await Promise.all([
      tx.downtime.count({ where: { mouldId: id } }), tx.pmRecord.count({ where: { mouldId: id } }),
      tx.repairTicket.count({ where: { mouldId: id } }), tx.planSlot.count({ where: { mouldId: id } }),
    ])).some((n) => n > 0);
    if (history) {
      await tx.mould.update({ where: { id }, data: { active: false, machineId: null } });
      return "deactivated";
    }
    await tx.mould.delete({ where: { id } });
    return "deleted";
  });
}

export async function reactivateEquipment(kind: "machine" | "mould", id: string, db: Db = defaultDb) {
  const r = kind === "machine" ? await db.machine.updateMany({ where: { id }, data: { active: true } }) : await db.mould.updateMany({ where: { id }, data: { active: true } });
  if (r.count !== 1) throw new DomainError("That doesn't exist any more.");
}

// Items and suppliers are deactivated, never deleted: lots, POs and the ledger reference them.
export async function setActive(kind: "item" | "supplier" | "customer", id: string, active: boolean, db: Db = defaultDb) {
  if (kind === "item") await db.item.update({ where: { id }, data: { active } });
  else if (kind === "supplier") await db.supplier.update({ where: { id }, data: { active } });
  else await db.customer.update({ where: { id }, data: { active } });
}
