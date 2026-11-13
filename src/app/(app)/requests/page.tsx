import { Form } from "@/components/form";
import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { pickableLots } from "@/server/services/inventory";
import { sortForPicking } from "@/server/services/fifo";
import { returnableLots } from "@/server/services/returns";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader, StoresTabs } from "@/components/ui";
import { giveBack, issueLine, raiseRequest } from "./actions";

export const instant = false;

/**
 * Material requests: one flow, three owners. The page shows only the steps the viewer's role takes part in: production raises a
 * requisition and returns leftovers, stores issue FIFO and take material back. Everyone who can open it sees the requisitions list.
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string }> }) {
  const user = await requireView("requests");
  const { error, ok, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const raise = can(user, "request.create"), issuer = can(user, "stock.issue"), returner = can(user, "material.return");

  const [items, machines, requests, bins, outAtMachines, recentReturns] = await Promise.all([
    raise ? db.item.findMany({ where: { active: true, category: { notIn: ["FG", "RETURNABLE"] } }, orderBy: { code: "asc" } }) : [],
    raise ? db.machine.findMany({ where: { active: true }, orderBy: { code: "asc" } }) : [],
    db.materialRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { lines: { include: { item: true } } } }),
    returner ? db.location.findMany({ where: { type: "STORAGE", active: true }, orderBy: { code: "asc" } }) : [],
    returner ? returnableLots() : [],
    returner ? db.stockTransaction.findMany({
      where: { type: "RETURN", refType: "MACHINE_RETURN" }, orderBy: { createdAt: "desc" }, take: 8,
      include: { lot: { include: { item: true } }, location: true },
    }) : [],
  ]);

  // Stores: every open line with the lots to pick from, oldest first.
  const toIssue = issuer
    ? await Promise.all(requests.filter((r) => r.status === "OPEN" || r.status === "PARTIAL").reverse().flatMap((r) =>
        r.lines.filter((l) => Number(l.issuedQty) < Number(l.qty)).map(async (l) => ({
          request: r, line: l, remaining: Number(l.qty) - Number(l.issuedQty), lots: sortForPicking(await pickableLots(l.itemId)),
        }))))
    : [];
  const binOptions = bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>);
  const waiting = requests.filter((r) => r.status === "OPEN" || r.status === "PARTIAL").length;

  const subtitle = [raise && "raise", issuer && "issue", returner && "return"].filter(Boolean).join(" · ");

  return (
    <CreateProvider>
      <div className="space-y-5">
        <PageHeader
          eyebrow="STORES" title="Material requests" subtitle={`${waiting} open · your part: ${subtitle}`}
          right={<span className="flex gap-2">{raise && <CreateButton label="New requisition" />}{returner && <CreateButton label="Return a lot" id="return" />}</span>}
        >
          <StoresTabs active="requests" user={user} />
        </PageHeader>
        <Flash error={error} ok={ok} />

        {raise && (
          <CreatePanel>
            <Card>
              <Form action={raiseRequest} className="grid gap-3 md:grid-cols-4">
                <label className="text-[13px] md:col-span-2">Item
                  <select name="itemId" required className={inputCls}>{items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select>
                </label>
                <label className="text-[13px]">Qty<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
                <label className="text-[13px]">Machine
                  <select name="machineId" className={inputCls}><option value="">—</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select>
                </label>
                <div className="md:col-span-4"><button className={`${btnCls} w-full md:w-auto`}>Raise request</button></div>
              </Form>
            </Card>
          </CreatePanel>
        )}

        {issuer && (
          <section className="space-y-3">
            <div>
              <Eyebrow>TO ISSUE · {toIssue.length}</Eyebrow>
              <p className="mt-1 text-sm text-ink-2">Pick in the order shown. Scanning a newer lot while an older one has stock is blocked unless you give a reason.</p>
            </div>
            {toIssue.length === 0 && <Card><p className="text-sm text-ink-3">No open material requests.</p></Card>}
            {toIssue.map(({ request, line, remaining, lots }) => (
              <Form key={line.id} action={issueLine}>
                <Card className="space-y-3">
                  <input type="hidden" name="requestLineId" value={line.id} />
                  <div className="text-sm"><Mono className="font-semibold">{request.requestNumber}</Mono> · {line.item.code} {line.item.name} · <b>{remaining} {line.item.uom}</b> still to issue</div>
                  <div className="text-sm text-ink-2">
                    {lots.length === 0 ? <span className="font-semibold text-danger">No approved stock available.</span> : (
                      <ol className="list-decimal pl-5">
                        {lots.map((l) => (
                          <li key={l.lotId}><Mono className="text-xs">{l.lotNumber}</Mono> — {l.locations.map((x) => `${x.code}: ${x.qty}`).join(", ")}{l.expiryDate && ` (exp ${l.expiryDate.toISOString().slice(0, 10)})`}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-5">
                    <label className="text-[13px]">Lot<input name="lotNumber" required defaultValue={lots[0]?.lotNumber} className={inputCls} /></label>
                    <label className="text-[13px]">Bin<input name="locationCode" required defaultValue={lots[0]?.locations[0]?.code} className={inputCls} /></label>
                    <label className="text-[13px]">Qty<input name="qty" type="number" step="any" min="0" required defaultValue={lots[0] ? Math.min(remaining, lots[0].available) : ""} className={inputCls} /></label>
                    <label className="text-[13px] md:col-span-2">FIFO override reason (only if skipping)<input name="override" className={inputCls} /></label>
                  </div>
                  <button className={`${btnCls} w-full md:w-auto`}>Issue</button>
                </Card>
              </Form>
            ))}
          </section>
        )}

        {returner && (
          <section className="space-y-3">
            <div>
              <Eyebrow>OUT AT THE MACHINES · {outAtMachines.length}</Eyebrow>
              <p className="mt-1 text-sm text-ink-2">Put leftover material back at the end of a shift. It returns to the same lot, so FIFO and traceability stay right, and the BOM variance stops counting it as used.</p>
            </div>
            <CreatePanel id="return">
              <Card className="space-y-3">
                <Eyebrow>RETURN ANOTHER LOT</Eyebrow>
                <Form action={giveBack} className="grid gap-3 md:grid-cols-5">
                  <label className="text-[13px]">Lot number<input name="lot" required className={inputCls} /></label>
                  <label className="text-[13px]">Quantity<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
                  <label className="text-[13px]">Bin<select name="bin" required className={inputCls}>{binOptions}</select></label>
                  <label className="text-[13px]">Note<input name="note" className={inputCls} /></label>
                  <div className="flex items-end"><button className={`${btnCls} w-full`}>Return</button></div>
                </Form>
              </Card>
            </CreatePanel>
            {outAtMachines.length === 0 && <Card><p className="text-sm text-ink-3">Nothing issued in the last 14 days is still out at a machine.</p></Card>}
            <div className="grid gap-2.5 md:grid-cols-2">
              {outAtMachines.map((l) => (
                <article key={l.lotNumber} className="space-y-2 rounded-[14px] bg-white p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span><Mono className="font-semibold">{l.lotNumber}</Mono> <span className="text-sm text-ink-2">{l.itemCode} · {l.itemName}</span></span>
                    <Mono className="text-xs">{l.atMachine.toLocaleString()} {l.uom} out</Mono>
                  </div>
                  <Form action={giveBack} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="lot" value={l.lotNumber} />
                    <label className="w-28 text-[13px]">Qty<input name="qty" type="number" step="any" min="0" max={l.atMachine} defaultValue={l.atMachine} required className={inputCls} /></label>
                    <label className="min-w-28 flex-1 text-[13px]">Bin<select name="bin" required className={inputCls}>{binOptions}</select></label>
                    <button className={btnCls}>Return</button>
                  </Form>
                </article>
              ))}
            </div>
            {recentReturns.length > 0 && (
              <div className="overflow-hidden rounded-[14px] bg-white">
                {recentReturns.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                    <span><Mono className="font-semibold">{t.lot.lotNumber}</Mono> <span className="text-ink-3">returned · {t.lot.item.code} → {t.location?.code}</span></span>
                    <Mono>{Number(t.qty).toLocaleString()} {t.lot.item.uom}</Mono>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="space-y-2">
          <Eyebrow>REQUISITIONS</Eyebrow>
          <SearchBar q={q} placeholder="Search request no., item or status" clearHref="/requests" />
          <DataTable>
            <thead><tr><th>Request</th><th>Lines (issued / requested)</th><th>Status</th></tr></thead>
            <tbody>
              {requests.filter((r) => matches(q, r.requestNumber, r.status, ...r.lines.flatMap((l) => [l.item.code, l.item.name]))).map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold"><Mono>{r.requestNumber}</Mono></td>
                  <td><Mono className="text-xs">{r.lines.map((l) => `${l.item.code}: ${Number(l.issuedQty)}/${Number(l.qty)} ${l.item.uom}`).join(", ")}</Mono></td>
                  <td><Badge tone={r.status === "OPEN" ? "warn" : r.status === "PARTIAL" ? "info" : "ok"}>{r.status}</Badge></td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td className="text-ink-3" colSpan={3}>No requests yet.</td></tr>}
            </tbody>
          </DataTable>
        </section>
      </div>
    </CreateProvider>
  );
}
