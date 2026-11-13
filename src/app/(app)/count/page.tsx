import { db } from "@/server/db";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { saveCount, startCount, submitCount } from "@/server/services/stockcount";
import { pushAfter } from "@/server/push";
import { btnCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

export const instant = false;

function entries(formData: FormData) {
  const out = [...formData.entries()]
    .filter(([k]) => k.startsWith("qty_"))
    .map(([k, v]) => ({ lotNumber: k.slice(4), countedQty: String(v).trim() === "" ? null : Number(v) }));
  const extra = String(formData.get("extraLot") || "").trim();
  if (extra && String(formData.get("extraQty") || "").trim() !== "") out.push({ lotNumber: extra, countedQty: Number(formData.get("extraQty")) });
  return out;
}

async function start(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.count");
  await runAction("/count", "Count sheet opened. Enter what is really in the bin.", async () => {
    await startCount({ locationCode: String(formData.get("bin") || ""), userId: user.id });
  });
}

async function save(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.count");
  await runAction("/count", "Counts saved.", async () => {
    await saveCount(String(formData.get("id")), entries(formData), user.id);
  });
}

async function submit(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.count");
  await runAction("/count", "Sent for approval.", async () => {
    const id = String(formData.get("id"));
    await saveCount(id, entries(formData), user.id);
    await submitCount(id, user.id);
    const c = await db.stockCount.findUniqueOrThrow({ where: { id }, include: { location: true } });
    pushAfter({ view: "approvals", exceptUserId: user.id }, { title: "Stock count to approve", body: `${c.countNumber} for bin ${c.location.code} is waiting for a decision.`, url: "/approvals", tag: "approvals" });
  });
}

const tone = (s: string) => (s === "APPROVED" ? "ok" : s === "REJECTED" ? "danger" : s === "SUBMITTED" ? "info" : "warn") as "ok" | "danger" | "info" | "warn";

export default async function CountPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireView("count");
  const { error, ok } = await searchParams;
  const [bins, open, recent] = await Promise.all([
    db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.stockCount.findMany({
      where: { status: "OPEN" }, orderBy: { createdAt: "asc" },
      include: { location: true, lines: { include: { lot: { include: { item: true } } }, orderBy: { lot: { lotNumber: "asc" } } } },
    }),
    db.stockCount.findMany({
      where: { status: { not: "OPEN" } }, orderBy: { createdAt: "desc" }, take: 15,
      include: { location: true, lines: true },
    }),
  ]);

  return (
    <CreateProvider defaultOpen={open.length === 0}>
      <div className="space-y-4">
        <PageHeader right={<CreateButton label="Count a bin" />} eyebrow="STORE & SHOP FLOOR" title="Stock count" subtitle={`${open.length} in progress`} />
        <p className="max-w-3xl text-sm text-ink-2">
          Pick a bin, count what is really there, and send the differences for approval. Nothing changes in stock until an approver accepts the count.
        </p>
        <Flash error={error} ok={ok} />
        <CreatePanel>
          <Card className="space-y-3">
            <Eyebrow>OPEN A COUNT SHEET</Eyebrow>
            <form action={start} className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-[13px]">Bin
                <select name="bin" required className={inputCls}>
                  <option value="">— choose a bin —</option>
                  {bins.map((b) => <option key={b.id} value={b.code}>{b.code}{b.type === "STAGING" ? " (staging)" : ""}</option>)}
                </select>
              </label>
              <button className={btnCls}>Open sheet</button>
            </form>
          </Card>
        </CreatePanel>

        {open.map((c) => (
          <Card key={c.id} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-sm text-ink-2">· bin {c.location.code}</span></span>
              <Badge tone="warn">Counting</Badge>
            </div>
            <form className="space-y-3">
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
                <button formAction={save} className={btnSecondaryCls}>Save</button>
                <button formAction={submit} className={btnCls}>Submit for approval</button>
              </div>
            </form>
          </Card>
        ))}

        {recent.length > 0 && (
          <section className="space-y-1.5">
            <Eyebrow>RECENT COUNTS</Eyebrow>
            <div className="overflow-hidden rounded-[14px] bg-white">
              {recent.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 first:border-t-0 text-sm">
                  <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-ink-3">· {c.location.code} · {c.lines.length} lots</span>{c.note && <span className="block text-xs text-ink-3">{c.note}</span>}</span>
                  <Badge tone={tone(c.status)}>{c.status}</Badge>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </CreateProvider>
  );
}
