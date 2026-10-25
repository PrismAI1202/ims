import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { fileUrl, isFileRef } from "./storage";

type Db = PrismaClient;

import type { ProcessEntry, ProcessPhoto, ProcessStage } from "@/lib/process-types";

type Seg = "auto" | "non";
const AUTO = "AUTOMOTIVE";
const ROLE_COLOR: Record<string, string> = { ADMIN: "#0F5C5C", STORE_INCHARGE: "#C2410C", QA_INSPECTOR: "#1D4ED8", PRODUCTION_LEAD: "#6B4FB0", DISPATCH_OFFICER: "#15171A" };
const ROLE_SHORT: Record<string, string> = { ADMIN: "Admin", STORE_INCHARGE: "Incharge", QA_INSPECTOR: "QA", PRODUCTION_LEAD: "Lead", DISPATCH_OFFICER: "Dispatch" };

const TEMPLATE: Record<Seg, string[]> = {
  auto: ["sched", "mrp", "gate", "grn", "coa", "qc", "store", "issue", "mould", "fg", "disp"],
  non: ["sched", "mrp", "gate", "grn", "qc", "store", "issue", "mould", "fg", "disp"],
};

const STAGE: Record<string, Omit<ProcessStage, "key" | "entries">> = {
  sched: { name: "Customer schedule", role: "Planner", owners: ["Planner", "Admin"], color: "#4B5563", rule: "CSV / Excel import", proofs: [], link: "/demand", linkLabel: "Customer demand",
    desc: "Rolling forecasts, firm weekly call-offs and spot POs are imported and tagged by customer, which decides the rules every later step applies." },
  mrp: { name: "MRP & PO release", role: "Planner", owners: ["Planner", "Store Incharge", "Admin"], color: "#4B5563", rule: "Equivalents allowed", proofs: [], link: "/purchase", linkLabel: "Supplier POs",
    desc: "Net requirement is worked out from live stock, safety stock and active BOMs. A PO is then released to the chosen vendor." },
  gate: { name: "Gate entry", role: "Security / Store Incharge", owners: ["Store Incharge", "Admin"], color: "#C2410C", rule: "Vehicle + invoice", proofs: [], link: "/grn", linkLabel: "Gate entry & GRN",
    desc: "The vehicle and supplier invoice are logged before material enters the yard. The invoice is matched to an open PO." },
  grn: { name: "GRN & lot tagging", role: "Store Incharge", owners: ["Store Incharge", "Admin"], color: "#C2410C", rule: "Heat / lot no.", proofs: ["COA document"], link: "/grn", linkLabel: "Gate entry & GRN",
    desc: "Store records the received quantity and the manufacturer heat/lot number. Each received line becomes a lot held for QC." },
  coa: { name: "COA verification", role: "QA Inspector", owners: ["QA Inspector", "Admin"], color: "#1D4ED8", rule: "IATF 16949", proofs: ["COA document"], link: "/qc", linkLabel: "Inward QC",
    desc: "QA checks the supplier certificate of analysis. Mandatory before GRN release for automotive lots." },
  qc: { name: "QC hold / release", role: "QA Inspector", owners: ["QA Inspector", "Admin"], color: "#1D4ED8", rule: "MFI · moisture", proofs: [], link: "/qc", linkLabel: "Inward QC",
    desc: "The lot stays on hold until the test results pass. Release adds the lot to the FIFO queue; reject or deviation needs a reason." },
  store: { name: "Bin put-away", role: "Store Incharge", owners: ["Store Incharge", "Admin"], color: "#1E7A46", rule: "Rack-Shelf-Bin", proofs: [], link: "/stock?view=bins", linkLabel: "Stores bin map",
    desc: "Released material is placed into Rack-Shelf-Bin locations so pickers are guided straight to the oldest lot." },
  issue: { name: "FIFO issue to floor", role: "Store Incharge", owners: ["Store Incharge", "Admin"], color: "#1E7A46", rule: "Lot scan", proofs: [], link: "/issue", linkLabel: "FIFO issue",
    desc: "Shop-floor requisitions are filled oldest lot first. Scanning a newer lot is blocked unless a reason is given." },
  mould: { name: "Moulding & downtime", role: "Production Lead / Operator", owners: ["Production Lead", "Admin"], color: "#6B4FB0", rule: "Max regrind per grade", proofs: [], link: "/production", linkLabel: "Production",
    desc: "Production books shots, good and rejected parts and runner weight, and logs any stop with its reason." },
  fg: { name: "FG packing & label", role: "Production Lead / Operator", owners: ["Production Lead", "Dispatch Officer", "Admin"], color: "#6B4FB0", rule: "OEM QR label", proofs: [], link: "/fg", linkLabel: "FG & box labels",
    desc: "Good parts are packed into labelled boxes for a customer, in that customer's label format." },
  disp: { name: "Dispatch & DC", role: "Dispatch Officer", owners: ["Dispatch Officer", "Admin"], color: "#15171A", rule: "Pick-list scan", proofs: [], link: "/dispatch", linkLabel: "Dispatch",
    desc: "The pick list is scanned box by box before loading. The delivery challan and e-way data are generated when the load is completed." },
};

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const clock = (d: Date, now: Date) =>
  d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const n = (x: number | string | { toString(): string }) => Number(x).toLocaleString("en-US");

export async function processStages(seg: Seg, db: Db = defaultDb, now = new Date()): Promise<ProcessStage[]> {
  const segment = seg === "auto" ? AUTO : "NON_AUTOMOTIVE";
  const take = 6;
  const users = await db.user.findMany({ select: { id: true, name: true, role: true } });
  const person = (id: string | null | undefined, fallback = "System") => {
    const u = users.find((x) => x.id === id);
    return u ? { by: `${u.name} · ${ROLE_SHORT[u.role] ?? u.role}`, init: initials(u.name), avBg: ROLE_COLOR[u.role] ?? "#4B5563" } : { by: fallback, init: "SY", avBg: "#4B5563" };
  };
  const E = (id: string, who: ReturnType<typeof person>, when: Date, status: string, fields: [string, string][], photos: ProcessPhoto[] = []): ProcessEntry =>
    ({ id, ...who, time: clock(when, now), status, photos, fields });
  const coaPhoto = (ref: string | null | undefined): ProcessPhoto[] => (ref && isFileRef(ref) ? [{ name: "COA document", href: fileUrl(ref) }] : []);

  const [imports, pos, gates, grns, pendingLots, inspections, staged, puts, requests, bookings, downs, boxes, dispatches] = await Promise.all([
    db.demandImport.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { lines: { include: { customer: true } } } }),
    db.purchaseOrder.findMany({ where: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" }, orderBy: { createdAt: "desc" }, take, include: { supplier: true, lines: { include: { item: true } } } }),
    db.gateEntry.findMany({ where: { po: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" } }, orderBy: { arrivedAt: "desc" }, take, include: { po: true, grns: true } }),
    db.grn.findMany({ where: { po: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" } }, orderBy: { createdAt: "desc" }, take, include: { po: { include: { supplier: true } }, lines: { include: { lot: { include: { item: true } } } } } }),
    db.lot.findMany({ where: { qcStatus: "PENDING_QC", grnLine: { grn: { po: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" } } } }, orderBy: { receivedAt: "desc" }, take, include: { item: true } }),
    db.qcInspection.findMany({ where: { lot: { grnLine: { grn: { po: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" } } } } }, orderBy: { inspectedAt: "desc" }, take, include: { lot: { include: { item: true } } } }),
    db.stockBalance.findMany({ where: { qty: { gt: 0 }, location: { type: "STAGING" }, lot: { qcStatus: { in: ["APPROVED", "DEVIATED"] } } }, include: { lot: { include: { item: true } }, location: true } }),
    db.stockTransaction.findMany({ where: { type: "QC_RELEASE", qty: { gt: 0 } }, orderBy: { createdAt: "desc" }, take, include: { lot: { include: { item: true } }, location: true } }),
    db.materialRequest.findMany({ orderBy: { createdAt: "desc" }, take, include: { lines: { include: { item: true } } } }),
    db.productionBooking.findMany({ orderBy: { producedAt: "desc" }, take, include: { bom: { include: { fgItem: true } }, machine: true } }),
    db.downtime.findMany({ orderBy: { createdAt: "desc" }, take, include: { machine: true } }),
    db.fgBox.findMany({ where: { customer: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" } }, orderBy: { createdAt: "desc" }, take, include: { lot: { include: { item: true } }, customer: true } }),
    db.dispatch.findMany({ where: { customer: { segment: segment as "AUTOMOTIVE" | "NON_AUTOMOTIVE" } }, orderBy: { createdAt: "desc" }, take, include: { customer: true, boxes: true, lines: true } }),
  ]);

  const entries: Record<string, ProcessEntry[]> = {
    sched: imports.filter((i) => i.lines.some((l) => l.customer.segment === segment)).slice(0, take).map((i) =>
      E(i.fileName, person(i.userId), i.createdAt, "Imported", [["Rows", n(i.rowCount)], ["Customers", [...new Set(i.lines.map((l) => l.customer.name))].join(", ") || "—"], ["Replaced forecast rows", n(i.replaced)]])),
    mrp: pos.map((p) => E(p.poNumber, person(p.createdById), p.createdAt,
      p.status === "APPROVED" || p.status === "PARTIAL" ? "Open" : p.status === "CLOSED" ? "Done" : p.status.charAt(0) + p.status.slice(1).toLowerCase(),
      [["Supplier", p.supplier.name], ["Lines", p.lines.map((l) => `${l.item.code} ${n(l.qty)} ${l.item.uom}`).join(", ")]])),
    gate: gates.map((g) => E(g.entryNumber, person(null, "Security"), g.arrivedAt, g.grns.length ? "Done" : "Waiting",
      [["Vehicle", g.vehicleNumber], ["Invoice", g.invoiceNumber], ["PO", g.po?.poNumber ?? "Not matched"]])),
    grn: grns.map((g) => {
      const st = g.lines.map((l) => l.lot?.qcStatus);
      const status = st.includes("PENDING_QC") ? "Pending QC" : st.every((s) => s === "REJECTED") ? "Rejected" : "Released";
      return E(g.grnNumber, person(g.createdById), g.createdAt, status,
        [["PO", g.po.poNumber], ["Supplier", g.po.supplier.name], ["Lots", g.lines.map((l) => `${l.lot?.item.code} ${l.lot?.supplierLotNo}`).join(", ")]], coaPhoto(g.coaUrl));
    }),
    coa: grns.map((g) => {
      const decided = g.lines.every((l) => l.lot && l.lot.qcStatus !== "PENDING_QC");
      return E(`COA-${g.grnNumber}`, person(g.createdById), g.createdAt, decided ? "Verified" : "Pending",
        [["GRN", g.grnNumber], ["COA", g.coaUrl ? (isFileRef(g.coaUrl) ? "Certificate uploaded" : g.coaUrl) : "Not provided"]], coaPhoto(g.coaUrl));
    }),
    qc: [
      ...pendingLots.map((l) => E(l.lotNumber, person(null, "QA queue"), l.receivedAt, "Pending QC", [["Item", `${l.item.code} ${l.item.name}`], ["Heat / lot", l.supplierLotNo], ["Qty", `${n(l.receivedQty)} ${l.item.uom}`]])),
      ...inspections.map((i) => E(`QC-${i.lot.lotNumber}`, person(i.inspectedById), i.inspectedAt,
        i.decision === "APPROVED" ? "Released" : i.decision === "REJECTED" ? "Rejected" : "Deviation",
        [["Item", i.lot.item.code], ["MFI", i.mfi === null ? "—" : String(Number(i.mfi))], ["Moisture", i.moisturePct === null ? "—" : `${Number(i.moisturePct)}%`], ...(i.remarks ? [["Remarks", i.remarks] as [string, string]] : [])])),
    ].slice(0, take),
    store: [
      ...staged.map((b) => E(`PUT-${b.lot.lotNumber}`, person(null, "Store"), b.lot.receivedAt, "To put away", [["Lot", b.lot.lotNumber], ["In", b.location.code], ["Qty", `${n(b.qty)} ${b.lot.item.uom}`]])),
      ...puts.map((p) => E(`PUT-${p.lot.lotNumber}`, person(p.userId), p.createdAt, "Done", [["Lot", p.lot.lotNumber], ["Bin", p.location?.code ?? "—"], ["Qty", `${n(p.qty)} ${p.lot.item.uom}`]])),
    ].slice(0, take),
    issue: requests.map((r) => E(r.requestNumber, person(r.requestedById), r.createdAt, r.status === "OPEN" || r.status === "PARTIAL" ? "Open" : "Issued",
      [["Material", r.lines.map((l) => `${l.item.code} ${n(l.issuedQty)}/${n(l.qty)} ${l.item.uom}`).join(", ")]])),
    mould: [
      ...bookings.map((b) => ({ at: b.producedAt, e: E(b.bookingNumber, person(b.userId), b.producedAt, "Booked", [["Machine", `${b.machine.code} · shift ${b.shift}`], ["Part", b.bom.fgItem.code], ["Shots", n(b.shots)], ["Good / rejected", `${n(b.goodParts)} / ${n(b.rejectParts)}`], ["Runner", `${Number(b.runnerKg)} kg`]]) })),
      ...downs.map((d) => ({ at: d.createdAt, e: E(`DT-${d.machine.code}-${d.day.toISOString().slice(5, 10)}`, person(d.userId), d.createdAt, "Logged", [["Machine", `${d.machine.code} · shift ${d.shift}`], ["Reason", d.reason.replace(/_/g, " ").toLowerCase()], ["Stopped", `${d.minutes} min`]]) })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take).map((x) => x.e),
    fg: boxes.map((b) => E(b.boxCode, person(null, "Packing"), b.createdAt, b.status === "IN_STOCK" ? "Boxed" : "Shipped", [["Part", b.lot.item.code], ["Qty", n(b.qty)], ["Customer", b.customer.name]])),
    disp: dispatches.map((d) => {
      const ordered = d.lines.reduce((a, l) => a + l.qty, 0), scanned = d.boxes.reduce((a, b) => a + b.qty, 0);
      return E(d.dcNumber, person(d.createdById), d.createdAt, d.status === "LOADING" ? "Picking" : d.status === "DISPATCHED" ? "Dispatched" : "Cancelled",
        [["Customer", d.customer.name], ["Vehicle", d.vehicleNumber], ["Loaded", `${n(scanned)} / ${n(ordered)} pcs`]]);
    }),
  };

  return TEMPLATE[seg].map((k) => ({ key: k, ...STAGE[k], entries: entries[k] ?? [] }));
}
