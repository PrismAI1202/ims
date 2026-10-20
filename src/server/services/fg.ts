import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError, nextNumber } from "./inventory";
import { buildLabel, type Label, type LabelFormat } from "./label";

type Db = PrismaClient;

export interface PackBoxesInput {
  lotNumber: string;
  binCode: string;
  customerId: string;
  qtyPerBox: number;
  boxCount: number;
  userId?: string;
}

// Parts in a bin that are not yet inside a labelled box.
export async function unboxedQty(db: Db, lotId: string, locationId: string) {
  const [bal, boxed] = await Promise.all([
    db.stockBalance.findUnique({ where: { lotId_locationId: { lotId, locationId } } }),
    db.fgBox.aggregate({ _sum: { qty: true }, where: { lotId, locationId, status: "IN_STOCK" } }),
  ]);
  return Number(bal?.qty ?? 0) - (boxed._sum.qty ?? 0);
}

// Splits part of an FG lot into labelled boxes for one customer. Stock stays on the lot; the boxes
// reserve it, and it only leaves when the box is scanned onto a completed dispatch.
export async function packBoxes(input: PackBoxesInput, db: Db = defaultDb) {
  if (!Number.isInteger(input.qtyPerBox) || input.qtyPerBox <= 0) throw new DomainError("Quantity per box must be a whole number above 0.");
  if (!Number.isInteger(input.boxCount) || input.boxCount < 1 || input.boxCount > 200) throw new DomainError("Number of boxes must be between 1 and 200.");

  const [lot, loc, customer] = await Promise.all([
    db.lot.findUnique({ where: { lotNumber: input.lotNumber.trim() }, include: { item: true } }),
    db.location.findUnique({ where: { code: input.binCode.trim() } }),
    db.customer.findUnique({ where: { id: input.customerId } }),
  ]);
  if (!lot) throw new DomainError(`Unknown lot ${input.lotNumber}.`);
  if (lot.item.category !== "FG") throw new DomainError(`${lot.lotNumber} is not a finished-goods lot.`);
  if (lot.qcStatus !== "APPROVED") throw new DomainError(`Lot ${lot.lotNumber} is ${lot.qcStatus}.`);
  if (!loc) throw new DomainError(`Unknown bin ${input.binCode}.`);
  if (!customer || !customer.active) throw new DomainError("Choose an active customer.");

  const total = input.qtyPerBox * input.boxCount;
  const free = await unboxedQty(db, lot.id, loc.id);
  if (total > free) throw new DomainError(`Only ${free} unboxed parts of ${lot.lotNumber} are in ${loc.code}; you asked for ${total}.`);

  // Label data comes from the production run that made the lot.
  const booking = await db.productionBooking.findFirst({ where: { fgLotId: lot.id }, include: { machine: true } });

  return db.$transaction(async (tx) => {
    const boxes = [];
    for (let n = 0; n < input.boxCount; n++) {
      boxes.push(await tx.fgBox.create({
        data: {
          boxCode: await nextNumber(tx, "BX", "fgBox"),
          lotId: lot.id, customerId: customer.id, locationId: loc.id, qty: input.qtyPerBox,
          shift: booking?.shift, machineCode: booking?.machine.code,
          batchCode: booking?.bookingNumber ?? lot.supplierLotNo,
          producedDate: booking?.producedAt ?? lot.receivedAt,
        },
      }));
    }
    return boxes;
  });
}

// Everything needed to print a box's label, in the customer's label format.
export async function boxLabel(boxCode: string, db: Db = defaultDb): Promise<(Label & { boxCode: string; customerName: string }) | null> {
  const box = await db.fgBox.findUnique({
    where: { boxCode: boxCode.trim().toUpperCase() },
    include: { lot: { include: { item: true } }, customer: true },
  });
  if (!box) return null;
  const label = buildLabel({
    format: (box.customer.labelFormat === "OEM" ? "OEM" : "GENERIC") as LabelFormat,
    partNo: box.lot.item.code, partName: box.lot.item.name, batchCode: box.batchCode ?? box.lot.supplierLotNo,
    shift: box.shift ?? "-", machineCode: box.machineCode ?? "-", qty: box.qty,
    date: box.producedDate, boxCode: box.boxCode,
  });
  return { ...label, boxCode: box.boxCode, customerName: box.customer.name };
}
