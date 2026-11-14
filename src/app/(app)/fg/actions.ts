"use server";

import { requirePermission, runAction } from "@/server/auth/guard";
import { packBoxes } from "@/server/services/fg";
import { recordReturnable } from "@/server/services/dispatch";

// Finished goods: packing needs fg.pack, the crate ledger needs crates.manage. Each action re-checks its own.

export async function pack(formData: FormData) {
  const user = await requirePermission("fg.pack");
  const [lotNumber, binCode] = String(formData.get("source")).split("|");
  let first = "";
  return runAction("/fg?tab=pack", () => `Boxes created. ${first ? `Print labels: ${first}` : ""}`.trim(), async () => {
    const boxes = await packBoxes({
      lotNumber, binCode, customerId: String(formData.get("customerId")),
      qtyPerBox: Number(formData.get("qtyPerBox")), boxCount: Number(formData.get("boxCount")), userId: user.id,
    });
    first = `${boxes[0].boxCode}${boxes.length > 1 ? ` – ${boxes[boxes.length - 1].boxCode}` : ""}`;
  });
}

export async function recordCrates(formData: FormData) {
  const user = await requirePermission("crates.manage");
  const move = String(formData.get("move")) === "ISSUED" ? "ISSUED" : "RETURNED";
  return runAction("/fg?tab=crates", move === "RETURNED" ? "Return recorded." : "Opening balance / issue recorded.", async () => {
    await recordReturnable({
      customerId: String(formData.get("customerId")), itemId: String(formData.get("itemId")), move,
      qty: Number(formData.get("qty")), note: String(formData.get("note") || "") || undefined, userId: user.id,
      binCode: String(formData.get("binCode") || "") || undefined,
    });
  });
}
