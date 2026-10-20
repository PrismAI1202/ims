"use server";

import { requirePermission, runAction } from "@/server/auth/guard";
import {
  createCustomer, createItem, createLocation, createMachine, createMould, createSupplier,
  setActive, updateItem, updateSupplier,
} from "@/server/services/masters";

// Each action re-checks the permission itself: layout-level auth does not protect server actions.
const raw = (f: FormData) => Object.fromEntries(f.entries());

export async function addItem(f: FormData) {
  await requirePermission("masters.manage");
  await runAction("/masters?tab=items", "Item created.", async () => { await createItem(raw(f)); });
}

export async function saveItem(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("id"));
  await runAction("/masters?tab=items", "Item updated.", async () => { await updateItem(id, raw(f)); }, `/masters/items/${id}`);
}

export async function addSupplier(f: FormData) {
  await requirePermission("masters.manage");
  await runAction("/masters?tab=suppliers", "Supplier created.", async () => { await createSupplier(raw(f)); });
}

export async function saveSupplier(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("id"));
  await runAction("/masters?tab=suppliers", "Supplier updated.", async () => { await updateSupplier(id, raw(f)); }, "/masters?tab=suppliers");
}

export async function addCustomer(f: FormData) {
  await requirePermission("masters.manage");
  await runAction("/masters?tab=customers", "Customer created.", async () => { await createCustomer(raw(f)); });
}

export async function addLocation(f: FormData) {
  await requirePermission("masters.manage");
  await runAction("/masters?tab=bins", "Bin created.", async () => { await createLocation(raw(f)); });
}

export async function addMachine(f: FormData) {
  await requirePermission("masters.manage");
  await runAction("/masters?tab=machines", "Machine created.", async () => { await createMachine(raw(f)); });
}

export async function addMould(f: FormData) {
  await requirePermission("masters.manage");
  await runAction("/masters?tab=machines", "Mould created.", async () => { await createMould(raw(f)); });
}

export async function toggleActive(f: FormData) {
  await requirePermission("masters.manage");
  const kind = String(f.get("kind")) as "item" | "supplier" | "customer";
  const tab = kind === "item" ? "items" : kind === "supplier" ? "suppliers" : "customers";
  await runAction(`/masters?tab=${tab}`, "Status changed.", async () => {
    await setActive(kind, String(f.get("id")), f.get("active") === "true");
  });
}
