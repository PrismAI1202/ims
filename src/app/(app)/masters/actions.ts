"use server";

import { requirePermission, runAction } from "@/server/auth/guard";
import { DomainError } from "@/server/services/inventory";
import {
  createItemWithSupplier, removeSupplierPrice,
  setActive, setSupplierPrice, updateItem,
} from "@/server/services/masters";

// Each action re-checks the permission itself: layout-level auth does not protect server actions.
const raw = (f: FormData) => Object.fromEntries(f.entries());

export async function addItem(f: FormData) {
  await requirePermission("masters.manage");
  // The supplier and buying price are optional extras on the new-item form; they are what lets MRP and "Raise PO" order the item.
  const { supplierId, buyPrice, ...item } = raw(f);
  const supplier = supplierId ? { supplierId: String(supplierId), price: Number(buyPrice) } : null;
  return runAction("/masters?tab=items", supplier ? "Item created, with its supplier price." : "Item created. Add a supplier price on the item so it can be ordered.", async () => {
    if (supplier && String(buyPrice ?? "") === "") throw new DomainError("Enter the buying price for that supplier.", ["buyPrice"]);
    await createItemWithSupplier(item, supplier);
  });
}

export async function addSupplierPrice(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("itemId"));
  return runAction(`/masters/items/${id}`, "Supplier price saved.", async () => {
    if (String(f.get("price") ?? "") === "") throw new DomainError("Enter the buying price.", ["price"]);
    await setSupplierPrice(id, { supplierId: String(f.get("supplierId") || ""), price: Number(f.get("price")) });
  });
}

export async function dropSupplierPrice(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("itemId"));
  return runAction(`/masters/items/${id}`, "Supplier removed from this item.", async () => { await removeSupplierPrice(id, String(f.get("supplierId"))); });
}

export async function saveItem(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("id"));
  return runAction("/masters?tab=items", "Item updated.", async () => { await updateItem(id, raw(f)); }, `/masters/items/${id}`);
}

export async function toggleActive(f: FormData) {
  await requirePermission("masters.manage");
  const kind = String(f.get("kind")) as "item" | "supplier" | "customer";
  const tab = kind === "item" ? "items" : kind === "supplier" ? "suppliers" : "customers";
  return runAction(`/masters?tab=${tab}`, "Status changed.", async () => {
    await setActive(kind, String(f.get("id")), f.get("active") === "true");
  });
}
