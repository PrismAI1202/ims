import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireViewWith } from "@/server/auth/guard";
import { debitNoteData } from "@/server/services/rtv";

export const instant = false;

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function DebitNotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireViewWith("quality", "rtv.manage");
  const { id } = await params;
  if (!(await db.returnToVendor.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const { rtv, company, date, rate, qty, value, poNumber } = await debitNoteData(id);

  return (
    <div className="max-w-3xl space-y-5 rounded-lg border bg-white p-6 text-sm text-black print:border-0 print:p-0">
      <div className="flex justify-between border-b pb-3">
        <div>
          <div className="text-lg font-bold">{company.name}</div>
          <div className="text-slate-600">{company.address || "Address not set"}</div>
          <div>GSTIN: {company.gstin || "not set"}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">DEBIT NOTE</div>
          <div>No: <b>{rtv.debitNoteNumber}</b></div>
          <div>Date: {date.toISOString().slice(0, 10)}</div>
          <div>Return ref: {rtv.rtvNumber}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="text-xs uppercase text-slate-500">To (supplier)</div>
          <div className="font-semibold">{rtv.supplier.name}</div><div>Code: {rtv.supplier.code}</div></div>
        <div><div className="text-xs uppercase text-slate-500">Against</div>
          <div>PO: <b>{poNumber ?? "—"}</b></div><div>Their lot / heat no.: <b>{rtv.lot.supplierLotNo}</b></div><div>Our lot: {rtv.lot.lotNumber}</div></div>
      </div>

      <table className="w-full">
        <thead className="border-y text-left"><tr><th className="py-1">Description</th><th>HSN</th><th className="text-right">Qty returned</th><th className="text-right">Rate</th><th className="text-right">Value</th></tr></thead>
        <tbody>
          <tr className="border-b">
            <td className="py-1">{rtv.lot.item.code} · {rtv.lot.item.name}</td><td>{rtv.lot.item.hsnCode ?? "—"}</td>
            <td className="text-right">{qty.toLocaleString()} {rtv.lot.item.uom}</td><td className="text-right">{money(rate)}</td><td className="text-right">{money(value)}</td>
          </tr>
        </tbody>
        <tfoot><tr><td colSpan={4} className="py-1 text-right font-semibold">Amount to be debited (before tax)</td><td className="text-right font-semibold">{money(value)}</td></tr></tfoot>
      </table>

      <div><div className="text-xs uppercase text-slate-500">Reason for return</div><div>{rtv.reason}</div></div>
      <p className="text-xs text-slate-600">Material is returned as it was rejected on inward inspection. Please issue a credit note or a replacement against the PO above.</p>

      <div className="grid grid-cols-2 gap-8 pt-10 text-xs text-slate-600"><div className="border-t pt-1">Prepared by</div><div className="border-t pt-1">Received by supplier (signature &amp; stamp)</div></div>
    </div>
  );
}
