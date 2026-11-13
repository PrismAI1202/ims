"use server";

import { requirePermission, runAction } from "@/server/auth/guard";
import { createMaterialRequest, issueStock } from "@/server/services/inventory";
import { returnMaterial } from "@/server/services/returns";
import { pushAfter } from "@/server/push";

// Material requests are one flow with three owners: production raises (request.create), stores issue FIFO (stock.issue) and
// either side puts leftovers back (material.return). Each action re-checks its own permission.
const BACK = "/requests";

export async function raiseRequest(formData: FormData) {
  const user = await requirePermission("request.create");
  await runAction(BACK, "Material request sent to store.", async () => {
    const req = await createMaterialRequest({
      machineId: String(formData.get("machineId") || "") || undefined,
      lines: [{ itemId: String(formData.get("itemId")), qty: Number(formData.get("qty")) }],
      userId: user.id,
    });
    pushAfter({ view: "requests", perm: "stock.issue", exceptUserId: user.id }, { title: "Material requested", body: `${req.requestNumber} is waiting to be issued.`, url: BACK, tag: "issue" });
  });
}

export async function issueLine(formData: FormData) {
  const user = await requirePermission("stock.issue");
  await runAction(BACK, "Issued to shop floor.", async () => {
    await issueStock({
      requestLineId: String(formData.get("requestLineId")),
      lotNumber: String(formData.get("lotNumber")).trim(),
      locationCode: String(formData.get("locationCode")).trim(),
      qty: Number(formData.get("qty")),
      fifoOverrideReason: String(formData.get("override") || "") || undefined,
      userId: user.id,
    });
  });
}

export async function giveBack(formData: FormData) {
  const user = await requirePermission("material.return");
  await runAction(BACK, "Material returned to stores.", async () => {
    await returnMaterial({
      lotNumber: String(formData.get("lot") || ""), locationCode: String(formData.get("bin") || ""),
      qty: Number(formData.get("qty") || 0), note: String(formData.get("note") || ""), userId: user.id,
    });
  });
}
