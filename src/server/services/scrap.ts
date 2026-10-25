import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { round } from "./bom-math";
import { DomainError, nextNumber } from "./inventory";
import { findRegrindItemId } from "./production";

type Db = PrismaClient;

export interface PendingScrap {
  bookingId: string; bookingNumber: string; producedAt: Date; part: string; machine: string;
  rejectParts: number; disposed: number; remaining: number; partWeightG: number;
  hasInserts: boolean; // parts with metal inserts can't be reground
}

// Bookings that still have rejected parts nobody has decided about.
export async function pendingScrap(db: Db = defaultDb): Promise<PendingScrap[]> {
  const bookings = await db.productionBooking.findMany({
    where: { rejectParts: { gt: 0 } }, orderBy: { producedAt: "asc" },
    include: { machine: true, scrap: true, bom: { include: { fgItem: true, lines: true } } },
  });
  return bookings
    .map((b) => {
      const disposed = b.scrap.reduce((s, x) => s + x.parts, 0);
      return {
        bookingId: b.id, bookingNumber: b.bookingNumber, producedAt: b.producedAt, part: b.bom.fgItem.code, machine: b.machine.code,
        rejectParts: b.rejectParts, disposed, remaining: b.rejectParts - disposed, partWeightG: Number(b.bom.partWeightG),
        hasInserts: b.bom.lines.some((l) => l.kind === "BOP"),
      };
    })
    .filter((b) => b.remaining > 0);
}

export interface ApproveScrapInput {
  bookingId: string; parts: number; kind: "REGRIND" | "WASTE";
  regrindLocationCode?: string; note?: string; userId?: string;
}

// QA's decision on rejected parts. Waste is just recorded (rejects never entered stock). Regrind turns the parts'
// weight into an approved in-house regrind lot, tagged with the booking so traceability can follow it back.
export async function approveScrap(input: ApproveScrapInput, db: Db = defaultDb) {
  if (!Number.isInteger(input.parts) || input.parts <= 0) throw new DomainError("Enter a whole number of parts above 0.");

  const booking = await db.productionBooking.findUnique({
    where: { id: input.bookingId },
    include: { scrap: true, bom: { include: { lines: { include: { item: true } } } } },
  });
  if (!booking) throw new DomainError("Unknown production booking.");
  const remaining = booking.rejectParts - booking.scrap.reduce((s, x) => s + x.parts, 0);
  if (input.parts > remaining) throw new DomainError(`Only ${remaining} rejected part${remaining === 1 ? "" : "s"} left to decide on for ${booking.bookingNumber}.`);

  const weightKg = round((input.parts * Number(booking.bom.partWeightG)) / 1000, 3);

  if (input.kind === "WASTE") {
    return db.scrapDisposition.create({
      data: { bookingId: booking.id, parts: input.parts, weightKg, kind: "WASTE", note: input.note, approvedById: input.userId },
    });
  }

  if (booking.bom.lines.some((l) => l.kind === "BOP")) {
    throw new DomainError("These parts contain inserts (metal or other bought-out parts), so they can't be reground. Scrap them as waste.");
  }
  const regrindItemId = await findRegrindItemId(db, booking.bom.lines);
  if (!regrindItemId) throw new DomainError("There is no regrind item for this resin grade. Add one in Masters first.");
  const bin = input.regrindLocationCode
    ? await db.location.findUnique({ where: { code: input.regrindLocationCode } })
    : await db.location.findFirst({ where: { type: "STORAGE" }, orderBy: { code: "asc" } });
  if (!bin) throw new DomainError("Regrind bin not found.");
  if (bin.type !== "STORAGE") throw new DomainError("Regrind must be stored in a storage bin.");

  return db.$transaction(async (tx) => {
    const lot = await tx.lot.create({
      data: {
        lotNumber: await nextNumber(tx, "LOT", "lot"), itemId: regrindItemId,
        supplierLotNo: booking.bookingNumber, receivedQty: weightKg, qcStatus: "APPROVED",
      },
    });
    await tx.stockBalance.create({ data: { lotId: lot.id, locationId: bin.id, qty: weightKg } });
    await tx.stockTransaction.create({
      data: { type: "REGRIND_IN", lotId: lot.id, locationId: bin.id, qty: weightKg, refType: "SCRAP", refId: booking.bookingNumber, userId: input.userId },
    });
    return tx.scrapDisposition.create({
      data: { bookingId: booking.id, parts: input.parts, weightKg, kind: "REGRIND", regrindLotId: lot.id, note: input.note, approvedById: input.userId },
    });
  });
}
