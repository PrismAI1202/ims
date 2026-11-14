import { Form } from "@/components/form";
import Link from "next/link";
import { db } from "@/server/db";
import { rejectedLots } from "@/server/services/rtv";
import { btnCls, inputCls } from "@/components/flash";
import { CoaRef } from "@/components/coa-ref";
import { Card, Eyebrow, Mono, ScrollArea } from "@/components/ui";
import { sendBack } from "../actions";

export async function ReturnsTab() {
  const [lots, recent] = await Promise.all([
    rejectedLots(),
    db.returnToVendor.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { supplier: true, lot: { include: { item: true } } } }),
  ]);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        Rejected lots stay in staging until they are sent back. Recording a return takes the stock out and creates the debit note, priced from the PO the lot arrived on.
      </p>
      <section className="space-y-1.5">
        <Eyebrow>REJECTED LOTS</Eyebrow>
        {lots.length === 0 && <Card><p className="text-sm text-ink-3">No rejected lots are waiting to go back.</p></Card>}
        <ScrollArea label="Rejected lots">
        <div className="grid gap-2.5 md:grid-cols-2">
          {lots.map((l) => (
            <article key={l.lotNumber} className="space-y-3 rounded-[14px] bg-white p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span><Mono className="font-semibold">{l.lotNumber}</Mono> <span className="text-sm text-ink-2">{l.itemCode} · {l.itemName}</span></span>
                <Mono className="text-xs">{l.onHand.toLocaleString()} {l.uom}</Mono>
              </div>
              <div className="text-xs text-ink-3">
                {l.supplier ?? "No supplier on record"}
                {l.grnNumber && <> · <Mono>{l.grnNumber}</Mono></>}
                {l.supplierLotNo && <> · heat/lot <Mono>{l.supplierLotNo}</Mono></>}
                {l.coaUrl && <> · COA <CoaRef value={l.coaUrl} /></>}
              </div>

              <div className="space-y-2 rounded-xl border-l-4 border-[#B42318] bg-canvas p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-danger">Why it was rejected</span>
                  {l.qc && <span className="text-xs text-ink-3">{l.qc.decidedAt.toISOString().slice(0, 10)}{l.qc.inspector && ` · ${l.qc.inspector}`}</span>}
                </div>
                {!l.qc && <p className="text-sm text-ink-3">No inspection is on record for this lot.</p>}
                {l.qc && (
                  <>
                    <p className="text-sm">{l.qc.remarks?.trim() || <span className="text-ink-3">The inspector left no remarks.</span>}</p>
                    <dl className="flex flex-wrap gap-1.5 text-[11px]">
                      {([
                        ["MFI", l.qc.mfi, "g/10min"], ["Moisture", l.qc.moisturePct, "%"], ["Density", l.qc.density, "g/cm³"], ["Tensile", l.qc.tensile, "MPa"],
                      ] as const).filter(([, v]) => v !== null).map(([k, v, u]) => (
                        <span key={k} className="rounded-md bg-white px-2 py-1"><dt className="inline text-ink-3">{k} </dt><dd className="inline font-mono font-semibold">{v} {u}</dd></span>
                      ))}
                      {l.qc.countedQty !== null && (
                        <span className={`rounded-md px-2 py-1 ${l.qc.countedQty !== l.receivedQty ? "bg-warn-bg text-warn-ink" : "bg-white"}`}>
                          <dt className="inline text-ink-3">Counted </dt><dd className="inline font-mono font-semibold">{l.qc.countedQty.toLocaleString()} of {l.receivedQty.toLocaleString()} {l.uom}</dd>
                        </span>
                      )}
                      {l.qc.mfi === null && l.qc.moisturePct === null && l.qc.density === null && l.qc.tensile === null && l.qc.countedQty === null && <span className="text-ink-3">No test results were recorded.</span>}
                    </dl>
                  </>
                )}
              </div>

              <Form action={sendBack} className="space-y-2">
                <input type="hidden" name="lot" value={l.lotNumber} />
                <div className="flex flex-wrap gap-2">
                  <label className="w-32 text-[13px]">Quantity<input name="qty" type="number" step="any" min="0" max={l.onHand} defaultValue={l.onHand} required className={inputCls} /></label>
                  <label className="min-w-48 flex-1 text-[13px]">Reason on the debit note <span className="text-ink-3">(from the QC; edit if needed)</span>
                    <textarea name="reason" required rows={3} defaultValue={l.suggestedReason} placeholder="e.g. MFI out of spec" className={`${inputCls} py-2.5`} />
                  </label>
                </div>
                <button className={btnCls} disabled={!l.supplier}>Return &amp; create debit note</button>
              </Form>
            </article>
          ))}
        </div>
        </ScrollArea>
      </section>

      {recent.length > 0 && (
        <section className="space-y-1.5">
          <Eyebrow>RECENT RETURNS</Eyebrow>
          <ScrollArea size="md" label="Recent returns"><div className="overflow-hidden rounded-[14px] bg-white">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                <span><Mono className="font-semibold">{r.rtvNumber}</Mono> <span className="text-ink-3">· {r.supplier.name} · {r.lot.item.code} · {Number(r.qty).toLocaleString()} {r.lot.item.uom}</span></span>
                <Link href={`/rtv/${r.id}/debit-note`} className="flex-none font-semibold text-accent">Debit note {r.debitNoteNumber}</Link>
              </div>
            ))}
          </div></ScrollArea>
        </section>
      )}
    </div>
  );
}
