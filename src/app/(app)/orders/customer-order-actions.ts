"use server";

import { requirePermission, runAction } from "@/server/auth/guard";
import { createCustomerOrder, removeOrderLine } from "@/server/services/demand";
import { DomainError } from "@/server/services/inventory";
import { dateField, readLines } from "@/server/line-form";

// Customer orders are entered from Orders and from Customer demand, so the two screens share these actions and say where to return.
const safeBack = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "");
  return s.startsWith("/orders") || s.startsWith("/demand") ? s : "/orders?kind=demand";
};

export async function addCustomerOrder(f: FormData) {
  const user = await requirePermission("mrp.plan");
  const back = safeBack(f.get("back"));
  let message = "";
  return runAction(back.split("?")[0] === "/demand" ? "/demand" : "/orders?kind=demand", () => message, async () => {
    const lines = readLines(f).map((l) => ({ fgItemId: l.itemId, qty: l.qty, dueDate: dateField(l.date) }));
    if (lines.some((l) => !l.dueDate)) throw new DomainError("Give every line a due date.", ["date"]);
    const r = await createCustomerOrder({
      customerId: String(f.get("customerId") || ""), type: f.get("type") === "SPOT" ? "SPOT" : "FIRM", ref: String(f.get("customerRef") || ""),
      lines: lines.map((l) => ({ ...l, dueDate: l.dueDate! })), userId: user.id,
    });
    message = `Customer order added: ${r.lines} line${r.lines === 1 ? "" : "s"}${r.ref ? ` for PO ${r.ref}` : ""}.`;
  }, back);
}

export async function removeCustomerOrderLine(f: FormData) {
  await requirePermission("mrp.plan");
  const back = safeBack(f.get("back"));
  return runAction(back, "Order line removed.", async () => { await removeOrderLine(String(f.get("id"))); });
}
