import { requirePermission, runAction } from "@/server/auth/guard";
import { DownloadLink } from "@/components/download-link";
import { DomainError } from "@/server/services/inventory";
import { createPosFromPlan, planMrp } from "@/server/services/mrp";
import { btnCls, Flash, inputCls } from "@/components/flash";

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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">MRP Plan</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Demand in the horizon is netted against stock and open purchase orders, then exploded through each part&apos;s BOM.
        Parts wanted by an automotive customer follow the strict Kanban minimum; everything else follows its reorder point.
        Quantities and prices are recalculated when you create orders.
      </p>
      <Flash error={sp.error} ok={sp.ok} />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Horizon (days)<input name="horizon" type="number" min="7" max="365" defaultValue={horizonDays} className={`${inputCls} w-28`} /></label>
        <label className="text-sm">Reject allowance %<input name="scrap" type="number" min="0" max="50" step="any" defaultValue={scrapPct} className={`${inputCls} w-28`} /></label>
        <button className={btnCls}>Recalculate</button>
        <span className="pb-2 text-xs text-slate-500">Planning to {date(horizonEnd)} · {demandLines} demand line{demandLines === 1 ? "" : "s"} in range</span>
      </form>

      <p className="flex gap-4 text-sm print:hidden">
        <DownloadLink href={`/api/v1/export/mrp?format=xlsx&horizon=${horizonDays}&scrap=${scrapPct}`}>Download Excel</DownloadLink>
        <DownloadLink href={`/api/v1/export/mrp?format=csv&horizon=${horizonDays}&scrap=${scrapPct}`}>Download CSV</DownloadLink>
      </p>

      <form action={order} className="space-y-3">
        <input type="hidden" name="horizon" value={horizonDays} />
        <input type="hidden" name="scrap" value={scrapPct} />
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr>
              <th className="p-2"></th><th className="p-2">Item</th><th className="p-2">Policy</th>
              <th className="p-2 text-right">Needed</th><th className="p-2 text-right">On hand</th><th className="p-2 text-right">On order</th>
              <th className="p-2 text-right">Projected</th><th className="p-2 text-right">Suggested</th><th className="p-2">Supplier</th><th className="p-2">Order by</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId} className={`border-t align-top ${r.suggested > 0 ? "" : "text-slate-400"}`}>
                  <td className="p-2">{r.buyable && r.supplier && <input type="checkbox" name="item" value={r.itemId} defaultChecked aria-label={`Order ${r.code}`} className="h-4 w-4" />}</td>
                  <td className="p-2"><div className="font-medium">{r.code}</div><div className="text-xs text-slate-500">{r.name}</div><div className="text-xs text-slate-500">{r.reason}</div></td>
                  <td className="p-2 text-xs">{r.role === "FG" ? "Make · " : ""}{POLICY[r.policy]}</td>
                  <td className="p-2 text-right">{Math.round(r.gross * 10) / 10}</td><td className="p-2 text-right">{r.onHand.toLocaleString()}</td>
                  <td className="p-2 text-right">{r.incoming.toLocaleString()}</td>
                  <td className={`p-2 text-right ${r.projected < 0 ? "font-medium text-red-700" : ""}`}>{Math.round(r.projected * 10) / 10}</td>
                  <td className="p-2 text-right font-semibold">
                    {r.suggested > 0 && r.buyable && r.supplier ? (
                      <input name={`qty_${r.itemId}`} type="number" step="any" min="0" defaultValue={r.suggested} className="w-24 rounded border px-2 py-1 text-right" aria-label={`Quantity for ${r.code}`} />
                    ) : r.suggested > 0 ? `${r.suggested.toLocaleString()} ${r.uom}` : "—"}
                    {r.suggested > 0 && <div className="text-xs font-normal text-slate-500">{r.uom}{r.role === "FG" ? " to produce" : ""}</div>}
                  </td>
                  <td className="p-2 text-xs">{r.inHouse && r.suggested > 0 ? "In-house regrind" : r.role === "FG" ? "—" : r.supplier ? <>{r.supplier.name}<div className="text-slate-500">₹{r.supplier.price} · {r.supplier.leadTimeDays}d lead</div></> : r.buyable ? <span className="text-red-700">No supplier price</span> : "—"}</td>
                  <td className={`p-2 text-xs ${r.late ? "font-semibold text-red-700" : ""}`}>{r.orderBy ? `${date(r.orderBy)}${r.late ? " — late" : ""}` : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={10}>Nothing to plan. Load demand, or all stock is above its reorder levels.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-4">
          <button className={btnCls} disabled={buyable.length === 0}>Create purchase orders for ticked items</button>
          <span className="text-xs text-slate-500">{actionable.length} item{actionable.length === 1 ? "" : "s"} need action, {buyable.length} can be ordered now</span>
        </div>
      </form>
    </div>
  );
}
