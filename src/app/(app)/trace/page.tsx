import Link from "next/link";
import { requirePermission } from "@/server/auth/guard";
import { traceQuery, type FgTrace, type MaterialOrigin, type MaterialTrace } from "@/server/services/trace";
import { btnCls, inputCls } from "@/components/flash";
import { CoaRef } from "@/components/coa-ref";
import { PageHeader } from "@/components/ui";

export const instant = false;

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");
const n = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x);

function Origin({ m, nested = false }: { m: MaterialOrigin; nested?: boolean }) {
  return (
    <div className={`rounded-xl bg-white p-3 text-sm ${nested ? "ml-6 border-dashed" : ""}`}>
      <div className="flex flex-wrap justify-between gap-2">
        <div><span className="font-semibold">{m.itemCode}</span> <span className="text-ink-3">{m.itemName}</span></div>
        <div className="text-ink-2">{m.qtyUsed !== null && <>used {m.qtyUsed} · </>}lot <b>{m.lotNumber}</b> · heat/mfr lot <b>{m.supplierLotNo}</b> · {m.qcStatus}</div>
      </div>
      {m.grn && m.po && (
        <div className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-ink-2 md:grid-cols-2">
          <div>Supplier: <b>{m.po.supplier}</b> · PO {m.po.number}</div>
          <div>GRN {m.grn.number} ({d(m.grn.date)}) · invoice {m.grn.invoice ?? "—"} · vehicle {m.grn.vehicle ?? "—"}</div>
          <div>COA: <CoaRef value={m.grn.coa} /></div>
          {m.qc && <div>QC {m.qc.decision} ({d(m.qc.date)}): MFI {n(m.qc.mfi)}, moisture {n(m.qc.moisturePct)}%, density {n(m.qc.density)}, tensile {n(m.qc.tensile)}</div>}
        </div>
      )}
      {m.regrindFrom && (
        <div className="mt-2 space-y-2">
          <div className="text-xs font-medium text-ink-2">Regrind from run {m.regrindFrom.bookingNumber}, made from:</div>
          {m.regrindFrom.materials.length === 0 && <div className="ml-6 text-xs text-warn-ink">That run recorded no material lots.</div>}
          {m.regrindFrom.materials.map((x) => <Origin key={x.lotNumber} m={x} nested />)}
        </div>
      )}
    </div>
  );
}

function Fg({ t }: { t: FgTrace }) {
  return (
    <div className="space-y-5">
      <h2 className="font-display text-base font-bold">Backward trace: where this product came from</h2>
      {t.warnings.map((w) => <p key={w} className="rounded bg-warn-bg p-3 text-sm text-warn-ink">{w}</p>)}

      <section className="grid gap-3 md:grid-cols-3">
        {t.box && (
          <div className="rounded-[14px] bg-white p-4 text-sm"><div className="text-xs uppercase text-ink-3">Box</div>
            <div className="font-semibold">{t.box.boxCode}</div><div>{t.box.qty} parts · {t.box.status}</div><div>For {t.box.customer}</div></div>
        )}
        <div className="rounded-[14px] bg-white p-4 text-sm"><div className="text-xs uppercase text-ink-3">Finished goods lot</div>
          <div className="font-semibold">{t.fgLot.lotNumber}</div><div>{t.fgLot.itemCode} · {t.fgLot.qty.toLocaleString()} parts</div></div>
        {t.booking && (
          <div className="rounded-[14px] bg-white p-4 text-sm"><div className="text-xs uppercase text-ink-3">Production run</div>
            <div className="font-semibold">{t.booking.number}</div>
            <div>{t.booking.machine} · shift {t.booking.shift} · mould {t.booking.mould}</div>
            <div>{d(t.booking.producedAt)} · {t.booking.shots.toLocaleString()} shots · {t.booking.good.toLocaleString()} good / {t.booking.rejects.toLocaleString()} rejected</div></div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm font-bold">Materials used</h3>
        {t.materials.length === 0 ? <p className="text-sm text-ink-3">None recorded.</p> : t.materials.map((m) => <Origin key={m.lotNumber} m={m} />)}
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-sm font-bold">Shipped to customers</h3>
        {t.dispatches.length === 0 ? <p className="text-sm text-ink-3">Not dispatched yet.</p> : (
          <ul className="space-y-1 text-sm">{t.dispatches.map((x) => <li key={x.dcNumber} className="rounded-xl bg-white p-3"><b>{x.dcNumber}</b> · {x.customer} · {d(x.date)} · vehicle {x.vehicle} · {x.boxes} box{x.boxes === 1 ? "" : "es"} ({x.qty.toLocaleString()} parts)</li>)}</ul>
        )}
      </section>
    </div>
  );
}

function Material({ t }: { t: MaterialTrace }) {
  return (
    <div className="space-y-5">
      <h2 className="font-display text-base font-bold">Forward trace: where this material went</h2>
      {t.warnings.map((w) => <p key={w} className="rounded bg-warn-bg p-3 text-sm text-warn-ink">{w}</p>)}

      <section className="space-y-1 text-sm">
        {t.lots.map((l) => (
          <div key={l.lotNumber} className="rounded-xl bg-white p-3"><b>{l.itemCode}</b> · lot <b>{l.lotNumber}</b> · heat/mfr lot <b>{l.supplierLotNo}</b> · {l.receivedQty.toLocaleString()} received · {l.qcStatus}
            {l.supplier && <> · {l.supplier} ({l.grn})</>}</div>
        ))}
      </section>

      {t.customers.length > 0 && (
        <section><h3 className="mb-2 font-medium">Customers affected</h3>
          <div className="overflow-x-auto rounded-[14px] bg-white"><table className="w-full text-sm">
            <thead className="bg-canvas text-left"><tr><th className="p-2">Customer</th><th className="p-2 text-right">Boxes</th><th className="p-2 text-right">Parts boxed</th><th className="p-2 text-right">Already shipped</th></tr></thead>
            <tbody>{t.customers.map((c) => <tr key={c.name} className="border-t"><td className="p-2 font-medium">{c.name}</td><td className="p-2 text-right">{c.boxes}</td><td className="p-2 text-right">{c.qty.toLocaleString()}</td><td className="p-2 text-right">{c.shipped.toLocaleString()}</td></tr>)}</tbody>
          </table></div></section>
      )}

      <section><h3 className="mb-2 font-medium">Production runs that used it</h3>
        <div className="overflow-x-auto rounded-[14px] bg-white"><table className="w-full text-sm">
          <thead className="bg-canvas text-left"><tr><th className="p-2">Run</th><th className="p-2">Date</th><th className="p-2">Machine</th><th className="p-2">Part</th><th className="p-2 text-right">Used</th><th className="p-2 text-right">Good parts</th></tr></thead>
          <tbody>{t.bookings.map((b) => <tr key={b.number} className="border-t"><td className="p-2 font-medium">{b.number}</td><td className="p-2">{d(b.producedAt)}</td><td className="p-2">{b.machine}</td><td className="p-2">{b.part}</td><td className="p-2 text-right">{b.qtyUsed}</td><td className="p-2 text-right">{b.goodParts.toLocaleString()}</td></tr>)}
            {t.bookings.length === 0 && <tr><td className="p-3 text-ink-3" colSpan={6}>None.</td></tr>}</tbody>
        </table></div></section>

      {t.boxes.length > 0 && (
        <section><h3 className="mb-2 font-medium">Boxes containing parts made from it</h3>
          <div className="overflow-x-auto rounded-[14px] bg-white"><table className="w-full text-sm">
            <thead className="bg-canvas text-left"><tr><th className="p-2">Box</th><th className="p-2">Part</th><th className="p-2 text-right">Qty</th><th className="p-2">Customer</th><th className="p-2">Status</th><th className="p-2">DC</th></tr></thead>
            <tbody>{t.boxes.map((b) => <tr key={b.boxCode} className="border-t"><td className="p-2"><Link className="font-semibold text-accent" href={`/trace?q=${b.boxCode}`}>{b.boxCode}</Link></td><td className="p-2">{b.part}</td><td className="p-2 text-right">{b.qty}</td><td className="p-2">{b.customer}</td><td className="p-2">{b.status}</td><td className="p-2">{b.dcNumber ?? "—"}</td></tr>)}</tbody>
          </table></div></section>
      )}
    </div>
  );
}

export default async function TracePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("stock.view");
  const { q } = await searchParams;
  const result = q?.trim() ? await traceQuery(q) : null;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="TRACE & REPORTS" title="Traceability" subtitle="Back and forward trace of any box or lot" />
      <p className="max-w-3xl text-sm text-ink-2">
        Scan or type a <b>box code</b> or <b>finished-goods lot</b> to see the machine, shift, mould, resin heat lot and supplier it came from.
        Type a <b>supplier heat/lot number</b> or an internal <b>material lot</b> to see every production run, box and customer it reached (a recall check).
      </p>
      <form method="get" className="flex max-w-xl gap-3">
        <input name="q" defaultValue={q ?? ""} autoFocus placeholder="BX-…, LOT-…, heat number or booking no." className={inputCls} aria-label="Search" />
        <button className={`${btnCls} mt-1`}>Trace</button>
      </form>
      {result?.kind === "NONE" && <p className="rounded bg-warn-bg p-3 text-sm text-warn-ink">Nothing found for “{result.query}”. Check the code, or try the supplier heat number.</p>}
      {result?.kind === "FG" && <Fg t={result} />}
      {result?.kind === "MATERIAL" && <Material t={result} />}
    </div>
  );
}
