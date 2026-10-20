import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";

export const instant = false;

export default async function LotTag({ params }: { params: Promise<{ lotId: string }> }) {
  await requirePermission("stock.view");
  const { lotId } = await params;
  const lot = await db.lot.findUnique({ where: { id: lotId }, include: { item: true } });
  if (!lot || lot.qcStatus === "PENDING_QC" || lot.qcStatus === "REJECTED") notFound();

  return (
    <div className="w-[10cm] rounded-md border-2 border-ink bg-white p-3 text-ink print:border">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <div className="font-mono text-lg font-medium">{lot.item.code}</div>
          <div>{lot.item.name}</div>
          <div>Lot: <b>{lot.lotNumber}</b></div>
          <div>Heat/Mfr lot: {lot.supplierLotNo}</div>
          <div>Qty: {Number(lot.receivedQty)} {lot.item.uom}</div>
          <div>QC: <b>{lot.qcStatus === "DEVIATED" ? "ACCEPTED (DEVIATION)" : "APPROVED"}</b></div>
          {lot.expiryDate && <div>Use by: {lot.expiryDate.toISOString().slice(0, 10)}</div>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/v1/barcode?type=qr&text=${encodeURIComponent(lot.lotNumber)}`} alt={`QR ${lot.lotNumber}`} width={110} height={110} />
      </div>
      <p className="mt-2 text-xs text-ink-3 print:hidden">Use your browser&apos;s Print to send to the label printer.</p>
    </div>
  );
}
