import { Form } from "@/components/form";
import { db } from "@/server/db";
import { pendingScrap } from "@/server/services/scrap";
import { btnDangerCls, btnOkCls, inputCls } from "@/components/flash";
import { Badge, Card, DataTable, Eyebrow, Mono, ScrollArea } from "@/components/ui";
import { decideScrap } from "../actions";

export async function ScrapTab() {
  const [pending, bins, history] = await Promise.all([
    pendingScrap(),
    db.location.findMany({ where: { type: "STORAGE", active: true }, orderBy: { code: "asc" } }),
    db.scrapDisposition.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { booking: { include: { bom: { include: { fgItem: true } } } } } }),
  ]);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        Rejected parts from production need a QA decision. <b>Regrind</b> crushes them back into usable regrind stock (not allowed for parts with inserts).
        <b> Waste</b> records them as scrapped.
      </p>
      {pending.length === 0 && <Card><p className="text-sm text-ink-3">No rejected parts waiting for a decision.</p></Card>}
      <ScrollArea label="Rejects waiting for a decision">
      <div className="grid gap-3 lg:grid-cols-2">
        {pending.map((p) => (
          <Form key={p.bookingId} action={decideScrap}>
            <Card className="space-y-3">
              <input type="hidden" name="bookingId" value={p.bookingId} />
              <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div><Mono className="font-semibold">{p.bookingNumber}</Mono> · {p.part} · {p.machine}<div className="text-xs text-ink-3">{p.producedAt.toISOString().slice(0, 10)}</div></div>
                <div className="text-right text-xs text-ink-2"><Mono>{p.remaining.toLocaleString()}</Mono> of <Mono>{p.rejectParts.toLocaleString()}</Mono> rejected<br />{p.partWeightG} g each</div>
              </div>
              {p.hasInserts && <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-ink">These parts contain inserts, so they can only be scrapped as waste.</p>}
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-[13px]">Parts<input name="parts" type="number" min="1" max={p.remaining} step="1" defaultValue={p.remaining} required className={inputCls} /></label>
                <label className="text-[13px]">Regrind bin
                  <select name="bin" className={inputCls}><option value="">First storage bin</option>{bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}</select>
                </label>
                <label className="text-[13px] md:col-span-2">Note<input name="note" className={inputCls} /></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button name="kind" value="REGRIND" disabled={p.hasInserts} className={`${btnOkCls} disabled:opacity-40`}>Crush into regrind</button>
                <button name="kind" value="WASTE" className={btnDangerCls}>Scrap as waste</button>
              </div>
            </Card>
          </Form>
        ))}
      </div>
      </ScrollArea>

      <Eyebrow>RECENT DECISIONS</Eyebrow>
      <DataTable scroll>
        <thead><tr><th>When</th><th>Booking</th><th>Part</th><th className="text-right!">Parts</th><th className="text-right!">Weight kg</th><th>Decision</th></tr></thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id}>
              <td><Mono className="text-xs">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Mono></td><td><Mono className="text-xs font-semibold">{h.booking.bookingNumber}</Mono></td><td>{h.booking.bom.fgItem.code}</td>
              <td className="text-right"><Mono>{h.parts.toLocaleString()}</Mono></td><td className="text-right"><Mono>{Number(h.weightKg)}</Mono></td><td><Badge tone={h.kind === "REGRIND" ? "ok" : "danger"}>{h.kind === "REGRIND" ? "Regrind" : "Waste"}</Badge></td>
            </tr>
          ))}
          {history.length === 0 && <tr><td className="text-ink-3" colSpan={6}>Nothing yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
  );
}
