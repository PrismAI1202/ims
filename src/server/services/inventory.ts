import { Prisma, type PrismaClient, type QcStatus } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { checkFifo, suggestPicks, type PickableLot } from "./fifo";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export async function nextNumber(
  tx: Tx, prefix: string,
  table: "purchaseOrder" | "grn" | "gateEntry" | "materialRequest" | "lot" | "productionBooking" | "fgBox" | "dispatch",
) {
  const count = await (tx[table] as unknown as { count: () => Promise<number> }).count();
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `${prefix}-${stamp}-${String(count + 1).padStart(4, "0")}`;
}

// ───────── Purchase orders ─────────

export interface CreatePoInput {
  supplierId: string;
  segment: "AUTOMOTIVE" | "NON_AUTOMOTIVE";
  lines: { itemId: string; qty: number; price?: number; expectedDate?: Date }[];
  userId?: string;
}

export async function createPurchaseOrder(input: CreatePoInput, db: Db = defaultDb) {
  if (input.lines.length === 0) throw new DomainError("A PO needs at least one line.");
  const supplier = await db.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
  return db.$transaction(async (tx) => {
    const poNumber = await nextNumber(tx, "PO", "purchaseOrder");
    const lines = [];
    for (const l of input.lines) {
      if (!(l.qty > 0)) throw new DomainError("PO line quantity must be positive.");
      const master = await tx.priceMaster.findUnique({
        where: { itemId_supplierId: { itemId: l.itemId, supplierId: input.supplierId } },
      });
      const price = l.price ?? Number(master?.price ?? 0);
      const expectedDate = l.expectedDate ?? new Date(Date.now() + supplier.leadTimeDays * 86_400_000);
      lines.push({ itemId: l.itemId, qty: l.qty, price, expectedDate });
    }
    return tx.purchaseOrder.create({
      data: {
        poNumber, supplierId: input.supplierId, segment: input.segment,
        createdById: input.userId, status: "APPROVED",
        lines: { create: lines },
      },
      include: { lines: true },
    });
  });
}

// ───────── GRN ─────────

export interface CreateGrnInput {
  poId: string;
  vehicleNumber: string;
  invoiceNumber: string;
  coaUrl?: string;
  lines: { poLineId: string; qty: number; supplierLotNo: string; bags?: number; expiryDate?: Date }[];
  userId?: string;
}

export async function createGrn(input: CreateGrnInput, db: Db = defaultDb) {
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: input.poId },
    include: { lines: { include: { item: true } } },
  });
  if (po.status === "CANCELLED" || po.status === "CLOSED" || po.status === "DRAFT") {
    throw new DomainError(`PO ${po.poNumber} is ${po.status} and cannot be received against.`);
  }
  if (input.lines.length === 0) throw new DomainError("Enter at least one received line.");

  const needsCoa =
    po.segment === "AUTOMOTIVE" ||
    input.lines.some((l) => po.lines.find((pl) => pl.id === l.poLineId)?.item.requiresCoa);
  if (needsCoa && !input.coaUrl?.trim()) {
    throw new DomainError("A COA reference is mandatory before GRN for automotive POs / COA-controlled items.");
  }

  const staging = await db.location.findFirst({ where: { type: "STAGING" } });
  if (!staging) throw new DomainError("No staging location configured.");

  return db.$transaction(async (tx) => {
    const gate = await tx.gateEntry.create({
      data: {
        entryNumber: await nextNumber(tx, "GE", "gateEntry"),
        poId: po.id, vehicleNumber: input.vehicleNumber, invoiceNumber: input.invoiceNumber,
      },
    });
    const grn = await tx.grn.create({
      data: {
        grnNumber: await nextNumber(tx, "GRN", "grn"),
        gateEntryId: gate.id, poId: po.id, coaUrl: input.coaUrl, createdById: input.userId,
      },
    });

    for (const l of input.lines) {
      const poLine = po.lines.find((pl) => pl.id === l.poLineId);
      if (!poLine) throw new DomainError("Line does not belong to this PO.");
      if (!(l.qty > 0)) throw new DomainError("Received quantity must be positive.");
      if (!l.supplierLotNo.trim()) throw new DomainError("Manufacturer lot / heat number is required.");

      const grnLine = await tx.grnLine.create({ data: { grnId: grn.id, poLineId: poLine.id } });
      const expiryDate =
        l.expiryDate ??
        (poLine.item.shelfLifeDays ? new Date(Date.now() + poLine.item.shelfLifeDays * 86_400_000) : undefined);
      const lot = await tx.lot.create({
        data: {
          lotNumber: await nextNumber(tx, "LOT", "lot"),
          itemId: poLine.itemId, grnLineId: grnLine.id,
          supplierLotNo: l.supplierLotNo.trim(), bags: l.bags, receivedQty: l.qty, expiryDate,
          qcStatus: "PENDING_QC",
        },
      });
      await tx.stockBalance.create({ data: { lotId: lot.id, locationId: staging.id, qty: l.qty } });
      await tx.stockTransaction.create({
        data: {
          type: "GRN_IN", lotId: lot.id, locationId: staging.id, qty: l.qty,
          refType: "GRN", refId: grn.id, userId: input.userId,
        },
      });
      await tx.purchaseOrderLine.update({
        where: { id: poLine.id }, data: { receivedQty: { increment: l.qty } },
      });
    }

    const fresh = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const allDone = fresh.every((pl) => Number(pl.receivedQty) >= Number(pl.qty));
    await tx.purchaseOrder.update({
      where: { id: po.id }, data: { status: allDone ? "CLOSED" : "PARTIAL" },
    });
    return grn;
  });
}

// ───────── QC ─────────

export interface QcInput {
  lotId: string;
  decision: Extract<QcStatus, "APPROVED" | "REJECTED" | "DEVIATED">;
  mfi?: number; moisturePct?: number; density?: number; tensile?: number;
  remarks?: string; coaUrl?: string;
  putawayLocationCode?: string; // required to move an approved lot out of staging
  userId?: string;
}

export async function recordQc(input: QcInput, db: Db = defaultDb) {
  return db.$transaction(async (tx) => {
    const lot = await tx.lot.findUniqueOrThrow({ where: { id: input.lotId }, include: { balances: { include: { location: true } } } });
    if (lot.qcStatus !== "PENDING_QC") throw new DomainError(`Lot ${lot.lotNumber} is already ${lot.qcStatus}.`);
    if (input.decision === "DEVIATED" && !input.remarks?.trim()) {
      throw new DomainError("A deviation needs remarks.");
    }

    await tx.qcInspection.create({
      data: {
        lotId: lot.id, decision: input.decision, mfi: input.mfi, moisturePct: input.moisturePct,
        density: input.density, tensile: input.tensile, remarks: input.remarks, coaUrl: input.coaUrl,
        inspectedById: input.userId,
      },
    });
    await tx.lot.update({ where: { id: lot.id }, data: { qcStatus: input.decision } });

    if (input.decision !== "REJECTED" && input.putawayLocationCode) {
      const dest = await tx.location.findUnique({ where: { code: input.putawayLocationCode } });
      if (!dest) throw new DomainError(`Unknown bin ${input.putawayLocationCode}.`);
      if (dest.type !== "STORAGE") throw new DomainError("Put-away bin must be a storage location.");
      for (const b of lot.balances.filter((x) => x.location.type === "STAGING" && Number(x.qty) > 0)) {
        await moveWithin(tx, lot.id, b.locationId, dest.id, Number(b.qty), {
          type: "QC_RELEASE", userId: input.userId, refType: "QC",
        });
      }
    }
    return tx.lot.findUniqueOrThrow({ where: { id: lot.id } });
  });
}

// ───────── Stock movement ─────────

async function moveWithin(
  tx: Tx, lotId: string, fromId: string, toId: string, qty: number,
  meta: { type: "TRANSFER" | "QC_RELEASE"; userId?: string; refType: string; clientUuid?: string },
) {
  const from = await tx.stockBalance.findUnique({ where: { lotId_locationId: { lotId, locationId: fromId } } });
  if (!from || Number(from.qty) < qty) throw new DomainError("Insufficient stock in the source bin.");
  await tx.stockBalance.update({ where: { id: from.id }, data: { qty: { decrement: qty } } });
  await tx.stockBalance.upsert({
    where: { lotId_locationId: { lotId, locationId: toId } },
    update: { qty: { increment: qty } },
    create: { lotId, locationId: toId, qty },
  });
  await tx.stockTransaction.create({
    data: { type: meta.type, lotId, locationId: fromId, qty: -qty, refType: meta.refType, userId: meta.userId, clientUuid: meta.clientUuid ? `${meta.clientUuid}:out` : undefined },
  });
  await tx.stockTransaction.create({
    data: { type: meta.type, lotId, locationId: toId, qty, refType: meta.refType, userId: meta.userId, clientUuid: meta.clientUuid ? `${meta.clientUuid}:in` : undefined },
  });
}

export interface TransferInput {
  lotNumber: string; fromCode: string; toCode: string; qty: number;
  clientUuid?: string; userId?: string;
}

// Idempotent on clientUuid so an offline-queued scan can be replayed safely.
export async function transferStock(input: TransferInput, db: Db = defaultDb) {
  if (!(input.qty > 0)) throw new DomainError("Quantity must be positive.");
  if (input.fromCode === input.toCode) throw new DomainError("Source and destination bins are the same.");
  return db.$transaction(async (tx) => {
    if (input.clientUuid) {
      const seen = await tx.stockTransaction.findUnique({ where: { clientUuid: `${input.clientUuid}:out` } });
      if (seen) return { replayed: true as const };
    }
    const lot = await tx.lot.findUnique({ where: { lotNumber: input.lotNumber } });
    if (!lot) throw new DomainError(`Unknown lot ${input.lotNumber}.`);
    if (lot.qcStatus === "PENDING_QC" || lot.qcStatus === "REJECTED") {
      throw new DomainError(`Lot ${lot.lotNumber} is ${lot.qcStatus}; it cannot be moved into storage.`);
    }
    const [from, to] = await Promise.all([
      tx.location.findUnique({ where: { code: input.fromCode } }),
      tx.location.findUnique({ where: { code: input.toCode } }),
    ]);
    if (!from) throw new DomainError(`Unknown bin ${input.fromCode}.`);
    if (!to) throw new DomainError(`Unknown bin ${input.toCode}.`);

    // Parts already inside labelled boxes are reserved for dispatch and must stay put.
    const boxed = (await tx.fgBox.aggregate({
      _sum: { qty: true }, where: { lotId: lot.id, locationId: from.id, status: "IN_STOCK" },
    }))._sum.qty ?? 0;
    if (boxed > 0) {
      const bal = await tx.stockBalance.findUnique({ where: { lotId_locationId: { lotId: lot.id, locationId: from.id } } });
      const free = Number(bal?.qty ?? 0) - boxed;
      if (input.qty > free) {
        throw new DomainError(`${boxed} parts of ${lot.lotNumber} in ${from.code} are already in labelled boxes; only ${Math.max(free, 0)} can be moved.`);
      }
    }
    await moveWithin(tx, lot.id, from.id, to.id, input.qty, {
      type: "TRANSFER", userId: input.userId, refType: "TRANSFER", clientUuid: input.clientUuid,
    });
    return { replayed: false as const };
  });
}

// ───────── Material requests & issue ─────────

export async function createMaterialRequest(
  input: { machineId?: string; lines: { itemId: string; qty: number }[]; userId?: string },
  db: Db = defaultDb,
) {
  if (input.lines.length === 0) throw new DomainError("A request needs at least one line.");
  if (input.lines.some((l) => !(l.qty > 0))) throw new DomainError("Quantities must be positive.");
  return db.$transaction(async (tx) =>
    tx.materialRequest.create({
      data: {
        requestNumber: await nextNumber(tx, "MR", "materialRequest"),
        machineId: input.machineId, requestedById: input.userId,
        lines: { create: input.lines },
      },
    }),
  );
}

// Usable, pickable lots for an item: approved/deviated, in storage bins (not staging).
export async function pickableLots(itemId: string, db: Db | Tx = defaultDb): Promise<(PickableLot & { locations: { code: string; qty: number }[] })[]> {
  const lots = await db.lot.findMany({
    where: { itemId, qcStatus: { in: ["APPROVED", "DEVIATED"] } },
    include: { balances: { include: { location: true } } },
  });
  return lots
    .map((l) => {
      const locations = l.balances
        .filter((b) => b.location.type === "STORAGE" && Number(b.qty) > 0)
        .map((b) => ({ code: b.location.code, qty: Number(b.qty) }));
      return {
        lotId: l.id, lotNumber: l.lotNumber, receivedAt: l.receivedAt, expiryDate: l.expiryDate,
        available: locations.reduce((s, x) => s + x.qty, 0), locations,
      };
    })
    .filter((l) => l.available > 0);
}

export async function suggestIssue(itemId: string, qty: number, db: Db = defaultDb) {
  return suggestPicks(await pickableLots(itemId, db), qty);
}

export interface IssueInput {
  requestLineId: string;
  lotNumber: string;
  locationCode: string;
  qty: number;
  fifoOverrideReason?: string;
  clientUuid?: string;
  userId?: string;
}

export async function issueStock(input: IssueInput, db: Db = defaultDb) {
  if (!(input.qty > 0)) throw new DomainError("Quantity must be positive.");
  return db.$transaction(async (tx) => {
    if (input.clientUuid) {
      const seen = await tx.issueLine.findUnique({ where: { clientUuid: input.clientUuid } });
      if (seen) return { replayed: true as const };
    }
    const line = await tx.materialRequestLine.findUniqueOrThrow({ where: { id: input.requestLineId } });
    const lot = await tx.lot.findUnique({ where: { lotNumber: input.lotNumber } });
    if (!lot) throw new DomainError(`Unknown lot ${input.lotNumber}.`);
    if (lot.itemId !== line.itemId) throw new DomainError("Scanned lot is a different item than requested.");
    if (lot.qcStatus !== "APPROVED" && lot.qcStatus !== "DEVIATED") {
      throw new DomainError(`Lot ${lot.lotNumber} is ${lot.qcStatus} and cannot be issued.`);
    }
    const remaining = Number(line.qty) - Number(line.issuedQty);
    if (input.qty > remaining + 1e-9) throw new DomainError(`Only ${remaining} left to issue on this request line.`);

    const lots = await pickableLots(line.itemId, tx);
    const fifo = checkFifo(lots, lot.id);
    if (!fifo.ok && !input.fifoOverrideReason?.trim()) {
      throw new DomainError(`FIFO/FEFO: lot ${fifo.shouldPick.lotNumber} must be issued first (or give an override reason).`);
    }

    const bin = await tx.location.findUnique({ where: { code: input.locationCode } });
    if (!bin) throw new DomainError(`Unknown bin ${input.locationCode}.`);
    const bal = await tx.stockBalance.findUnique({ where: { lotId_locationId: { lotId: lot.id, locationId: bin.id } } });
    if (!bal || Number(bal.qty) < input.qty) throw new DomainError("Insufficient stock of that lot in that bin.");

    await tx.stockBalance.update({ where: { id: bal.id }, data: { qty: { decrement: input.qty } } });
    await tx.stockTransaction.create({
      data: {
        type: "ISSUE", lotId: lot.id, locationId: bin.id, qty: -input.qty,
        refType: "ISSUE", refId: line.id, userId: input.userId,
      },
    });
    await tx.issueLine.create({
      data: {
        requestLineId: line.id, lotId: lot.id, qty: input.qty,
        fifoOverrideReason: fifo.ok ? undefined : input.fifoOverrideReason,
        clientUuid: input.clientUuid, issuedById: input.userId,
      },
    });
    await tx.materialRequestLine.update({ where: { id: line.id }, data: { issuedQty: { increment: input.qty } } });

    const lines = await tx.materialRequestLine.findMany({ where: { requestId: line.requestId } });
    const done = lines.every((l) => Number(l.issuedQty) >= Number(l.qty));
    const any = lines.some((l) => Number(l.issuedQty) > 0);
    await tx.materialRequest.update({
      where: { id: line.requestId }, data: { status: done ? "ISSUED" : any ? "PARTIAL" : "OPEN" },
    });
    return { replayed: false as const };
  });
}
