import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createGrn, DomainError } from "@/server/services/inventory";
import { saveUpload } from "@/server/services/storage";
import { CoaRef } from "@/components/coa-ref";
import { WeightInput } from "@/components/weight-input";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

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

export default async function GrnPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; po?: string; q?: string }> }) {
  await requirePermission("grn.create");
  const { error, ok, po: poId, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const openPos = await db.purchaseOrder.findMany({
    where: { status: { in: ["APPROVED", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    include: { supplier: true },
  });
  const selected = poId
    ? await db.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true, lines: { include: { item: true } } } })
    : null;
  const recent = await db.grn.findMany({
    orderBy: { createdAt: "desc" }, take: 100,
    include: { po: true, gateEntry: true, lines: { include: { lot: true } } },
  });

  return (
    <CreateProvider defaultOpen={!!selected}>
    <div className="space-y-4">
      <PageHeader right={<CreateButton label="New GRN" />} eyebrow="INWARD" title="Gate entry & GRN" />
      <Flash error={error} ok={ok} />

      <CreatePanel>
      <div className="space-y-4">
        <Card>
          <form className="flex max-w-xl items-end gap-3" method="get">
            <label className="flex-1 text-[13px]">Receive against PO
              <select name="po" defaultValue={poId ?? ""} className={inputCls}>
                <option value="">Select an open PO…</option>
                {openPos.map((p) => <option key={p.id} value={p.id}>{p.poNumber} · {p.supplier.name} ({p.segment === "AUTOMOTIVE" ? "Auto" : "Non-auto"})</option>)}
              </select>
            </label>
            <button className={btnCls}>Load</button>
          </form>
        </Card>

        {selected && (
          <form action={receive} className="space-y-4">
            <input type="hidden" name="poId" value={selected.id} />
            <Card className="space-y-3">
              <Eyebrow>GATE</Eyebrow>
              <div className="text-sm text-ink-2"><Mono>{selected.poNumber}</Mono> · {selected.supplier.name}</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-[13px]">Vehicle no.<input name="vehicleNumber" required className={inputCls} /></label>
                <label className="text-[13px]">Supplier invoice no.<input name="invoiceNumber" required className={inputCls} /></label>
                <div className="space-y-1 text-[13px]">
                  <div>COA {selected.segment === "AUTOMOTIVE" && <b className="text-danger">(mandatory)</b>}</div>
                  <input name="coaFile" type="file" accept=".pdf,.png,.jpg,.jpeg" aria-label="COA file" className={`${inputCls} py-2.5 text-xs`} />
                  <input name="coaUrl" placeholder="or type a certificate reference" aria-label="COA reference" className={inputCls} />
                </div>
              </div>
            </Card>
            <Card className="space-y-3">
              <Eyebrow>RECEIVE</Eyebrow>
              {selected.lines.map((l) => (
                <div key={l.id} className="grid items-end gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0 md:grid-cols-4">
                  <div className="text-sm"><div className="font-semibold">{l.item.code}</div>
                    <div className="text-ink-3">{l.item.name} · open <Mono>{Number(l.qty) - Number(l.receivedQty)}</Mono> {l.item.uom}</div></div>
                  <div className="text-[13px]"><div>Received qty</div>{l.item.uom === "KG" ? <WeightInput name={`qty_${l.id}`} className={inputCls} /> : <input name={`qty_${l.id}`} type="number" step="any" min="0" aria-label="Received qty" className={inputCls} />}</div>
                  <label className="text-[13px]">Mfr lot / heat no.<input name={`lot_${l.id}`} className={inputCls} /></label>
                  <label className="text-[13px]">Bags<input name={`bags_${l.id}`} type="number" min="0" className={inputCls} /></label>
                </div>
              ))}
            </Card>
            <button className={`${btnCls} w-full md:w-auto`}>Post GRN</button>
          </form>
        )}
      </div>
      </CreatePanel>

      <Eyebrow>RECENT GRNs</Eyebrow>
      <SearchBar q={q} placeholder="Search GRN, PO, vehicle, invoice or lot" clearHref="/grn" />
      <DataTable>
        <thead><tr>
          <th>GRN</th><th>PO</th><th>Vehicle / Invoice</th><th>COA</th><th>Lots (pending QC → QC queue)</th>
        </tr></thead>
        <tbody>
          {recent.filter((g) => matches(q, g.grnNumber, g.po.poNumber, g.gateEntry?.vehicleNumber, g.gateEntry?.invoiceNumber, ...g.lines.map((l) => l.lot?.lotNumber))).map((g) => (
            <tr key={g.id}>
              <td className="font-semibold"><Mono>{g.grnNumber}</Mono></td>
              <td><Mono>{g.po.poNumber}</Mono></td>
              <td>{g.gateEntry?.vehicleNumber} / {g.gateEntry?.invoiceNumber}</td>
              <td><CoaRef value={g.coaUrl} /></td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {g.lines.map((l) => l.lot && (
                    <Badge key={l.id} tone={l.lot.qcStatus === "APPROVED" ? "ok" : l.lot.qcStatus === "REJECTED" ? "danger" : "warn"}>
                      {l.lot.lotNumber} · {l.lot.qcStatus}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td className="text-ink-3" colSpan={5}>No GRNs yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
    </CreateProvider>
  );
}
