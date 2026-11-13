import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { btnCls, btnDangerCls, btnSecondaryCls, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Form } from "@/components/form";
import { Badge, Card, DataTable, Eyebrow, Mono } from "@/components/ui";
import type { HomeUser } from "@/components/home/types";
import { decideSheet, saveSheet, startSheet, submitSheet } from "./count-actions";

const tone = (s: string) => (s === "APPROVED" ? "ok" : s === "REJECTED" ? "danger" : s === "SUBMITTED" ? "info" : "warn") as "ok" | "danger" | "info" | "warn";

/** Stores · Counts: the people who count see their sheets; the people who approve see what is waiting. A role may do either or both. */
export async function CountsTab({ user }: { user: HomeUser }) {
  const counting = can(user, "stock.count"), approving = can(user, "stock.adjust");
  const [bins, open, waiting, recent] = await Promise.all([
    counting ? db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }) : [],
    db.stockCount.findMany({
      where: { status: "OPEN" }, orderBy: { createdAt: "asc" },
      include: { location: true, lines: { include: { lot: { include: { item: true } } }, orderBy: { lot: { lotNumber: "asc" } } } },
    }),
    approving ? db.stockCount.findMany({
      where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" },
      include: { location: true, lines: { include: { lot: { include: { item: true } } } } },
    }) : [],
    db.stockCount.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED", "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 15, include: { location: true, lines: true } }),
  ]);

  return (
    <CreateProvider defaultOpen={counting && open.length === 0 && waiting.length === 0}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm text-ink-2">
            {counting && "Pick a bin, count what is really there and send the differences for approval. "}
            {approving ? "Nothing changes in stock until an approver accepts the count, and that is you." : "Nothing changes in stock until an approver accepts the count."}
          </p>
          {counting && <CreateButton label="Count a bin" />}
        </div>

        {counting && (
          <CreatePanel>
            <Card className="space-y-3">
              <Eyebrow>OPEN A COUNT SHEET</Eyebrow>
              <Form action={startSheet} className="flex flex-wrap items-end gap-3">
                <label className="min-w-48 flex-1 text-[13px]">Bin
                  <select name="bin" required className={inputCls}>
                    <option value="">— choose a bin —</option>
                    {bins.map((b) => <option key={b.id} value={b.code}>{b.code}{b.type === "STAGING" ? " (staging)" : ""}</option>)}
                  </select>
                </label>
                <button className={btnCls}>Open sheet</button>
              </Form>
            </Card>
          </CreatePanel>
        )}

        {approving && (
          <section className="space-y-3">
            <Eyebrow>WAITING FOR YOUR DECISION · {waiting.length}</Eyebrow>
            {waiting.length === 0 && <Card><p className="text-sm text-ink-3">Nothing is waiting for a decision.</p></Card>}
            {waiting.map((c) => {
              const diffs = c.lines.map((l) => ({ l, delta: Number(l.countedQty) - Number(l.systemQty) })).filter((x) => Math.abs(x.delta) > 1e-9);
              return (
                <Card key={c.id} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-sm text-ink-2">· bin {c.location.code} · {c.lines.length} lots counted</span></span>
                    <Badge tone={diffs.length ? "warn" : "ok"}>{diffs.length ? `${diffs.length} difference${diffs.length === 1 ? "" : "s"}` : "No differences"}</Badge>
                  </div>
                  {diffs.length > 0 && (
                    <DataTable>
                      <thead><tr><th>Lot</th><th>Item</th><th className="text-right">System</th><th className="text-right">Counted</th><th className="text-right">Adjust</th></tr></thead>
                      <tbody>
                        {diffs.map(({ l, delta }) => (
                          <tr key={l.id}>
                            <td><Mono>{l.lot.lotNumber}</Mono></td>
                            <td>{l.lot.item.code}</td>
                            <td className="text-right"><Mono>{Number(l.systemQty).toLocaleString()}</Mono></td>
                            <td className="text-right"><Mono>{Number(l.countedQty).toLocaleString()}</Mono></td>
                            <td className={`text-right font-semibold ${delta < 0 ? "text-danger" : "text-ok"}`}><Mono>{delta > 0 ? "+" : ""}{Math.round(delta * 1000) / 1000} {l.lot.item.uom}</Mono></td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                  <Form action={decideSheet} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <label className="min-w-48 flex-1 text-[13px]">Remark <span className="text-ink-3">(needed to reject)</span><input name="note" className={inputCls} /></label>
                    <button name="decision" value="approve" className={btnCls}>Approve &amp; adjust stock</button>
                    <button name="decision" value="reject" className={btnDangerCls}>Reject</button>
                  </Form>
                </Card>
              );
            })}
          </section>
        )}

        {counting && (
          <section className="space-y-3">
            <Eyebrow>COUNT SHEETS IN PROGRESS · {open.length}</Eyebrow>
            {open.length === 0 && <Card><p className="text-sm text-ink-3">No sheets are open. Use &ldquo;Count a bin&rdquo; or open a bin on the bin map and choose Count this bin.</p></Card>}
            {open.map((c) => (
              <Card key={c.id} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-sm text-ink-2">· bin {c.location.code}</span></span>
                  <Badge tone="warn">Counting</Badge>
                </div>
                <Form action={saveSheet} intents={{ submit: submitSheet }} className="space-y-3">
                  <input type="hidden" name="id" value={c.id} />
                  <DataTable>
                    <thead><tr><th>Lot</th><th>Item</th><th className="text-right">System</th><th className="w-36">Counted</th></tr></thead>
                    <tbody>
                      {c.lines.map((l) => (
                        <tr key={l.id}>
                          <td><Mono>{l.lot.lotNumber}</Mono></td>
                          <td>{l.lot.item.code} <span className="text-ink-3">{l.lot.item.uom}</span></td>
                          <td className="text-right"><Mono>{Number(l.systemQty).toLocaleString()}</Mono></td>
                          <td><input name={`qty_${l.lot.lotNumber}`} type="number" step="any" min="0" defaultValue={l.countedQty === null ? "" : Number(l.countedQty)} aria-label={`Counted ${l.lot.lotNumber}`} className="min-h-10 w-full rounded-lg border border-border px-2 text-right" /></td>
                        </tr>
                      ))}
                      {c.lines.length === 0 && <tr><td colSpan={4} className="text-ink-3">The system shows nothing in this bin. Add anything you find below.</td></tr>}
                    </tbody>
                  </DataTable>
                  <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                    <label className="text-[13px]">Found a lot that isn&apos;t listed? Lot number<input name="extraLot" className={inputCls} /></label>
                    <label className="text-[13px]">Quantity<input name="extraQty" type="number" step="any" min="0" className={inputCls} /></label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className={btnSecondaryCls}>Save</button>
                    <button name="intent" value="submit" className={btnCls}>Submit for approval</button>
                  </div>
                </Form>
              </Card>
            ))}
          </section>
        )}

        {recent.length > 0 && (
          <section className="space-y-1.5">
            <Eyebrow>RECENT COUNTS</Eyebrow>
            <div className="overflow-hidden rounded-[14px] bg-white">
              {recent.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                  <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-ink-3">· {c.location.code} · {c.lines.length} lots</span>{c.note && <span className="block text-xs text-ink-3">{c.note}</span>}</span>
                  <Badge tone={tone(c.status)}>{c.status === "SUBMITTED" ? "Waiting" : c.status}</Badge>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </CreateProvider>
  );
}
