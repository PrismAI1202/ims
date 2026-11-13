"use server";

import { requirePermission, runAction } from "@/server/auth/guard";
import { DomainError } from "@/server/services/inventory";
import { createItemWithSupplier, saveItemWithSuppliers, setActive, syncSupplierCatalogue } from "@/server/services/masters";
import { readPriceRows } from "@/server/line-form";

// Each action re-checks the permission itself: layout-level auth does not protect server actions.
// Forms post the list URL they came from, so saving returns to the same filtered view.
const safeBack = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "");
  return s.startsWith("/masters") ? s : "/masters";
};
// The item's own fields: everything the form posts except the supplier price rows and our bookkeeping fields.
const itemFields = (f: FormData) => {
  const { supplierId: _s, price: _p, back: _b, suppliers: _x, id: _i, ...rest } = Object.fromEntries(f.entries());
  void _s; void _p; void _b; void _x; void _i;
  return rest;
};

export async function addItem(f: FormData) {
  await requirePermission("masters.manage");
  let made = 0;
  return runAction(
    safeBack(f.get("back")),
    () => (made ? `Item created, with ${made} supplier${made === 1 ? "" : "s"}.` : "Item created. Add a supplier so it can be ordered."),
    async () => {
      const rows = readPriceRows(f, "supplierId").map((r) => ({ supplierId: r.id, price: r.price })); // inside, so a missing price is shown in the form
      await createItemWithSupplier(itemFields(f), rows);
      made = rows.length;
    },
  );
}

export async function saveItem(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("id"));
  return runAction(safeBack(f.get("back")), "Item saved.", async () => {
    // Only an item that shows the supplier list (a bought one) posts it; for the rest the supplier list is left alone.
    const rows = f.get("suppliers") === "1" ? readPriceRows(f, "supplierId").map((r) => ({ supplierId: r.id, price: r.price })) : null;
    await saveItemWithSuppliers(id, itemFields(f), rows);
  });
}

export async function toggleActive(f: FormData) {
  await requirePermission("masters.manage");
  const active = f.get("active") === "true";
  return runAction(safeBack(f.get("back")), active ? "Item activated." : "Item deactivated. It no longer appears in pickers; its history is kept.", async () => {
    await setActive("item", String(f.get("id")), active);
  });
}

/** The supplier's side of the same price list: the products it supplies and what it charges for each. */
export async function saveSupplierCatalogue(f: FormData) {
  await requirePermission("masters.manage");
  const id = String(f.get("supplierId"));
  const back = String(f.get("back") || "");
  if (!back.startsWith("/partners")) throw new DomainError("Open the supplier from the list to edit its products.");
  return runAction(back, "Products saved.", async () => {
    await syncSupplierCatalogue(id, readPriceRows(f, "itemId").map((r) => ({ itemId: r.id, price: r.price })));
  });
}
