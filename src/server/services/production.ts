import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import {
  expectedConsumption, KIND_CATEGORY, round, runnerKg, validateBomLines, validateBooking,
  type BomLineInput,
} from "./bom-math";
import { DomainError, nextNumber } from "./inventory";

type Db = PrismaClient;

// ───────── BOM ─────────

export interface SaveBomInput {
  fgItemId: string;
  mouldId: string;
  partWeightG: number;
  lines: BomLineInput[];
}

// Creates or replaces the BOM for a finished part, enforcing the blend and max-regrind rules.
export async function saveBom(input: SaveBomInput, db: Db = defaultDb) {
  if (!(input.partWeightG > 0)) throw new DomainError("Part weight must be greater than 0.");

  const [fg, mould] = await Promise.all([
    db.item.findUnique({ where: { id: input.fgItemId } }),
    db.mould.findUnique({ where: { id: input.mouldId } }),
  ]);
  if (!fg || fg.category !== "FG") throw new DomainError("Choose a finished-goods item for the BOM.");
  if (!mould) throw new DomainError("Choose a mould.");

  const items = await db.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of input.lines) {
    const item = byId.get(l.itemId);
    if (!item) throw new DomainError("A BOM line refers to an item that does not exist.");
    if (item.category !== KIND_CATEGORY[l.kind]) {
      throw new DomainError(`${item.code} is ${item.category.replace("_", " ")}; it can't be used as a ${l.kind.toLowerCase()} line.`);
    }
  }

  // Strictest max-regrind among the resins in the blend.
  const limits = input.lines
    .filter((l) => l.kind === "RESIN")
    .map((l) => byId.get(l.itemId)?.maxRegrindPct)
    .filter((v): v is NonNullable<typeof v> => v !== null && v !== undefined)
    .map(Number);
  const regrindLimit = limits.length ? Math.min(...limits) : undefined;

  const errors = validateBomLines(input.lines, regrindLimit);
  if (errors.length) throw new DomainError(errors[0]);

  // Regrind must be the same polymer family as the resin it dilutes.
  const grades = new Set(
    input.lines.filter((l) => l.kind === "RESIN").map((l) => byId.get(l.itemId)?.polymerGrade).filter(Boolean),
  );
  for (const l of input.lines.filter((x) => x.kind === "REGRIND")) {
    const g = byId.get(l.itemId)?.polymerGrade;
    if (g && grades.size > 0 && !grades.has(g)) {
      throw new DomainError(`Regrind ${byId.get(l.itemId)?.code} is ${g}, but the resin in this BOM is ${[...grades].join("/")}.`);
    }
  }

  const lineData = input.lines.map((l) => ({
    itemId: l.itemId, kind: l.kind, pct: l.pct ?? null, qtyPerPart: l.qtyPerPart ?? null,
  }));
  return db.$transaction(async (tx) => {
    const existing = await tx.bom.findUnique({ where: { fgItemId: input.fgItemId } });
    if (existing) {
      await tx.bomLine.deleteMany({ where: { bomId: existing.id } });
      return tx.bom.update({
        where: { id: existing.id },
        data: { mouldId: input.mouldId, partWeightG: input.partWeightG, lines: { create: lineData } },
        include: { lines: true },
      });
    }
    return tx.bom.create({
      data: { fgItemId: input.fgItemId, mouldId: input.mouldId, partWeightG: input.partWeightG, lines: { create: lineData } },
      include: { lines: true },
    });
  });
}

// ───────── Production booking ─────────

export interface BookProductionInput {
  bomId: string;
  machineId: string;
  shift: "A" | "B" | "C";
  shots: number;
  goodParts: number;
  rejectParts: number;
  runnerKgActual?: number; // weighed runner/sprue; defaults to mould runner weight × shots
  regrindLocationCode?: string; // bin for the regrind lot; defaults to the first storage bin
  fgLocationCode?: string; // bin for the finished-goods lot; defaults to the first storage bin
  note?: string;
  userId?: string;
}

export async function bookProduction(input: BookProductionInput, db: Db = defaultDb) {
  const bom = await db.bom.findUnique({
    where: { id: input.bomId },
    include: { mould: true, lines: { include: { item: true } } },
  });
  if (!bom) throw new DomainError("Unknown BOM.");
  const machine = await db.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) throw new DomainError("Choose a machine.");

  const errors = validateBooking({ ...input, cavities: bom.mould.cavities });
  if (errors.length) throw new DomainError(errors[0]);
  if (input.runnerKgActual !== undefined && !(input.runnerKgActual >= 0)) {
    throw new DomainError("Runner weight can't be negative.");
  }

  const runnerWeightG = Number(bom.mould.runnerWeightG ?? 0);
  const runner = input.runnerKgActual ?? runnerKg(input.shots, runnerWeightG);

  const expected = expectedConsumption({
    lines: bom.lines.map((l) => ({
      itemId: l.itemId, kind: l.kind, pct: l.pct === null ? undefined : Number(l.pct),
      qtyPerPart: l.qtyPerPart === null ? undefined : Number(l.qtyPerPart),
    })),
    cavities: bom.mould.cavities, partWeightG: Number(bom.partWeightG), runnerWeightG,
    shots: input.shots, goodParts: input.goodParts, rejectParts: input.rejectParts,
  });

  // Which stock item receives the runner: the BOM's own regrind item, else a REGRIND item of the resin's grade.
  let regrindItemId = bom.lines.find((l) => l.kind === "REGRIND")?.itemId;
  if (!regrindItemId) {
    const grade = bom.lines.find((l) => l.kind === "RESIN")?.item.polymerGrade;
    if (grade) {
      regrindItemId = (await db.item.findFirst({ where: { category: "REGRIND", polymerGrade: grade, active: true } }))?.id;
    }
  }
  const bin = runner > 0 && regrindItemId
    ? input.regrindLocationCode
      ? await db.location.findUnique({ where: { code: input.regrindLocationCode } })
      : await db.location.findFirst({ where: { type: "STORAGE" }, orderBy: { code: "asc" } })
    : null;
  if (runner > 0 && regrindItemId && !bin) throw new DomainError("Regrind bin not found.");
  if (bin && bin.type !== "STORAGE") throw new DomainError("Regrind must be stored in a storage bin.");

  // Good parts become an approved finished-goods lot so they can be packed into labelled boxes and dispatched.
  const fgBin = input.goodParts > 0
    ? input.fgLocationCode
      ? await db.location.findUnique({ where: { code: input.fgLocationCode } })
      : await db.location.findFirst({ where: { type: "STORAGE" }, orderBy: { code: "asc" } })
    : null;
  if (input.goodParts > 0 && !fgBin) throw new DomainError("Finished-goods bin not found.");
  if (fgBin && fgBin.type !== "STORAGE") throw new DomainError("Finished goods must be stored in a storage bin.");

  return db.$transaction(async (tx) => {
    const bookingNumber = await nextNumber(tx, "PB", "productionBooking");

    let fgLotId: string | undefined;
    if (fgBin) {
      const fgLot = await tx.lot.create({
        data: {
          lotNumber: await nextNumber(tx, "LOT", "lot"),
          itemId: bom.fgItemId, supplierLotNo: bookingNumber, receivedQty: input.goodParts,
          qcStatus: "APPROVED", // inspected at the press; rejects are booked separately
        },
      });
      await tx.stockBalance.create({ data: { lotId: fgLot.id, locationId: fgBin.id, qty: input.goodParts } });
      await tx.stockTransaction.create({
        data: { type: "PRODUCTION_IN", lotId: fgLot.id, locationId: fgBin.id, qty: input.goodParts, refType: "PRODUCTION", refId: bookingNumber, userId: input.userId },
      });
      fgLotId = fgLot.id;
    }

    let regrindLotId: string | undefined;
    if (runner > 0 && regrindItemId && bin) {
      const lot = await tx.lot.create({
        data: {
          lotNumber: await nextNumber(tx, "LOT", "lot"),
          itemId: regrindItemId, supplierLotNo: bookingNumber, receivedQty: runner,
          qcStatus: "APPROVED", // in-house regrind from approved virgin material
        },
      });
      await tx.stockBalance.create({ data: { lotId: lot.id, locationId: bin.id, qty: runner } });
      await tx.stockTransaction.create({
        data: { type: "REGRIND_IN", lotId: lot.id, locationId: bin.id, qty: runner, refType: "PRODUCTION", refId: bookingNumber, userId: input.userId },
      });
      regrindLotId = lot.id;
    }

    const booking = await tx.productionBooking.create({
      data: {
        bookingNumber, bomId: bom.id, machineId: machine.id, shift: input.shift,
        shots: input.shots, goodParts: input.goodParts, rejectParts: input.rejectParts,
        runnerKg: runner, regrindLotId, fgLotId, note: input.note, userId: input.userId,
        consumption: { create: expected.map((e) => ({ itemId: e.itemId, expectedQty: e.expectedQty })) },
      },
      include: { consumption: true },
    });
    return { booking, regrindLotId, fgLotId, regrindSkipped: runner > 0 && !regrindItemId };
  });
}

// ───────── BOM vs actual variance ─────────

export interface VarianceRow {
  itemId: string; code: string; name: string; uom: string;
  expected: number; issued: number; variance: number; variancePct: number | null;
}

// Expected = what the BOM says the bookings should have used. Issued = what the store actually
// handed to the floor in the same window. A big positive variance points at over-use or scrap.
export async function varianceReport(from: Date, to: Date, db: Db = defaultDb) {
  const [consumption, issues, bookings] = await Promise.all([
    db.bookingConsumption.groupBy({
      by: ["itemId"], _sum: { expectedQty: true },
      where: { booking: { producedAt: { gte: from, lt: to } } },
    }),
    db.issueLine.groupBy({
      by: ["requestLineId"], _sum: { qty: true }, where: { issuedAt: { gte: from, lt: to } },
    }),
    db.productionBooking.aggregate({
      _sum: { goodParts: true, rejectParts: true, runnerKg: true, shots: true }, _count: true,
      where: { producedAt: { gte: from, lt: to } },
    }),
  ]);

  // Issues are stored per request line; roll them up to items.
  const lineItems = await db.materialRequestLine.findMany({
    where: { id: { in: issues.map((i) => i.requestLineId) } }, select: { id: true, itemId: true },
  });
  const itemOfLine = new Map(lineItems.map((l) => [l.id, l.itemId]));
  const issuedByItem = new Map<string, number>();
  for (const i of issues) {
    const itemId = itemOfLine.get(i.requestLineId);
    if (itemId) issuedByItem.set(itemId, (issuedByItem.get(itemId) ?? 0) + Number(i._sum.qty ?? 0));
  }
  const expectedByItem = new Map(consumption.map((c) => [c.itemId, Number(c._sum.expectedQty ?? 0)]));

  const ids = [...new Set([...expectedByItem.keys(), ...issuedByItem.keys()])];
  const items = await db.item.findMany({ where: { id: { in: ids } }, orderBy: { code: "asc" } });
  const rows: VarianceRow[] = items.map((it) => {
    const expected = expectedByItem.get(it.id) ?? 0;
    const issued = issuedByItem.get(it.id) ?? 0;
    return {
      itemId: it.id, code: it.code, name: it.name, uom: it.uom,
      expected: round(expected, 3), issued: round(issued, 3), variance: round(issued - expected, 3),
      variancePct: expected > 0 ? round(((issued - expected) / expected) * 100, 1) : null,
    };
  });

  return {
    rows,
    totals: {
      bookings: bookings._count,
      shots: bookings._sum.shots ?? 0,
      goodParts: bookings._sum.goodParts ?? 0,
      rejectParts: bookings._sum.rejectParts ?? 0,
      runnerKg: Number(bookings._sum.runnerKg ?? 0),
    },
  };
}
