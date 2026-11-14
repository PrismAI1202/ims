"use server";

import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { recordQc } from "@/server/services/inventory";
import { approveScrap } from "@/server/services/scrap";
import { decidePdi } from "@/server/services/pdi";
import { decideFirstOff, requestFirstOff } from "@/server/services/firstoff";
import { returnToVendor } from "@/server/services/rtv";
import { pushAfter } from "@/server/push";
import { qualityHref } from "@/lib/quality-tabs";

// The Quality hub's actions. Each re-checks the permission for its own tab, because the page-level check only says the user may
// open the hub: a role with only the First-off tab must not be able to post an inward QC decision.

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

export async function decideInward(formData: FormData) {
  const user = await requirePermission("qc.inspect");
  const decision = String(formData.get("decision")) as "APPROVED" | "REJECTED" | "DEVIATED";
  let message = `Lot ${decision.toLowerCase()}.`;
  return runAction(qualityHref("inward"), () => message, async () => {
    const lot = await recordQc({
      lotId: String(formData.get("lotId")),
      decision,
      mfi: num(formData.get("mfi")), moisturePct: num(formData.get("moisture")),
      density: num(formData.get("density")), tensile: num(formData.get("tensile")),
      remarks: String(formData.get("remarks") || "") || undefined,
      putawayLocationCode: String(formData.get("bin") || "") || undefined,
      countedQty: num(formData.get("counted")),
      userId: user.id,
    });
    // The count is part of the inspection: a difference from the GRN is a stock adjustment, so it waits for an approver and the lot
    // stays in staging until then.
    if (lot.countDifference !== null) {
      message = `Lot ${decision.toLowerCase()}. You counted ${Math.abs(lot.countDifference).toLocaleString()} ${lot.countDifference < 0 ? "fewer" : "more"} than the GRN, so the difference has gone for approval and the lot stays in staging until it is decided.`;
      pushAfter({ view: "stock", perm: "stock.adjust", exceptUserId: user.id }, { title: "Stock count to approve", body: `${lot.lotNumber}: counted ${lot.countDifference > 0 ? "+" : ""}${lot.countDifference} against the GRN at inward QC.`, url: "/stock?view=bins", tag: "approvals" });
    }
    // Each outcome is a task for someone else: put-away for Store, or a return for rejected material.
    if (decision === "REJECTED") {
      pushAfter({ view: "quality", perm: "rtv.manage", exceptUserId: user.id }, { title: "Lot rejected", body: `${lot.lotNumber} failed inward QC. Send it back to the supplier.`, url: qualityHref("rtv"), tag: "rtv" });
    } else if (!formData.get("bin") || lot.countDifference !== null) {
      pushAfter({ view: "stock", perm: "stock.transfer", exceptUserId: user.id }, { title: "Lot to put away", body: `${lot.lotNumber} is released. Move it to a bin.`, url: "/stock?view=bins", tag: "putaway" });
    }
  });
}

export async function decideScrap(formData: FormData) {
  const user = await requirePermission("scrap.approve");
  const kind = String(formData.get("kind")) === "REGRIND" ? "REGRIND" : "WASTE";
  return runAction(qualityHref("scrap"), kind === "REGRIND" ? "Approved. The parts' weight was added to regrind stock." : "Approved as waste.", async () => {
    await approveScrap({
      bookingId: String(formData.get("bookingId")), parts: Number(formData.get("parts")), kind,
      regrindLocationCode: String(formData.get("bin") || "") || undefined, note: String(formData.get("note") || "") || undefined, userId: user.id,
    });
  });
}

export async function decideFinal(formData: FormData) {
  const user = await requirePermission("pdi.release");
  const release = formData.get("decision") === "release";
  return runAction(qualityHref("pdi"), release ? "Lot released for dispatch." : "Lot put on hold.", async () => {
    await decidePdi({ lotNumber: String(formData.get("lot")), release, remarks: String(formData.get("remarks") || ""), userId: user.id });
  });
}

export async function requestFirst(formData: FormData) {
  const user = await requirePermission("firstoff.request");
  return runAction(qualityHref("firstoff"), "First-off requested. QA has been told.", async () => {
    const f = await requestFirstOff({
      machineId: String(formData.get("machine") || ""), bomId: String(formData.get("bom") || ""),
      shift: String(formData.get("shift") || "A") as "A" | "B" | "C", note: String(formData.get("note") || ""), userId: user.id,
    });
    const what = await db.firstOff.findUniqueOrThrow({ where: { id: f.id }, include: { machine: true, bom: { include: { fgItem: true } } } });
    pushAfter({ view: "quality", perm: "firstoff.approve", exceptUserId: user.id }, {
      title: "First-off to approve", body: `${what.machine.code} · ${what.bom.fgItem.code} · shift ${what.shift}`, url: qualityHref("firstoff"), tag: "firstoff",
    });
  });
}

export async function decideFirst(formData: FormData) {
  const user = await requirePermission("firstoff.approve");
  const approve = formData.get("decision") === "approve";
  return runAction(qualityHref("firstoff"), approve ? "First-off approved. Production can be booked." : "First-off rejected.", async () => {
    const id = String(formData.get("id"));
    await decideFirstOff({ id, approve, note: String(formData.get("note") || ""), userId: user.id });
    const f = await db.firstOff.findUniqueOrThrow({ where: { id }, include: { machine: true, bom: { include: { fgItem: true } } } });
    pushAfter({ view: "quality", perm: "firstoff.request", exceptUserId: user.id }, {
      title: approve ? "First-off approved" : "First-off rejected", body: `${f.machine.code} · ${f.bom.fgItem.code}${approve ? ". You can book production." : `: ${f.decisionNote ?? ""}`}`, url: qualityHref("firstoff"), tag: "firstoff-result",
    });
  });
}

export async function sendBack(formData: FormData) {
  const user = await requirePermission("rtv.manage");
  return runAction(qualityHref("rtv"), "Return recorded and stock removed. Print the debit note below.", async () => {
    await returnToVendor({
      lotNumber: String(formData.get("lot") || ""), qty: Number(formData.get("qty") || 0),
      reason: String(formData.get("reason") || ""), userId: user.id,
    });
  });
}
