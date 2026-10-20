import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createGrn, DomainError } from "@/server/services/inventory";
import { saveUpload } from "@/server/services/storage";
import { CoaRef } from "@/components/coa-ref";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function receive(formData: FormData) {
  "use server";
  const user = await requirePermission("grn.create");
  const poId = String(formData.get("poId"));
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  await runAction("/grn", "GRN posted. Lots are in staging, pending QC.", async () => {
    const lines = po.lines
      .map((l) => ({
        poLineId: l.id,
        qty: Number(formData.get(`qty_${l.id}`) || 0),
        supplierLotNo: String(formData.get(`lot_${l.id}`) || ""),
        bags: formData.get(`bags_${l.id}`) ? Number(formData.get(`bags_${l.id}`)) : undefined,
      }))
      .filter((l) => l.qty > 0);
    // An uploaded certificate wins over a typed reference.
    let coaUrl = String(formData.get("coaUrl") || "").trim() || undefined;
    const file = formData.get("coaFile");
    if (file instanceof File && file.size > 0) {
      try {
        coaUrl = await saveUpload({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      } catch (e) {
        throw e instanceof DomainError ? e : new DomainError("The certificate could not be saved.");
      }
    }
    await createGrn({
      poId,
      vehicleNumber: String(formData.get("vehicleNumber")),
      invoiceNumber: String(formData.get("invoiceNumber")),
      coaUrl,
      lines,
      userId: user.id,
    });
  });
}

export default async function GrnPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; po?: string }> }) {
  await requirePermission("grn.create");
  const { error, ok, po: poId } = await searchParams;
  const openPos = await db.purchaseOrder.findMany({
    where: { status: { in: ["APPROVED", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    include: { supplier: true },
  });
  const selected = poId
    ? await db.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true, lines: { include: { item: true } } } })
    : null;
  const recent = await db.grn.findMany({
    orderBy: { createdAt: "desc" }, take: 10,
    include: { po: true, gateEntry: true, lines: { include: { lot: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Gate Entry &amp; GRN</h1>
      <Flash error={error} ok={ok} />

      <form className="flex max-w-xl items-end gap-3" method="get">
        <label className="flex-1 text-sm">Receive against PO
          <select name="po" defaultValue={poId ?? ""} className={inputCls}>
            <option value="">Select an open PO…</option>
            {openPos.map((p) => <option key={p.id} value={p.id}>{p.poNumber} · {p.supplier.name} ({p.segment === "AUTOMOTIVE" ? "Auto" : "Non-auto"})</option>)}
          </select>
        </label>
        <button className={btnCls}>Load</button>
      </form>

      {selected && (
        <form action={receive} className="max-w-4xl space-y-4 rounded-lg border bg-white p-4">
          <input type="hidden" name="poId" value={selected.id} />
          <div className="text-sm text-slate-600">{selected.poNumber} · {selected.supplier.name}</div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">Vehicle no.<input name="vehicleNumber" required className={inputCls} /></label>
            <label className="text-sm">Supplier invoice no.<input name="invoiceNumber" required className={inputCls} /></label>
            <div className="space-y-1 text-sm">
              <div>COA {selected.segment === "AUTOMOTIVE" && <b className="text-red-700">(mandatory)</b>}</div>
              <input name="coaFile" type="file" accept=".pdf,.png,.jpg,.jpeg" aria-label="COA file" className={`${inputCls} text-xs`} />
              <input name="coaUrl" placeholder="or type a certificate reference" aria-label="COA reference" className={inputCls} />
            </div>
          </div>
          {selected.lines.map((l) => (
            <div key={l.id} className="grid items-end gap-3 border-t pt-3 md:grid-cols-4">
              <div className="text-sm"><div className="font-medium">{l.item.code}</div>
                <div className="text-slate-500">{l.item.name} · open {Number(l.qty) - Number(l.receivedQty)} {l.item.uom}</div></div>
              <label className="text-sm">Received qty<input name={`qty_${l.id}`} type="number" step="any" min="0" className={inputCls} /></label>
              <label className="text-sm">Mfr lot / heat no.<input name={`lot_${l.id}`} className={inputCls} /></label>
              <label className="text-sm">Bags<input name={`bags_${l.id}`} type="number" min="0" className={inputCls} /></label>
            </div>
          ))}
          <button className={btnCls}>Post GRN</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">GRN</th><th className="p-2">PO</th><th className="p-2">Vehicle / Invoice</th><th className="p-2">COA</th><th className="p-2">Lots (pending QC → QC queue)</th>
          </tr></thead>
          <tbody>
            {recent.map((g) => (
              <tr key={g.id} className="border-t">
                <td className="p-2 font-medium">{g.grnNumber}</td>
                <td className="p-2">{g.po.poNumber}</td>
                <td className="p-2">{g.gateEntry?.vehicleNumber} / {g.gateEntry?.invoiceNumber}</td>
                <td className="p-2"><CoaRef value={g.coaUrl} /></td>
                <td className="p-2">{g.lines.map((l) => l.lot && `${l.lot.lotNumber} (${l.lot.qcStatus})`).join(", ")}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No GRNs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
