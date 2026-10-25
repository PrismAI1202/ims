import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { db as defaultDb } from "@/server/db";
import {
  customerSchema, itemSchema, locationSchema, machineSchema, mouldSchema, supplierSchema,
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

// The scannable bin code is derived from rack-shelf-bin so labels and scans always agree.
export async function createLocation(raw: unknown, db: Db = defaultDb) {
  const v = parse(locationSchema, raw);
  const code = `${v.rack}-${v.shelf}-${v.bin}`;
  return guarded("A bin", () => db.location.create({ data: { ...v, code } }));
}

export async function createMachine(raw: unknown, db: Db = defaultDb) {
  const v = parse(machineSchema, raw);
  return guarded("A machine", () => db.machine.create({ data: v }));
}

export async function createMould(raw: unknown, db: Db = defaultDb) {
  const v = parse(mouldSchema, raw);
  return guarded("A mould", () => db.mould.create({ data: v }));
}

// Items and suppliers are deactivated, never deleted: lots, POs and the ledger reference them.
export async function setActive(kind: "item" | "supplier" | "customer", id: string, active: boolean, db: Db = defaultDb) {
  if (kind === "item") await db.item.update({ where: { id }, data: { active } });
  else if (kind === "supplier") await db.supplier.update({ where: { id }, data: { active } });
  else await db.customer.update({ where: { id }, data: { active } });
}
