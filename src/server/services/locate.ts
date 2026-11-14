import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { normalizeCode } from "@/lib/scan-parse";

type Db = PrismaClient;

export type Located =
  | { kind: "bin"; bin: string }
  | { kind: "lot"; lotNumber: string; itemCode: string; qcStatus: string; bins: string[] }
  | { kind: "box"; boxCode: string; lotNumber: string; itemCode: string; bin: string; status: string }
  | { kind: "item"; itemCode: string }
  | { kind: "none" };

/**
 * What a scanned code is: a bin label, a lot tag, an FG box label or an item code. The bins a lot is in come with it, so a scan
 * can take a person straight to where the product is. Anything else (a supplier's own heat number, say) is also tried as a lot.
 */
export async function locateCode(scanned: string, db: Db = defaultDb): Promise<Located> {
  const code = normalizeCode(scanned);
  if (!code) return { kind: "none" };

  const bin = await db.location.findFirst({ where: { code, active: true } });
  if (bin) return { kind: "bin", bin: bin.code };

  const lot = await db.lot.findFirst({
    where: { OR: [{ lotNumber: code }, { supplierLotNo: { equals: code, mode: "insensitive" } }] },
    include: { item: true, balances: { where: { qty: { gt: 0 } }, include: { location: true } } },
  });
  if (lot) return { kind: "lot", lotNumber: lot.lotNumber, itemCode: lot.item.code, qcStatus: lot.qcStatus, bins: [...new Set(lot.balances.map((b) => b.location.code))] };

  const box = await db.fgBox.findUnique({ where: { boxCode: code }, include: { lot: { include: { item: true } }, location: true } });
  if (box) return { kind: "box", boxCode: box.boxCode, lotNumber: box.lot.lotNumber, itemCode: box.lot.item.code, bin: box.location.code, status: box.status };

  const item = await db.item.findUnique({ where: { code } });
  if (item) return { kind: "item", itemCode: item.code };

  return { kind: "none" };
}
