import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { challanData } from "@/server/services/dispatch";

export const instant = false;

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ChallanPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("dispatch.manage");
  const { id } = await params;
  if (!(await db.dispatch.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const { dispatch: d, date, items, eway, company } = await challanData(id);

  return (
    <div className="max-w-4xl space-y-5 rounded-lg border bg-white p-6 text-sm text-black print:border-0 print:p-0">
      <div className="flex justify-between border-b pb-3">
        <div>
          <div className="text-lg font-bold">{company.name}</div>
          <div className="text-slate-600">{company.address || "Address not set"}</div>
          <div>GSTIN: {company.gstin || "not set"}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">DELIVERY CHALLAN</div>
          <div>No: <b>{d.dcNumber}</b></div>
          <div>Date: {date.toISOString().slice(0, 10)}</div>
          {d.status !== "DISPATCHED" && <div className="font-semibold text-red-700">DRAFT — {d.status}</div>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="text-xs uppercase text-slate-500">Deliver to</div>
          <div className="font-semibold">{d.customer.name}</div><div>{d.customer.address ?? ""}</div><div>GSTIN: {d.customer.gstin ?? "not set"}</div></div>
        <div><div className="text-xs uppercase text-slate-500">Transport</div>
          <div>Vehicle: <b>{d.vehicleNumber}</b></div><div>Driver: {d.driverName ?? "—"}</div></div>
      </div>

      <table className="w-full">
        <thead className="border-y text-left"><tr><th className="py-1">Description</th><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Value</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.name} className="border-b">
              <td className="py-1">{it.name}</td><td>{it.hsnCode ?? "—"}</td><td className="text-right">{it.qty.toLocaleString()} {it.uom}</td>
              <td className="text-right">{it.unitPrice === null ? "—" : money(it.unitPrice)}</td>
              <td className="text-right">{it.unitPrice === null ? "—" : money(it.qty * it.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4} className="py-1 text-right font-semibold">Total value</td><td className="text-right font-semibold">{money(eway.totalValue)}</td></tr></tfoot>
      </table>

      {d.returnables.length > 0 && (
        <div><div className="text-xs uppercase text-slate-500">Returnable containers sent (to be returned)</div>
          <ul>{d.returnables.map((r) => <li key={r.id}>{r.item.code} · {r.item.name}: <b>{r.qty}</b></li>)}</ul></div>
      )}

      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Packing list — {d.boxes.length} box{d.boxes.length === 1 ? "" : "es"}</div>
        <table className="w-full">
          <thead className="border-y text-left"><tr><th className="py-1">Box</th><th>Part</th><th>Batch</th><th className="text-right">Qty</th></tr></thead>
          <tbody>
            {d.boxes.map((b) => (
              <tr key={b.id} className="border-b"><td className="py-1">{b.boxCode}</td><td>{b.lot.item.code}</td><td>{b.batchCode ?? "—"}</td><td className="text-right">{b.qty.toLocaleString()}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="py-1 text-right font-semibold">Total parts</td><td className="text-right font-semibold">{d.boxes.reduce((s, b) => s + b.qty, 0).toLocaleString()}</td></tr></tfoot>
        </table>
      </div>

      {eway.missing.length > 0 && (
        <div className="rounded bg-amber-50 p-3 text-amber-900 print:hidden">
          <b>E-way bill data is incomplete.</b> Add the following before generating the e-way bill:
          <ul className="list-disc pl-5">{eway.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8 pt-10 text-xs text-slate-600"><div className="border-t pt-1">Prepared by</div><div className="border-t pt-1">Received by (signature &amp; stamp)</div></div>
    </div>
  );
}
