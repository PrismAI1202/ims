import { requirePermission, runAction } from "@/server/auth/guard";
import { DownloadLink } from "@/components/download-link";
import { DomainError } from "@/server/services/inventory";
import { createPosFromPlan, planMrp } from "@/server/services/mrp";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Badge, Card, DataTable, Mono, PageHeader } from "@/components/ui";

export const instant = false;

const clamp = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

async function order(formData: FormData) {
  "use server";
  const user = await requirePermission("mrp.plan");
  const horizonDays = clamp(String(formData.get("horizon")), 60, 7, 365);
  const scrapPct = clamp(String(formData.get("scrap")), 2, 0, 50);
  let count = 0;
  await runAction("/mrp", () => `Created ${count} purchase order${count === 1 ? "" : "s"}. Find them under Purchase Orders.`, async () => {
    const selections = formData.getAll("item").map(String).map((itemId) => {
      const q = String(formData.get(`qty_${itemId}`) || "");
      return { itemId, qty: q === "" ? undefined : Number(q) };
    });
    if (selections.some((s) => s.qty !== undefined && !Number.isFinite(s.qty))) throw new DomainError("A quantity isn't a number.");
    count = (await createPosFromPlan({ selections, opts: { horizonDays, scrapPct }, userId: user.id })).length;
  }, `/mrp?horizon=${horizonDays}&scrap=${scrapPct}`);
}

const POLICY = { KANBAN: "Kanban (strict min)", ROP: "Reorder point" } as const;
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function MrpPage({
  searchParams,
}: { searchParams: Promise<{ horizon?: string; scrap?: string; error?: string; ok?: string }> }) {
  await requirePermission("mrp.plan");
  const sp = await searchParams;
  const horizonDays = clamp(sp.horizon, 60, 7, 365);
  const scrapPct = clamp(sp.scrap, 2, 0, 50);
  const { rows, horizonEnd, demandLines } = await planMrp({ horizonDays, scrapPct });
  const actionable = rows.filter((r) => r.suggested > 0);
  const buyable = actionable.filter((r) => r.buyable);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="BUY & RECEIVE" title="MRP plan" subtitle={`Planning to ${date(horizonEnd)} · ${demandLines} demand line${demandLines === 1 ? "" : "s"} in range`} />
      <p className="max-w-3xl text-sm text-ink-2">
        Demand in the horizon is netted against stock and open purchase orders, then exploded through each part&apos;s BOM.
        Parts wanted by an automotive customer follow the strict Kanban minimum; everything else follows its reorder point.
        Quantities and prices are recalculated when you create orders.
      </p>
      <Flash error={sp.error} ok={sp.ok} />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-[13px]">Horizon (days)<input name="horizon" type="number" min="7" max="365" defaultValue={horizonDays} className={`${inputCls} w-28`} /></label>
          <label className="text-[13px]">Reject allowance %<input name="scrap" type="number" min="0" max="50" step="any" defaultValue={scrapPct} className={`${inputCls} w-28`} /></label>
          <button className={btnCls}>Recalculate</button>
        </form>
      </Card>

      <p className="flex gap-4 text-sm font-semibold text-accent print:hidden">
        <DownloadLink href={`/api/v1/export/mrp?format=xlsx&horizon=${horizonDays}&scrap=${scrapPct}`}>Download Excel</DownloadLink>
        <DownloadLink href={`/api/v1/export/mrp?format=csv&horizon=${horizonDays}&scrap=${scrapPct}`}>Download CSV</DownloadLink>
      </p>

      <form action={order} className="space-y-3">
        <input type="hidden" name="horizon" value={horizonDays} />
        <input type="hidden" name="scrap" value={scrapPct} />
        <DataTable>
          <thead><tr>
            <th></th><th>Item</th><th>Policy</th>
            <th className="text-right!">Needed</th><th className="text-right!">On hand</th><th className="text-right!">On order</th>
            <th className="text-right!">Projected</th><th className="text-right!">Suggested</th><th>Supplier</th><th>Order by</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.itemId} className={`align-top ${r.suggested > 0 ? "" : "text-ink-3"}`}>
                <td>{r.buyable && r.supplier && <input type="checkbox" name="item" value={r.itemId} defaultChecked aria-label={`Order ${r.code}`} className="size-5 accent-[#c2410c]" />}</td>
                <td><div className="font-semibold">{r.code}</div><div className="text-xs text-ink-3">{r.name}</div><div className="text-xs text-ink-3">{r.reason}</div></td>
                <td className="text-xs">{r.role === "FG" ? "Make · " : ""}{POLICY[r.policy]}</td>
                <td className="text-right"><Mono>{Math.round(r.gross * 10) / 10}</Mono></td><td className="text-right"><Mono>{r.onHand.toLocaleString()}</Mono></td>
                <td className="text-right"><Mono>{r.incoming.toLocaleString()}</Mono></td>
                <td className={`text-right ${r.projected < 0 ? "font-semibold text-danger" : ""}`}><Mono>{Math.round(r.projected * 10) / 10}</Mono></td>
                <td className="text-right font-semibold">
                  {r.suggested > 0 && r.buyable && r.supplier ? (
                    <input name={`qty_${r.itemId}`} type="number" step="any" min="0" defaultValue={r.suggested} className="min-h-10 w-24 rounded-lg border border-border px-2 text-right font-mono" aria-label={`Quantity for ${r.code}`} />
                  ) : r.suggested > 0 ? `${r.suggested.toLocaleString()} ${r.uom}` : "—"}
                  {r.suggested > 0 && <div className="text-xs font-normal text-ink-3">{r.uom}{r.role === "FG" ? " to produce" : ""}</div>}
                </td>
                <td className="text-xs">{r.inHouse && r.suggested > 0 ? "In-house regrind" : r.role === "FG" ? "—" : r.supplier ? <>{r.supplier.name}<div className="text-ink-3">₹{r.supplier.price} · {r.supplier.leadTimeDays}d lead</div></> : r.buyable ? <Badge tone="danger">No supplier price</Badge> : "—"}</td>
                <td className={`text-xs ${r.late ? "font-semibold text-danger" : ""}`}>{r.orderBy ? `${date(r.orderBy)}${r.late ? " — late" : ""}` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="text-ink-3" colSpan={10}>Nothing to plan. Load demand, or all stock is above its reorder levels.</td></tr>}
          </tbody>
        </DataTable>
        <div className="flex flex-wrap items-center gap-4">
          <button className={`${btnCls} disabled:opacity-50`} disabled={buyable.length === 0}>Create purchase orders for ticked items</button>
          <span className="text-xs text-ink-3">{actionable.length} item{actionable.length === 1 ? "" : "s"} need action, {buyable.length} can be ordered now</span>
        </div>
      </form>
    </div>
  );
}
