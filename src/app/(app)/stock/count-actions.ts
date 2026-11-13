"use server";

import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { decideCount, saveCount, startCount, submitCount } from "@/server/services/stockcount";
import { pushAfter } from "@/server/push";

// Stock counts live in Stores (Counts tab). Counting needs stock.count; approving needs stock.adjust. Each action re-checks its own.
const BACK = "/stock?view=counts";

function entries(formData: FormData) {
  const out = [...formData.entries()]
    .filter(([k]) => k.startsWith("qty_"))
    .map(([k, v]) => ({ lotNumber: k.slice(4), countedQty: String(v).trim() === "" ? null : Number(v) }));
  const extra = String(formData.get("extraLot") || "").trim();
  if (extra && String(formData.get("extraQty") || "").trim() !== "") out.push({ lotNumber: extra, countedQty: Number(formData.get("extraQty")) });
  return out;
}

export async function startSheet(formData: FormData) {
  const user = await requirePermission("stock.count");
  await runAction(BACK, "Count sheet opened. Enter what is really in the bin.", async () => {
    await startCount({ locationCode: String(formData.get("bin") || ""), userId: user.id });
  });
}

export async function saveSheet(formData: FormData) {
  const user = await requirePermission("stock.count");
  await runAction(BACK, "Counts saved.", async () => {
    await saveCount(String(formData.get("id")), entries(formData), user.id);
  });
}

export async function submitSheet(formData: FormData) {
  const user = await requirePermission("stock.count");
  await runAction(BACK, "Sent for approval.", async () => {
    const id = String(formData.get("id"));
    await saveCount(id, entries(formData), user.id);
    await submitCount(id, user.id);
    const c = await db.stockCount.findUniqueOrThrow({ where: { id }, include: { location: true } });
    pushAfter({ view: "stock", perm: "stock.adjust", exceptUserId: user.id }, {
      title: "Stock count to approve", body: `${c.countNumber} for bin ${c.location.code} is waiting for a decision.`, url: BACK, tag: "approvals",
    });
  });
}

export async function decideSheet(formData: FormData) {
  const user = await requirePermission("stock.adjust");
  const approve = formData.get("decision") === "approve";
  await runAction(BACK, approve ? "Count approved and stock adjusted." : "Count rejected. Stock is unchanged.", async () => {
    await decideCount({ id: String(formData.get("id")), approve, note: String(formData.get("note") || ""), userId: user.id });
  });
}
