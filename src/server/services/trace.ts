import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";

type Db = PrismaClient;

export interface MaterialOrigin {
  itemCode: string; itemName: string; category: string;
  lotNumber: string; supplierLotNo: string; qtyUsed: number | null; qcStatus: string;
  grn: { number: string; date: Date; invoice: string | null; vehicle: string | null; coa: string | null } | null;
  po: { number: string; supplier: string } | null;
  qc: { decision: string; mfi: number | null; moisturePct: number | null; density: number | null; tensile: number | null; remarks: string | null; date: Date } | null;
  // regrind is made in-house, so its origin is the earlier production run that produced it
  regrindFrom: { bookingNumber: string; materials: MaterialOrigin[] } | null;
}

export interface FgTrace {
  kind: "FG";
  box: { boxCode: string; qty: number; status: string; customer: string } | null;
  fgLot: { lotNumber: string; itemCode: string; itemName: string; qty: number };
  booking: { number: string; producedAt: Date; shift: string; machine: string; mould: string; shots: number; good: number; rejects: number } | null;
  materials: MaterialOrigin[];
  dispatches: { dcNumber: string; customer: string; date: Date | null; vehicle: string; boxes: number; qty: number }[];
  warnings: string[];
}

export interface MaterialTrace {
  kind: "MATERIAL";
  lots: { lotNumber: string; supplierLotNo: string; itemCode: string; receivedQty: number; qcStatus: string; supplier: string | null; grn: string | null }[];
  bookings: { number: string; producedAt: Date; machine: string; part: string; qtyUsed: number; goodParts: number }[];
  boxes: { boxCode: string; part: string; qty: number; status: string; customer: string; dcNumber: string | null }[];
  customers: { name: string; boxes: number; qty: number; shipped: number }[];
  warnings: string[];
}

export type TraceResult = FgTrace | MaterialTrace | { kind: "NONE"; query: string };

async function originOf(db: Db, lotId: string, qtyUsed: number | null, depth: number): Promise<MaterialOrigin> {
  const lot = await db.lot.findUniqueOrThrow({
    where: { id: lotId },
    include: {
      item: true,
      grnLine: { include: { grn: { include: { gateEntry: true, po: { include: { supplier: true } } } } } },
      inspections: { orderBy: { inspectedAt: "desc" }, take: 1 },
    },
  });
  const g = lot.grnLine?.grn;
  const q = lot.inspections[0];

  let regrindFrom: MaterialOrigin["regrindFrom"] = null;
  if (lot.item.category === "REGRIND" && depth > 0) {
    const src = await db.productionBooking.findUnique({ where: { bookingNumber: lot.supplierLotNo }, include: { lotUses: true } });
    if (src) {
      regrindFrom = {
        bookingNumber: src.bookingNumber,
        materials: await Promise.all(src.lotUses.map((u) => originOf(db, u.lotId, Number(u.qty), depth - 1))),
      };
    }
  }
  return {
    itemCode: lot.item.code, itemName: lot.item.name, category: lot.item.category,
    lotNumber: lot.lotNumber, supplierLotNo: lot.supplierLotNo, qtyUsed, qcStatus: lot.qcStatus,
    grn: g ? { number: g.grnNumber, date: g.createdAt, invoice: g.gateEntry?.invoiceNumber ?? null, vehicle: g.gateEntry?.vehicleNumber ?? null, coa: g.coaUrl } : null,
    po: g ? { number: g.po.poNumber, supplier: g.po.supplier.name } : null,
    qc: q ? { decision: q.decision, mfi: q.mfi === null ? null : Number(q.mfi), moisturePct: q.moisturePct === null ? null : Number(q.moisturePct), density: q.density === null ? null : Number(q.density), tensile: q.tensile === null ? null : Number(q.tensile), remarks: q.remarks, date: q.inspectedAt } : null,
    regrindFrom,
  };
}

async function traceFg(db: Db, fgLotId: string, boxCode?: string): Promise<FgTrace> {
  const lot = await db.lot.findUniqueOrThrow({ where: { id: fgLotId }, include: { item: true } });
  const box = boxCode ? await db.fgBox.findUnique({ where: { boxCode }, include: { customer: true } }) : null;
  const booking = await db.productionBooking.findFirst({
    where: { fgLotId }, include: { machine: true, bom: { include: { mould: true } }, lotUses: true },
  });

  const warnings: string[] = [];
  const materials = booking ? await Promise.all(booking.lotUses.map((u) => originOf(db, u.lotId, Number(u.qty), 3))) : [];
  if (!booking) warnings.push("This lot was not made by a recorded production run, so its materials can't be traced.");
  else if (materials.length === 0) warnings.push(`Production run ${booking.bookingNumber} has no material lots recorded, so the resin and masterbatch can't be traced.`);

  const boxes = await db.fgBox.findMany({ where: { lotId: fgLotId, ...(box ? { id: box.id } : {}), dispatchId: { not: null } }, include: { dispatch: { include: { customer: true } } } });
  const byDc = new Map<string, FgTrace["dispatches"][number]>();
  for (const b of boxes) {
    if (!b.dispatch) continue;
    const cur = byDc.get(b.dispatch.id) ?? { dcNumber: b.dispatch.dcNumber, customer: b.dispatch.customer.name, date: b.dispatch.dispatchedAt, vehicle: b.dispatch.vehicleNumber, boxes: 0, qty: 0 };
    cur.boxes += 1; cur.qty += b.qty;
    byDc.set(b.dispatch.id, cur);
  }

  return {
    kind: "FG",
    box: box ? { boxCode: box.boxCode, qty: box.qty, status: box.status, customer: box.customer.name } : null,
    fgLot: { lotNumber: lot.lotNumber, itemCode: lot.item.code, itemName: lot.item.name, qty: Number(lot.receivedQty) },
    booking: booking ? {
      number: booking.bookingNumber, producedAt: booking.producedAt, shift: booking.shift, machine: booking.machine.code,
      mould: booking.bom.mould.code, shots: booking.shots, good: booking.goodParts, rejects: booking.rejectParts,
    } : null,
    materials, dispatches: [...byDc.values()], warnings,
  };
}

// Recall view: where did material from these lot(s) end up?
async function traceMaterial(db: Db, lotIds: string[]): Promise<MaterialTrace> {
  const lots = await db.lot.findMany({
    where: { id: { in: lotIds } }, include: { item: true, grnLine: { include: { grn: { include: { po: { include: { supplier: true } } } } } } },
  });
  const uses = await db.productionLotUse.findMany({
    where: { lotId: { in: lotIds } },
    include: { booking: { include: { machine: true, bom: { include: { fgItem: true } } } } },
  });

  // A regrind lot made from this material carries it forward into later runs.
  const regrindLots = await db.lot.findMany({ where: { item: { category: "REGRIND" }, supplierLotNo: { in: uses.map((u) => u.booking.bookingNumber) } }, select: { id: true, supplierLotNo: true } });
  const downstream = regrindLots.length
    ? await db.productionLotUse.findMany({
        where: { lotId: { in: regrindLots.map((r) => r.id) } },
        include: { booking: { include: { machine: true, bom: { include: { fgItem: true } } } } },
      })
    : [];

  const bookings = new Map<string, MaterialTrace["bookings"][number]>();
  for (const u of [...uses, ...downstream]) {
    const cur = bookings.get(u.bookingId);
    bookings.set(u.bookingId, {
      number: u.booking.bookingNumber, producedAt: u.booking.producedAt, machine: u.booking.machine.code,
      part: u.booking.bom.fgItem.code, qtyUsed: (cur?.qtyUsed ?? 0) + Number(u.qty), goodParts: u.booking.goodParts,
    });
  }

  const fgLotIds = [...new Set([...uses, ...downstream].map((u) => u.booking.fgLotId).filter((x): x is string => !!x))];
  const boxes = fgLotIds.length
    ? await db.fgBox.findMany({ where: { lotId: { in: fgLotIds } }, include: { lot: { include: { item: true } }, customer: true, dispatch: true }, orderBy: { boxCode: "asc" } })
    : [];

  const customers = new Map<string, MaterialTrace["customers"][number]>();
  for (const b of boxes) {
    const c = customers.get(b.customerId) ?? { name: b.customer.name, boxes: 0, qty: 0, shipped: 0 };
    c.boxes += 1; c.qty += b.qty; if (b.status === "DISPATCHED") c.shipped += b.qty;
    customers.set(b.customerId, c);
  }

  const warnings: string[] = [];
  if (bookings.size === 0) warnings.push("No production run has recorded using this material yet.");
  const unboxed = [...bookings.values()].length > 0 && fgLotIds.length > 0 && boxes.length === 0;
  if (unboxed) warnings.push("Parts made from this material haven't been packed into labelled boxes yet; they are still in finished-goods stock.");

  return {
    kind: "MATERIAL",
    lots: lots.map((l) => ({
      lotNumber: l.lotNumber, supplierLotNo: l.supplierLotNo, itemCode: l.item.code, receivedQty: Number(l.receivedQty), qcStatus: l.qcStatus,
      supplier: l.grnLine?.grn.po.supplier.name ?? null, grn: l.grnLine?.grn.grnNumber ?? null,
    })),
    bookings: [...bookings.values()].sort((a, b) => a.producedAt.getTime() - b.producedAt.getTime()),
    boxes: boxes.map((b) => ({ boxCode: b.boxCode, part: b.lot.item.code, qty: b.qty, status: b.status, customer: b.customer.name, dcNumber: b.dispatch?.dcNumber ?? null })),
    customers: [...customers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

// One search box: a box code, a finished-goods lot, an internal lot number, or a supplier heat/lot number.
export async function traceQuery(raw: string, db: Db = defaultDb): Promise<TraceResult> {
  const q = raw.trim().toUpperCase();
  if (!q) return { kind: "NONE", query: raw };

  const box = await db.fgBox.findUnique({ where: { boxCode: q } });
  if (box) return traceFg(db, box.lotId, box.boxCode);

  const lots = await db.lot.findMany({ where: { OR: [{ lotNumber: q }, { supplierLotNo: { equals: q, mode: "insensitive" } }] }, include: { item: true } });
  if (lots.length === 0) return { kind: "NONE", query: raw };

  // A finished-goods lot (or a booking number, which names one) traces back to its materials; any other
  // lot number or supplier heat number is treated as material and traced forward to customers.
  const fg = lots.find((l) => l.item.category === "FG");
  if (fg) return traceFg(db, fg.id);
  return traceMaterial(db, lots.map((l) => l.id));
}
