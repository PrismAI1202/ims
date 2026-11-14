import { Prisma, type PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { DomainError, nextNumber } from "./inventory";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

// Physical count of one bin, then an approver's decision. The count is a snapshot of the system quantities plus what
// Store found; approving writes ADJUST ledger rows (and moves the balances) for each difference.

/** The differences a count would post: counted minus the snapshot. Lots with no difference are left out. */
export function differences(lines: { lotNumber: string; systemQty: number; countedQty: number | null }[]) {
  return lines
    .filter((l) => l.countedQty !== null && Math.abs(l.countedQty - l.systemQty) > 1e-9)
    .map((l) => ({ lotNumber: l.lotNumber, delta: Math.round((l.countedQty! - l.systemQty) * 1000) / 1000 }));
}

/** Opens a count for a bin with every lot the system says is there. One open count per bin at a time. */
export async function startCount(input: { locationCode: string; userId?: string }, db: Db = defaultDb) {
  const loc = await db.location.findFirst({ where: { code: input.locationCode.trim(), active: true } });
  if (!loc) throw new DomainError(`Unknown bin ${input.locationCode}.`);
  const open = await db.stockCount.findFirst({ where: { locationId: loc.id, status: { in: ["OPEN", "SUBMITTED"] } } });
  if (open) throw new DomainError(`${loc.code} already has count ${open.countNumber} in progress.`);
  const balances = await db.stockBalance.findMany({ where: { locationId: loc.id, qty: { gt: 0 } } });
  return db.$transaction(async (tx) =>
    tx.stockCount.create({
      data: {
        countNumber: await nextNumber(tx, "SC", "stockCount"), locationId: loc.id, countedById: input.userId,
        lines: { create: balances.map((b) => ({ lotId: b.lotId, systemQty: b.qty })) },
      },
    }),
  );
}

/** Saves counted quantities, by lot number. A lot not on the sheet (found in the bin) is added with system quantity 0. */
export async function saveCount(
  id: string, entries: { lotNumber: string; countedQty: number | null }[], userId: string | undefined, db: Db = defaultDb,
) {
  const count = await db.stockCount.findUnique({ where: { id }, include: { lines: true } });
  if (!count) throw new DomainError("Unknown count.");
  if (count.status !== "OPEN") throw new DomainError(`${count.countNumber} is ${count.status.toLowerCase()} and can't be edited.`);
  await db.$transaction(async (tx) => {
    for (const e of entries) {
      if (e.countedQty !== null && (!Number.isFinite(e.countedQty) || e.countedQty < 0)) throw new DomainError("Counted quantities can't be negative.");
      const lot = await tx.lot.findUnique({ where: { lotNumber: e.lotNumber.trim() } });
      if (!lot) throw new DomainError(`Unknown lot ${e.lotNumber}.`);
      const line = count.lines.find((l) => l.lotId === lot.id);
      if (line) await tx.stockCountLine.update({ where: { id: line.id }, data: { countedQty: e.countedQty } });
      else if (e.countedQty !== null) await tx.stockCountLine.create({ data: { countId: id, lotId: lot.id, systemQty: 0, countedQty: e.countedQty } });
    }
    await tx.stockCount.update({ where: { id }, data: { countedById: userId ?? count.countedById } });
  });
}

export async function submitCount(id: string, userId: string | undefined, db: Db = defaultDb) {
  const count = await db.stockCount.findUnique({ where: { id }, include: { lines: { include: { lot: true } } } });
  if (!count) throw new DomainError("Unknown count.");
  if (count.status !== "OPEN") throw new DomainError(`${count.countNumber} is already ${count.status.toLowerCase()}.`);
  const missing = count.lines.filter((l) => l.countedQty === null);
  if (missing.length) throw new DomainError(`Enter a count for ${missing.map((l) => l.lot.lotNumber).join(", ")}, or 0 if it isn't there.`);
  const r = await db.stockCount.updateMany({ where: { id, status: "OPEN" }, data: { status: "SUBMITTED", submittedAt: new Date(), countedById: userId ?? count.countedById } });
  if (r.count !== 1) throw new DomainError(`${count.countNumber} was just submitted.`);
}

async function adjust(tx: Tx, line: { lotId: string; lotNumber: string }, locationId: string, locationCode: string, delta: number, countId: string, userId?: string) {
  const bal = await tx.stockBalance.findUnique({ where: { lotId_locationId: { lotId: line.lotId, locationId } } });
  const next = Number(bal?.qty ?? 0) + delta;
  if (next < -1e-9) throw new DomainError(`${line.lotNumber}: stock in ${locationCode} has since dropped, so this adjustment would go below zero. Ask for a fresh count.`);
  // Parts already in labelled boxes are reserved for dispatch; the count can't say fewer than that are here.
  const boxed = (await tx.fgBox.aggregate({ _sum: { qty: true }, where: { lotId: line.lotId, locationId, status: "IN_STOCK" } }))._sum.qty ?? 0;
  if (next < boxed) throw new DomainError(`${line.lotNumber}: ${boxed} parts are in labelled boxes in ${locationCode}, so the count can't be below that. Unbox or correct the boxes first.`);
  await tx.stockBalance.upsert({
    where: { lotId_locationId: { lotId: line.lotId, locationId } },
    update: { qty: { increment: delta } }, create: { lotId: line.lotId, locationId, qty: delta },
  });
  await tx.stockTransaction.create({
    data: { type: "ADJUST", lotId: line.lotId, locationId, qty: delta, refType: "STOCK_COUNT", refId: countId, userId, note: "Physical count" },
  });
}

/** Approves (posting the differences) or rejects (needs a remark) a submitted count. */
export async function decideCount(
  input: { id: string; approve: boolean; note?: string; userId?: string }, db: Db = defaultDb,
) {
  if (!input.approve && !input.note?.trim()) throw new DomainError("Say why the count is rejected.");
  return db.$transaction(async (tx) => {
    const count = await tx.stockCount.findUnique({ where: { id: input.id }, include: { location: true, lines: { include: { lot: true } } } });
    if (!count) throw new DomainError("Unknown count.");
    const claimed = await tx.stockCount.updateMany({
      where: { id: input.id, status: "SUBMITTED" },
      data: { status: input.approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedById: input.userId, note: input.note?.trim() || null },
    });
    if (claimed.count !== 1) throw new DomainError(`${count.countNumber} is ${count.status.toLowerCase()}; only a submitted count can be decided.`);
    if (!input.approve) return { adjusted: 0 };
    let adjusted = 0;
    for (const l of count.lines) {
      const delta = Math.round((Number(l.countedQty) - Number(l.systemQty)) * 1000) / 1000;
      if (Math.abs(delta) < 1e-9) continue;
      await adjust(tx, { lotId: l.lotId, lotNumber: l.lot.lotNumber }, count.locationId, count.location.code, delta, count.id, input.userId);
      adjusted++;
    }
    return { adjusted };
  });
}
