import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { suggestPicks } from "./fifo";
import { DomainError, nextNumber, pickableLots } from "./inventory";
import { company } from "@/lib/company";
import { buildEwayData } from "./eway";
import { parseBoxCode } from "./label";

type Db = PrismaClient;

export interface CreateDispatchInput {
  customerId: string;
  vehicleNumber: string;
  driverName?: string;
  lines: { itemId: string; qty: number }[];
  userId?: string;
}

export async function createDispatch(input: CreateDispatchInput, db: Db = defaultDb) {
  if (!input.vehicleNumber.trim()) throw new DomainError("Vehicle number is required.");
  if (input.lines.length === 0) throw new DomainError("Add at least one pick-list line.");
  if (input.lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) throw new DomainError("Pick-list quantities must be whole numbers above 0.");
  if (new Set(input.lines.map((l) => l.itemId)).size !== input.lines.length) throw new DomainError("Each part may appear once on the pick list.");

  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer || !customer.active) throw new DomainError("Choose an active customer.");
  const items = await db.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
  if (items.length !== input.lines.length || items.some((i) => i.category !== "FG")) {
    throw new DomainError("Pick-list lines must be finished-goods parts.");
  }

  return db.$transaction(async (tx) =>
    tx.dispatch.create({
      data: {
        dcNumber: await nextNumber(tx, "DC", "dispatch"),
        customerId: customer.id, vehicleNumber: input.vehicleNumber.trim().toUpperCase(),
        driverName: input.driverName?.trim() || undefined, createdById: input.userId,
        lines: { create: input.lines },
      },
    }),
  );
}

export interface Progress {
  lines: { itemId: string; code: string; name: string; ordered: number; scanned: number }[];
  boxes: { boxCode: string; qty: number; itemCode: string; batchCode: string | null }[];
  complete: boolean;
}

export async function dispatchProgress(dispatchId: string, db: Db = defaultDb): Promise<Progress> {
  const d = await db.dispatch.findUniqueOrThrow({
    where: { id: dispatchId },
    include: { lines: { include: { item: true } }, boxes: { include: { lot: true }, orderBy: { boxCode: "asc" } } },
  });
  const lines = d.lines.map((l) => ({
    itemId: l.itemId, code: l.item.code, name: l.item.name, ordered: l.qty,
    scanned: d.boxes.filter((b) => b.lot.itemId === l.itemId).reduce((s, b) => s + b.qty, 0),
  }));
  return {
    lines,
    boxes: d.boxes.map((b) => ({
      boxCode: b.boxCode, qty: b.qty, batchCode: b.batchCode,
      itemCode: lines.find((l) => l.itemId === b.lot.itemId)?.code ?? "",
    })),
    complete: lines.every((l) => l.scanned === l.ordered),
  };
}

// Validates a scanned label against the pick list before the box goes on the truck.
export async function scanBox(input: { dispatchId: string; scan: string }, db: Db = defaultDb) {
  const code = parseBoxCode(input.scan);
  if (!code) throw new DomainError("Scan a box label.");

  return db.$transaction(async (tx) => {
    const d = await tx.dispatch.findUniqueOrThrow({ where: { id: input.dispatchId }, include: { lines: true, boxes: { include: { lot: true } } } });
    if (d.status !== "LOADING") throw new DomainError(`${d.dcNumber} is ${d.status.toLowerCase()}; boxes can't be added.`);

    const box = await tx.fgBox.findUnique({ where: { boxCode: code }, include: { lot: true } });
    if (!box) throw new DomainError(`Unknown box ${code}.`);
    if (box.status === "DISPATCHED") throw new DomainError(`${code} has already been dispatched.`);
    if (box.dispatchId === d.id) throw new DomainError(`${code} is already scanned on this dispatch.`);
    if (box.dispatchId) throw new DomainError(`${code} is already loaded on another dispatch.`);
    if (box.customerId !== d.customerId) throw new DomainError(`${code} is labelled for a different customer.`);

    const line = d.lines.find((l) => l.itemId === box.lot.itemId);
    if (!line) throw new DomainError(`${code} holds a part that isn't on this pick list.`);
    const scanned = d.boxes.filter((b) => b.lot.itemId === line.itemId).reduce((s, b) => s + b.qty, 0);
    if (scanned + box.qty > line.qty) {
      throw new DomainError(`Adding ${code} (${box.qty}) would exceed the pick list: ${scanned} of ${line.qty} already scanned.`);
    }

    // Guarded update: if two scanners race for the same box, only one wins.
    const claimed = await tx.fgBox.updateMany({ where: { id: box.id, dispatchId: null, status: "IN_STOCK" }, data: { dispatchId: d.id } });
    if (claimed.count !== 1) throw new DomainError(`${code} was just loaded elsewhere.`);
    return { boxCode: code, qty: box.qty, scannedForLine: scanned + box.qty, ordered: line.qty };
  });
}

export async function unscanBox(input: { dispatchId: string; boxCode: string }, db: Db = defaultDb) {
  const d = await db.dispatch.findUniqueOrThrow({ where: { id: input.dispatchId } });
  if (d.status !== "LOADING") throw new DomainError("Only a dispatch that is still loading can be changed.");
  const r = await db.fgBox.updateMany({ where: { boxCode: parseBoxCode(input.boxCode), dispatchId: d.id, status: "IN_STOCK" }, data: { dispatchId: null } });
  if (r.count !== 1) throw new DomainError("That box isn't on this dispatch.");
}

export async function cancelDispatch(dispatchId: string, db: Db = defaultDb) {
  return db.$transaction(async (tx) => {
    const d = await tx.dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
    if (d.status !== "LOADING") throw new DomainError(`${d.dcNumber} is ${d.status.toLowerCase()} and can't be cancelled.`);
    await tx.fgBox.updateMany({ where: { dispatchId: d.id, status: "IN_STOCK" }, data: { dispatchId: null } });
    await tx.dispatch.update({ where: { id: d.id }, data: { status: "CANCELLED" } });
  });
}

export interface CompleteInput {
  dispatchId: string;
  crates?: { itemId: string; qty: number }[]; // returnable containers going out with this load
  userId?: string;
}

// Posts the dispatch: only now does stock leave the bins, box by box, with a ledger entry each.
export async function completeDispatch(input: CompleteInput, db: Db = defaultDb) {
  const crates = (input.crates ?? []).filter((c) => c.qty > 0);
  if (crates.some((c) => !Number.isInteger(c.qty))) throw new DomainError("Crate quantities must be whole numbers.");

  return db.$transaction(async (tx) => {
    const d = await tx.dispatch.findUniqueOrThrow({
      where: { id: input.dispatchId },
      include: { lines: { include: { item: true } }, boxes: { include: { lot: true } } },
    });
    if (d.status !== "LOADING") throw new DomainError(`${d.dcNumber} is already ${d.status.toLowerCase()}.`);
    if (d.boxes.length === 0) throw new DomainError("Scan at least one box before dispatching.");
    for (const l of d.lines) {
      const scanned = d.boxes.filter((b) => b.lot.itemId === l.itemId).reduce((s, b) => s + b.qty, 0);
      if (scanned !== l.qty) throw new DomainError(`${l.item.code}: ${scanned} of ${l.qty} scanned — ${Math.abs(l.qty - scanned)} ${scanned < l.qty ? "short" : "over"}. Fix the pick list or scan the rest.`);
    }

    const crateItems = crates.length ? await tx.item.findMany({ where: { id: { in: crates.map((c) => c.itemId) } } }) : [];
    if (crateItems.length !== crates.length || crateItems.some((i) => i.category !== "RETURNABLE")) {
      throw new DomainError("Crate lines must be returnable containers.");
    }

    for (const b of d.boxes) {
      const bal = await tx.stockBalance.findUnique({ where: { lotId_locationId: { lotId: b.lotId, locationId: b.locationId } } });
      if (!bal || Number(bal.qty) < b.qty) throw new DomainError(`Not enough stock behind box ${b.boxCode}; check bin transfers.`);
      await tx.stockBalance.update({ where: { id: bal.id }, data: { qty: { decrement: b.qty } } });
      await tx.stockTransaction.create({
        data: { type: "DISPATCH", lotId: b.lotId, locationId: b.locationId, qty: -b.qty, refType: "DISPATCH", refId: d.dcNumber, userId: input.userId },
      });
      await tx.fgBox.update({ where: { id: b.id }, data: { status: "DISPATCHED" } });
    }
    for (const c of crates) {
      const crateItem = crateItems.find((i) => i.id === c.itemId)!;
      // Crates we own come out of stock (oldest first); customer-owned crates are tracked in the ledger only.
      if (crateItem.stockTracked) {
        const { picks, shortfall } = suggestPicks(await pickableLots(c.itemId, tx), c.qty);
        if (shortfall > 0) throw new DomainError(`Only ${c.qty - shortfall} ${crateItem.code} in stock; you're sending ${c.qty}.`);
        for (const pick of picks) {
          let left = pick.qty;
          const balances = await tx.stockBalance.findMany({ where: { lotId: pick.lotId, qty: { gt: 0 }, location: { type: "STORAGE" } } });
          for (const b of balances) {
            if (left <= 0) break;
            const take = Math.min(Number(b.qty), left);
            await tx.stockBalance.update({ where: { id: b.id }, data: { qty: { decrement: take } } });
            await tx.stockTransaction.create({
              data: { type: "DISPATCH", lotId: pick.lotId, locationId: b.locationId, qty: -take, refType: "DISPATCH", refId: d.dcNumber, userId: input.userId },
            });
            left -= take;
          }
        }
      }
      await tx.returnableLedger.create({
        data: { customerId: d.customerId, itemId: c.itemId, move: "ISSUED", qty: c.qty, dispatchId: d.id, userId: input.userId },
      });
    }
    return tx.dispatch.update({ where: { id: d.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
  });
}

// ───────── Returnable containers ─────────

export interface ReturnableBalance {
  customerId: string; customerName: string; itemId: string; itemCode: string; itemName: string;
  issued: number; returned: number; balance: number;
}

export async function returnableBalances(db: Db = defaultDb): Promise<ReturnableBalance[]> {
  const sums = await db.returnableLedger.groupBy({ by: ["customerId", "itemId", "move"], _sum: { qty: true } });
  const [customers, items] = await Promise.all([
    db.customer.findMany({ where: { id: { in: [...new Set(sums.map((s) => s.customerId))] } } }),
    db.item.findMany({ where: { id: { in: [...new Set(sums.map((s) => s.itemId))] } } }),
  ]);
  const rows = new Map<string, ReturnableBalance>();
  for (const s of sums) {
    const key = `${s.customerId}:${s.itemId}`;
    const cust = customers.find((c) => c.id === s.customerId)!;
    const item = items.find((i) => i.id === s.itemId)!;
    const row = rows.get(key) ?? {
      customerId: s.customerId, customerName: cust.name, itemId: s.itemId, itemCode: item.code, itemName: item.name,
      issued: 0, returned: 0, balance: 0,
    };
    if (s.move === "ISSUED") row.issued += s._sum.qty ?? 0; else row.returned += s._sum.qty ?? 0;
    row.balance = row.issued - row.returned;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.customerName.localeCompare(b.customerName) || a.itemCode.localeCompare(b.itemCode));
}

export async function recordReturnable(
  input: { customerId: string; itemId: string; move: "ISSUED" | "RETURNED"; qty: number; note?: string; binCode?: string; userId?: string },
  db: Db = defaultDb,
) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new DomainError("Quantity must be a whole number above 0.");
  const [customer, item] = await Promise.all([
    db.customer.findUnique({ where: { id: input.customerId } }),
    db.item.findUnique({ where: { id: input.itemId } }),
  ]);
  if (!customer) throw new DomainError("Choose a customer.");
  if (!item || item.category !== "RETURNABLE") throw new DomainError("Choose a returnable container item.");

  if (input.move === "RETURNED") {
    const row = (await returnableBalances(db)).find((r) => r.customerId === customer.id && r.itemId === item.id);
    const outstanding = row?.balance ?? 0;
    if (input.qty > outstanding) {
      throw new DomainError(`${customer.name} only has ${outstanding} ${item.code} outstanding. Record an opening balance first if they held some before the system started.`);
    }
  }
  // A return of a container we own puts it back in stock. (An "issued" entry is an opening balance: already at the customer.)
  const bin = input.move === "RETURNED" && item.stockTracked
    ? input.binCode
      ? await db.location.findUnique({ where: { code: input.binCode } })
      : await db.location.findFirst({ where: { type: "STORAGE" }, orderBy: { code: "asc" } })
    : null;
  if (input.move === "RETURNED" && item.stockTracked && (!bin || bin.type !== "STORAGE")) throw new DomainError("Choose a storage bin for the returned containers.");

  return db.$transaction(async (tx) => {
    if (bin) {
      const lot = await tx.lot.create({
        data: { lotNumber: await nextNumber(tx, "LOT", "lot"), itemId: item.id, supplierLotNo: `RETURN-${customer.code}`, receivedQty: input.qty, qcStatus: "APPROVED" },
      });
      await tx.stockBalance.create({ data: { lotId: lot.id, locationId: bin.id, qty: input.qty } });
      await tx.stockTransaction.create({
        data: { type: "RETURN", lotId: lot.id, locationId: bin.id, qty: input.qty, refType: "RETURNABLE", refId: customer.code, userId: input.userId },
      });
    }
    return tx.returnableLedger.create({
      data: { customerId: customer.id, itemId: item.id, move: input.move, qty: input.qty, note: input.note, userId: input.userId },
    });
  });
}

// ───────── Challan, packing list and e-way bill data ─────────

// One loader for the printable challan and the e-way JSON download, so they can never disagree.
export async function challanData(dispatchId: string, db: Db = defaultDb) {
  const d = await db.dispatch.findUniqueOrThrow({
    where: { id: dispatchId },
    include: {
      customer: true,
      lines: { include: { item: true } },
      boxes: { include: { lot: { include: { item: true } } }, orderBy: { boxCode: "asc" } },
      returnables: { include: { item: true } },
    },
  });
  const date = d.dispatchedAt ?? d.createdAt;
  const items = d.lines.map((l) => ({
    name: l.item.name, hsnCode: l.item.hsnCode, qty: l.qty, uom: l.item.uom,
    unitPrice: l.item.unitPrice === null ? null : Number(l.item.unitPrice),
  }));
  const eway = buildEwayData({
    dcNumber: d.dcNumber, date, vehicleNumber: d.vehicleNumber, company, items,
    customer: { name: d.customer.name, gstin: d.customer.gstin, address: d.customer.address },
  });
  return { dispatch: d, date, items, eway, company };
}
