import { requireView, requirePermission, runAction } from "@/server/auth/guard";
import { DownloadLink } from "@/components/download-link";
import { DomainError } from "@/server/services/inventory";
import { createPosFromPlan, HORIZON_PRESETS, planMrp } from "@/server/services/mrp";
import { canView } from "@/server/auth/permissions";
import { dateField } from "@/server/line-form";
import { MrpWorkspace, type MrpRowView } from "@/components/mrp-table";
import { TYPE_GROUPS } from "@/lib/item-types";
import { Flash } from "@/components/flash";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";

export const instant = false;

const clamp = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

async function order(formData: FormData) {
  "use server";
  const user = await requirePermission("mrp.plan");
  const horizonDays = clamp(String(formData.get("horizon")), 30, 7, 365);
  const scrapPct = clamp(String(formData.get("scrap")), 2, 0, 50);
  // Come back to the same horizon and the same filters, with only the numbers changed.
  const type = String(formData.get("type") || ""), onlyAction = formData.get("action") === "1";
  const back = `/mrp?horizon=${horizonDays}&scrap=${scrapPct}${TYPE_GROUPS.some((g) => g.key === type) ? `&type=${type}` : ""}${onlyAction ? "&action=1" : ""}`;
  let made: { poNumber: string }[] = [];
  return runAction(back, () => `Created ${made.map((p) => p.poNumber).join(", ")}. Find ${made.length === 1 ? "it" : "them"} under Orders.`, async () => {
    const expectedDate = dateField(formData.get("expected"));
    const selections = formData.getAll("item").map(String).map((itemId) => {
      const q = String(formData.get(`qty_${itemId}`) || "");
      return { itemId, qty: q === "" ? undefined : Number(q), supplierId: String(formData.get(`supplier_${itemId}`) || "") || undefined, expectedDate };
    });
    if (selections.some((s) => s.qty !== undefined && !Number.isFinite(s.qty))) throw new DomainError("A quantity isn't a number.");
    made = await createPosFromPlan({
      selections, opts: { horizonDays, scrapPct }, userId: user.id,
      club: formData.get("club") === "1", expedite: formData.get("expedite") === "1", expediteNote: String(formData.get("expediteNote") || ""),
    });
  });
}

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function MrpPage({
  searchParams,
}: { searchParams: Promise<{ horizon?: string; scrap?: string; type?: string; action?: string; error?: string; ok?: string }> }) {
  const user = await requireView("mrp");
  const sp = await searchParams;
  const horizonDays = clamp(sp.horizon, 30, 7, 365);
  const scrapPct = clamp(sp.scrap, 2, 0, 50);
  const { rows, horizonEnd, demandLines, demandSpread } = await planMrp({ horizonDays, scrapPct });
  const spreadAfterWeek = demandSpread.filter((b) => b.key !== "overdue" && b.key !== "week").reduce((a, b) => a + b.lines, 0);
  const loaded = demandSpread.reduce((a, b) => a + b.lines, 0);
  const initialGroup = TYPE_GROUPS.some((g) => g.key === sp.type) ? String(sp.type) : "all";

  const views: MrpRowView[] = rows.map((r) => ({
    itemId: r.itemId, code: r.code, name: r.name, uom: r.uom, category: r.category, role: r.role, policy: r.policy,
    gross: r.gross, onHand: r.onHand, onOrder: r.onOrder, inProduction: r.inProduction, plannedDays: r.plannedDays, pendingQc: r.pendingQc,
    projected: r.projected, suggested: r.suggested, reason: r.reason, inHouse: r.inHouse, buyable: r.buyable,
    supplier: r.supplier ? { name: r.supplier.name, price: r.supplier.price, leadTimeDays: r.supplier.leadTimeDays } : null,
    orderBy: r.orderBy ? r.orderBy.toISOString() : null, late: r.late, options: r.options, earliestDue: r.earliestDue ? r.earliestDue.toISOString() : null,
    minStock: r.minStock, reorderPointLevel: r.reorderPointLevel, maxStock: r.maxStock, safetyStock: r.safetyStock,
    needBy: r.needBy,
    demandLines: r.demandLines.map((d) => ({ ...d, dueDate: d.dueDate.toISOString() })),
    partDrivers: r.partDrivers,
    openPos: r.openPos.map((p) => ({ ...p, expected: p.expected ? p.expected.toISOString() : null })),
  }));
  const can = {
    demand: canView(user, "demand"), orders: canView(user, "orders"), planning: canView(user, "planning"),
    quality: canView(user, "quality"), bom: canView(user, "bom"), stock: canView(user, "stock"),
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="BUY & RECEIVE" title="MRP plan" subtitle={`Planning to ${date(horizonEnd)} · ${demandLines} demand line${demandLines === 1 ? "" : "s"} in range`} />
      <p className="max-w-3xl text-sm text-ink-2">
        What the plan needs in the window, less stock, open POs and the machine plan, worked back through each BOM. Automotive parts hold a strict Kanban minimum; the rest reorder at their reorder point. Open a row to see why.
      </p>
      <Flash error={sp.error} ok={sp.ok} />

      <MrpWorkspace
        rows={views} horizonDays={horizonDays} scrapPct={scrapPct} presets={HORIZON_PRESETS} can={can} today={new Date().toISOString().slice(0, 10)}
        initialGroup={initialGroup} initialOnlyAction={sp.action === "1"} action={order}
      >
      <Card className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-bold">When customers need it</h2>
          {can.demand && <Link href="/demand" className="text-[13px] font-semibold text-accent">Customer demand →</Link>}
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {demandSpread.map((b) => (
            <li key={b.key} className={`rounded-xl px-3 py-2 ${b.key === "overdue" && b.lines > 0 ? "bg-danger-bg" : "bg-canvas"}`}>
              <div className={`font-display text-lg font-extrabold ${b.key === "overdue" && b.lines > 0 ? "text-danger" : ""}`}>{b.parts.toLocaleString()}</div>
              <div className="text-xs text-ink-2">{b.label}</div>
              <div className="text-[11px] text-ink-3">{b.lines} line{b.lines === 1 ? "" : "s"}</div>
            </li>
          ))}
        </ul>
        {loaded === 0 && <p className="text-xs text-ink-3">No customer demand is loaded. Rows below come from stock policy alone.</p>}
        {loaded > 0 && spreadAfterWeek === 0 && (
          <p className="rounded-lg bg-info-bg px-3 py-2 text-xs text-info-ink">
            All the demand loaded is already overdue or due within a week, so the week, month and quarter figures match: a wider horizon adds nothing until later call-offs are loaded.
          </p>
        )}
        {loaded > 0 && demandSpread[0].lines > 0 && (
          <p className="text-xs text-ink-3">Overdue lines still count in every horizon: they have to be made, whatever the window.</p>
        )}
      </Card>

      <p className="flex gap-4 text-sm font-semibold text-accent print:hidden">
        <DownloadLink href={`/api/v1/export/mrp?format=xlsx&horizon=${horizonDays}&scrap=${scrapPct}`}>Download Excel</DownloadLink>
        <DownloadLink href={`/api/v1/export/mrp?format=csv&horizon=${horizonDays}&scrap=${scrapPct}`}>Download CSV</DownloadLink>
      </p>

      </MrpWorkspace>
    </div>
  );
}
