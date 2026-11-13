import Link from "next/link";
import { db } from "@/server/db";
import { rejectedLots } from "@/server/services/rtv";
import { btnCls, inputCls } from "@/components/flash";
import { Card, Eyebrow, Mono } from "@/components/ui";
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
        <div className="grid gap-2.5 md:grid-cols-2">
          {lots.map((l) => (
            <article key={l.lotNumber} className="space-y-2 rounded-[14px] bg-white p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span><Mono className="font-semibold">{l.lotNumber}</Mono> <span className="text-sm text-ink-2">{l.itemCode} · {l.itemName}</span></span>
                <Mono className="text-xs">{l.onHand.toLocaleString()} {l.uom}</Mono>
              </div>
              <div className="text-xs text-ink-3">{l.supplier ?? "No supplier on record"}</div>
              <form action={sendBack} className="space-y-2">
                <input type="hidden" name="lot" value={l.lotNumber} />
                <div className="flex flex-wrap gap-2">
                  <label className="w-32 text-[13px]">Quantity<input name="qty" type="number" step="any" min="0" max={l.onHand} defaultValue={l.onHand} required className={inputCls} /></label>
                  <label className="min-w-40 flex-1 text-[13px]">Reason<input name="reason" required placeholder="e.g. MFI out of spec" className={inputCls} /></label>
                </div>
                <button className={btnCls} disabled={!l.supplier}>Return &amp; create debit note</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="space-y-1.5">
          <Eyebrow>RECENT RETURNS</Eyebrow>
          <div className="overflow-hidden rounded-[14px] bg-white">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                <span><Mono className="font-semibold">{r.rtvNumber}</Mono> <span className="text-ink-3">· {r.supplier.name} · {r.lot.item.code} · {Number(r.qty).toLocaleString()} {r.lot.item.uom}</span></span>
                <Link href={`/rtv/${r.id}/debit-note`} className="flex-none font-semibold text-accent">Debit note {r.debitNoteNumber}</Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
