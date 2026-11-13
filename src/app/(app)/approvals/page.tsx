import { db } from "@/server/db";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { decideCount } from "@/server/services/stockcount";
import { btnCls, btnDangerCls, Flash } from "@/components/flash";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

export const instant = false;

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.adjust");
  const approve = formData.get("decision") === "approve";
  await runAction("/approvals", approve ? "Count approved and stock adjusted." : "Count rejected. Stock is unchanged.", async () => {
    await decideCount({ id: String(formData.get("id")), approve, note: String(formData.get("note") || ""), userId: user.id });
  });
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireView("approvals");
  const { error, ok } = await searchParams;
  const [waiting, decided] = await Promise.all([
    db.stockCount.findMany({
      where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" },
      include: { location: true, lines: { include: { lot: { include: { item: true } } } } },
    }),
    db.stockCount.findMany({ where: { status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 10, include: { location: true } }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="OVERVIEW" title="Approvals" subtitle={`${waiting.length} stock count${waiting.length === 1 ? "" : "s"} waiting`} />
      <Flash error={error} ok={ok} />
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
            <form action={decide} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={c.id} />
              <label className="min-w-48 flex-1 text-[13px]">Remark <span className="text-ink-3">(needed to reject)</span>
                <input name="note" className="mt-1 w-full min-h-12 rounded-xl border border-border bg-white px-3.5 text-base" />
              </label>
              <button name="decision" value="approve" className={btnCls}>Approve &amp; adjust stock</button>
              <button name="decision" value="reject" className={btnDangerCls}>Reject</button>
            </form>
          </Card>
        );
      })}
      {decided.length > 0 && (
        <section className="space-y-1.5">
          <Eyebrow>RECENTLY DECIDED</Eyebrow>
          <div className="overflow-hidden rounded-[14px] bg-white">
            {decided.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-ink-3">· {c.location.code}</span>{c.note && <span className="block text-xs text-ink-3">{c.note}</span>}</span>
                <Badge tone={c.status === "APPROVED" ? "ok" : "danger"}>{c.status}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
