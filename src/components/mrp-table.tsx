"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { itemType, TYPE_GROUPS } from "@/lib/item-types";
import { btnCls, inputCls } from "@/components/flash";
import { groupForPos } from "@/lib/po-groups";
import { addDays, daysBetween } from "@/lib/lead-time";
import { ExpediteBox } from "@/components/expedite-box";
import { Form } from "@/components/form";
import type { FormAction } from "@/lib/action-result";

// The MRP plan as a table you can read at a glance and open: each row has a type tag, a bar of what is on hand, coming and short
// against what the horizon needs, and expands to show what is behind the requirement (customer demand, the parts that need the
// material, the POs and machine plan already on the way).

export interface MrpRowView {
  itemId: string; code: string; name: string; uom: string; category: string;
  role: "FG" | "COMPONENT" | "STOCK"; policy: "KANBAN" | "ROP";
  gross: number; onHand: number; onOrder: number; inProduction: number; plannedDays: number; pendingQc: number;
  projected: number; suggested: number; reason: string; inHouse: boolean; buyable: boolean;
  supplier: { name: string; price: number; leadTimeDays: number } | null; orderBy: string | null; late: boolean;
  options: { id: string; name: string; price: number; leadTimeDays: number }[]; earliestDue: string | null;
  minStock: number; reorderPointLevel: number; maxStock: number; safetyStock: number;
  needBy: Record<number, number>;
  demandLines: { customer: string; segment: string; type: string; dueDate: string; qty: number }[];
  partDrivers: { fgItemId: string; code: string; name: string; parts: number; qty: number; bomId: string | null; customers: string[] }[];
  openPos: { poId: string; poNumber: string; supplier: string; qty: number; expected: string | null; status: string }[];
}
export interface MrpCan { demand: boolean; orders: boolean; planning: boolean; quality: boolean; bom: boolean; stock: boolean }

const GREEN = "#1E7A46", BLUE = "#5B8DEF", RED = "#B42318";
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString();
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const money = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
type SupplierOption = MrpRowView["options"][number];
const POLICY = { KANBAN: "Kanban: strict minimum (automotive)", ROP: "Reorder point" } as const;
const DEMAND_TYPE: Record<string, string> = { FIRM: "Firm", SPOT: "Spot", FORECAST: "Forecast" };

/** On hand, coming (open POs, or machine-plan output for a part) and the shortfall, against what the horizon needs. */
function SupplyBar({ onHand, coming, needed, marker }: { onHand: number; coming: number; needed: number; marker: number }) {
  const have = onHand + coming;
  const short = Math.max(needed - have, 0);
  const scale = Math.max(needed, have, marker, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div className="relative h-3 rounded-md bg-canvas" role="img" aria-label={`On hand ${n1(onHand)}, coming ${n1(coming)}, needed ${n1(needed)}`}>
      <div className="flex h-full overflow-hidden rounded-md">
        <span style={{ width: pct(onHand), background: GREEN }} />
        <span style={{ width: pct(coming), background: BLUE }} />
        <span style={{ width: pct(short), background: `repeating-linear-gradient(45deg, ${RED}, ${RED} 4px, #E88A82 4px, #E88A82 8px)` }} />
      </div>
      {marker > 0 && <span className="absolute -inset-y-[3px] w-0.5 bg-ink" style={{ left: `min(calc(100% - 2px), ${(marker / scale) * 100}%)` }} />}
    </div>
  );
}

export function TypeTag({ category }: { category: string }) {
  const t = itemType(category);
  return <span title={t.name} className="inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold text-white" style={{ background: t.color }}>{t.tag}</span>;
}

function Detail({ r, horizonDays, presets, can, today }: { r: MrpRowView; horizonDays: number; presets: readonly { days: number; label: string }[]; can: MrpCan; today: string }) {
  const coming = r.onOrder + r.inProduction;
  const demandTotal = r.demandLines.reduce((a, d) => a + d.qty, 0);
  const comingLabel = r.role === "FG" ? "In production (machine plan)" : "On order (open POs)";
  const horizons = [...new Set([...presets.map((p) => p.days), horizonDays])].sort((a, b) => a - b);
  const label = (d: number) => presets.find((p) => p.days === d)?.label ?? `${d} days`;
  const box = "space-y-2 rounded-xl bg-white p-3.5";
  const h = "font-mono text-[11px] font-bold uppercase tracking-wide text-ink-3";
  const link = "text-[13px] font-semibold text-accent";
  return (
    <div className="grid gap-3 bg-canvas p-3.5 md:grid-cols-3">
      <section className={box}>
        <h3 className={h}>The numbers · next {horizonDays} days</h3>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
          <dt>Needed</dt><dd className="text-right font-mono">{n1(r.gross)} {r.uom}</dd>
          <dt>On hand (approved)</dt><dd className="text-right font-mono">{n1(r.onHand)}</dd>
          <dt>{comingLabel}</dt><dd className="text-right font-mono">{n1(coming)}</dd>
          {r.pendingQc > 0 && <><dt>Waiting for QC (not counted)</dt><dd className="text-right font-mono">{n1(r.pendingQc)}</dd></>}
          <dt className="font-semibold">Projected</dt><dd className={`text-right font-mono font-semibold ${r.projected < 0 ? "text-danger" : ""}`}>{n1(r.projected)}</dd>
        </dl>
        <p className="border-t border-line pt-2 text-xs text-ink-2">
          {POLICY[r.policy]}. Min <b>{n1(r.minStock)}</b> · reorder point <b>{n1(r.reorderPointLevel)}</b> · max <b>{n1(r.maxStock)}</b>{r.safetyStock > 0 && <> · safety <b>{n1(r.safetyStock)}</b></>} {r.uom}
        </p>
        <div className="border-t border-line pt-2">
          <div className="mb-1 text-xs font-semibold text-ink-2">Needed by horizon</div>
          <ul className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
            {horizons.map((d) => (
              <li key={d} className={`rounded-md px-1 py-1.5 ${d === horizonDays ? "bg-ink text-white" : "bg-canvas"}`}>
                <div className="font-mono text-[13px] font-semibold">{n1(r.needBy[d] ?? 0)}</div><div className="opacity-80">{label(d)}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={box}>
        <h3 className={h}>What is driving it</h3>
        <p className="text-[13px] text-ink-2">{r.reason || "Covered by stock."}</p>
        {r.role === "FG" && (
          r.demandLines.length === 0 ? <p className="text-[13px] text-ink-3">No customer demand for this part in the horizon.</p> : (
            <>
              <ul className="divide-y divide-line text-[13px]">
                {r.demandLines.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-x-2 py-1.5">
                    <span><b>{d.customer}</b> <span className="rounded bg-canvas px-1 text-[10px] font-bold uppercase text-ink-2">{DEMAND_TYPE[d.type] ?? d.type}</span>{d.segment === "AUTOMOTIVE" && <span className="ml-1 rounded bg-info-bg px-1 text-[10px] font-bold uppercase text-info-ink">Auto</span>}</span>
                    <span className="font-mono text-xs">{day(d.dueDate) < today && <span className="mr-1.5 rounded bg-danger-bg px-1 font-sans text-[10px] font-bold uppercase text-danger">Overdue</span>}{day(d.dueDate)} · {d.qty.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-3">{r.demandLines.length} line{r.demandLines.length === 1 ? "" : "s"}, {demandTotal.toLocaleString()} parts in total. Netted against the finished-goods stock and not tied to one customer&apos;s boxes.</p>
            </>
          )
        )}
        {r.role === "COMPONENT" && (
          r.partDrivers.length === 0 ? <p className="text-[13px] text-ink-3">No part in the plan uses this material.</p> : (
            <ul className="divide-y divide-line text-[13px]">
              {r.partDrivers.map((d) => (
                <li key={d.fgItemId} className="space-y-0.5 py-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span>{can.bom && d.bomId ? <Link href={`/bom/${d.bomId}`} className="font-semibold text-accent">{d.code}</Link> : <b>{d.code}</b>} <span className="text-ink-3">{d.name}</span></span>
                    <span className="font-mono text-xs">{n1(d.qty)} {r.uom}</span>
                  </div>
                  <div className="text-xs text-ink-3">To make {d.parts.toLocaleString()} parts{d.customers.length > 0 && <> for {d.customers.join(", ")}</>}</div>
                </li>
              ))}
            </ul>
          )
        )}
        {r.role === "STOCK" && <p className="text-[13px] text-ink-3">No customer demand in this horizon. This is a plain top-up to the stock policy, not tied to an order.</p>}
        {can.demand && r.role !== "STOCK" && <Link href="/demand" className={link}>Customer demand →</Link>}
      </section>

      <section className={box}>
        <h3 className={h}>Already on the way</h3>
        {r.role === "FG" ? (
          <p className="text-[13px] text-ink-2">
            {r.plannedDays > 0
              ? <>{r.plannedDays} machine-day{r.plannedDays === 1 ? "" : "s"} planned for this part{r.inProduction > 0 ? <>, about <b className="font-mono">{r.inProduction.toLocaleString()}</b> parts.</> : <>, but the mould has no cycle time, so the output can&apos;t be estimated.</>}</>
              : "Nothing planned on a machine in this horizon."}
          </p>
        ) : r.openPos.length === 0 ? <p className="text-[13px] text-ink-3">No open purchase orders for this item.</p> : (
          <ul className="divide-y divide-line text-[13px]">
            {r.openPos.map((p) => (
              <li key={p.poId} className="flex flex-wrap items-baseline justify-between gap-x-2 py-1.5">
                <span>{can.orders ? <Link href={`/purchase/${p.poId}`} className="font-mono font-semibold text-accent">{p.poNumber}</Link> : <b className="font-mono">{p.poNumber}</b>} <span className="text-ink-3">{p.supplier}</span></span>
                <span className="font-mono text-xs">{n1(p.qty)} {r.uom}{p.expected ? ` · ${day(p.expected)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {r.pendingQc > 0 && <p className="text-[13px] text-ink-2">{n1(r.pendingQc)} {r.uom} received and waiting for QC. {can.quality && <Link href="/quality?tab=inward" className={link}>Go to QC →</Link>}</p>}
        {r.supplier && <p className="border-t border-line pt-2 text-xs text-ink-2">Cheapest supplier: <b>{r.supplier.name}</b>, ₹{r.supplier.price} · {r.supplier.leadTimeDays} days lead time.</p>}
        <div className="flex flex-wrap gap-3 pt-1">
          {can.stock && <Link href={`/stock?q=${encodeURIComponent(r.code)}`} className={link}>In Stores →</Link>}
          {can.planning && r.role === "FG" && <Link href="/planning" className={link}>Machine plan →</Link>}
          {can.orders && r.role !== "FG" && <Link href={`/orders?kind=po&q=${encodeURIComponent(r.code)}`} className={link}>POs for this item →</Link>}
        </div>
      </section>
    </div>
  );
}

export function MrpTable({
  rows, horizonDays, presets, can, today, group, onlyAction, onRaise,
}: {
  rows: MrpRowView[]; horizonDays: number; presets: readonly { days: number; label: string }[]; can: MrpCan; today: string; group: string; onlyAction: boolean;
  onRaise: (itemId: string, supplierId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const orderable = (r: MrpRowView) => r.buyable && !!r.supplier;
  const [ticked, setTicked] = useState(() => new Set(rows.filter(orderable).map((r) => r.itemId)));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Record<string, string>>({}); // the supplier chosen per item; the cheapest until changed
  const [club, setClub] = useState(true);
  const chosen = (r: MrpRowView): SupplierOption => r.options.find((o) => o.id === pick[r.itemId]) ?? r.options[0];

  const shown = rows.filter((r) => (group === "all" || itemType(r.category).group === group) && (!onlyAction || r.suggested > 0));
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const visibleTicked = shown.filter((r) => orderable(r) && ticked.has(r.itemId));

  // What ticking will create: lines for the same supplier share a PO (one rule for the screen and the server).
  const qtyOf = (r: MrpRowView) => (Number(qty[r.itemId]) > 0 ? Number(qty[r.itemId]) : r.suggested);
  const groups = groupForPos(visibleTicked.map((r) => ({ itemId: r.itemId, supplierId: chosen(r).id, policy: r.policy, row: r })), club);
  const supplierName = (id: string) => rows.flatMap((r) => r.options).find((o) => o.id === id)?.name ?? "Supplier";
  const lineValue = (l: { row: MrpRowView }) => qtyOf(l.row) * chosen(l.row).price;
  // For each supplier about to get a PO: other short items it also supplies and that are not ticked, to add in a tap.
  const alsoFrom = (supplierId: string) => rows.filter((r) => orderable(r) && r.suggested > 0 && !visibleTicked.includes(r) && r.options.some((o) => o.id === supplierId));
  const tickWith = (r: MrpRowView, supplierId: string) => { setTicked((t) => new Set(t).add(r.itemId)); setPick((p) => ({ ...p, [r.itemId]: supplierId })); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Bar legend">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: GREEN }} /> On hand (approved)</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: BLUE }} /> On order, or in production for a part</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: `repeating-linear-gradient(45deg, ${RED}, ${RED} 2px, #E88A82 2px, #E88A82 4px)` }} /> Still short</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink" /> Needed in the horizon (or the reorder point when nothing is due)</span>
      </div>

      <div className="overflow-x-auto rounded-[14px] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="[&_th]:bg-canvas [&_th]:p-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ink-3">
              <th className="w-8"></th><th>Item</th><th className="min-w-56">Available against needed</th>
              <th className="text-right!">Needed<div className="font-normal text-[10px]">week / month / quarter</div></th><th className="text-right!">Suggested</th><th>Supplier</th><th>Order by</th><th></th><th className="w-8"></th>
            </tr>
          </thead>
          {shown.map((r) => {
            const t = itemType(r.category);
            const isOpen = open.has(r.itemId);
            const coming = r.onOrder + r.inProduction;
            const marker = r.gross > 0 ? r.gross : r.reorderPointLevel;
            return (
              <tbody key={r.itemId} className={r.suggested > 0 ? "" : "text-ink-3"}>
                <tr
                  className="cursor-pointer align-top hover:bg-canvas/60 [&_td]:border-t [&_td]:border-line [&_td]:p-3"
                  onClick={() => setOpen((s) => toggle(s, r.itemId))}
                  style={{ boxShadow: `inset 4px 0 0 ${t.color}` }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    {orderable(r) && (
                      <input type="checkbox" checked={ticked.has(r.itemId)} onChange={() => setTicked((s) => toggle(s, r.itemId))} aria-label={`Order ${r.code}`} className="size-5 accent-[#c2410c]" />
                    )}
                  </td>
                  <td>
                    <div className="flex items-start gap-2">
                      <TypeTag category={r.category} />
                      <div className="min-w-0">
                        <div className="font-semibold">{r.code}</div>
                        <div className="text-xs text-ink-3">{r.name}</div>
                        <div className="text-[11px] text-ink-3">{t.name}{r.role === "FG" ? " · to make" : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <SupplyBar onHand={r.onHand} coming={coming} needed={r.gross} marker={marker} />
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-2">
                      <span><b className="font-mono">{n1(r.onHand)}</b> on hand</span>
                      {coming > 0 && <span><b className="font-mono">{n1(coming)}</b> {r.role === "FG" ? "in production" : "on order"}</span>}
                      <span className={r.projected < 0 ? "font-semibold text-danger" : ""}><b className="font-mono">{n1(r.projected)}</b> projected</span>
                    </div>
                  </td>
                  <td className="text-right">
                    <div className="font-mono font-semibold">{n1(r.gross)}</div>
                    <div className="text-[11px] text-ink-3">{r.uom}</div>
                    <div className="mt-0.5 flex justify-end gap-1.5 font-mono text-[10px] text-ink-3" title="Needed in the next week / month / quarter">
                      {presets.map((p) => <span key={p.days}>{n1(r.needBy[p.days] ?? 0)}</span>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, <span key={`s${i}`}>/</span>, x] : [x]), [])}
                    </div>
                  </td>
                  <td className="text-right font-semibold" onClick={(e) => e.stopPropagation()}>
                    {r.suggested > 0 && orderable(r) ? (
                      <input
                        type="number" step="any" min="0" value={qty[r.itemId] ?? String(r.suggested)} onChange={(e) => setQty((q) => ({ ...q, [r.itemId]: e.target.value }))}
                        aria-label={`Quantity for ${r.code}`} className="min-h-10 w-24 rounded-lg border border-border px-2 text-right font-mono"
                      />
                    ) : r.suggested > 0 ? n1(r.suggested) : "—"}
                    {r.suggested > 0 && <div className="text-xs font-normal text-ink-3">{r.uom}{r.role === "FG" ? " to produce" : ""}</div>}
                  </td>
                  <td className="text-xs" onClick={(e) => e.stopPropagation()}>
                    {r.inHouse && r.suggested > 0 ? "In-house regrind" : r.role === "FG" ? "—" : r.options.length > 0 && r.suggested > 0 ? (
                      <>
                        <select
                          aria-label={`Supplier for ${r.code}`} value={chosen(r).id} onChange={(e) => setPick((p) => ({ ...p, [r.itemId]: e.target.value }))}
                          className="min-h-9 w-full min-w-44 max-w-56 rounded-lg border border-border bg-white px-2 text-xs"
                        >
                          {r.options.map((o, i) => <option key={o.id} value={o.id}>{o.name} · ₹{o.price} · {o.leadTimeDays}d{i === 0 && r.options.length > 1 ? " · cheapest" : ""}</option>)}
                        </select>
                        <div className="mt-1 text-ink-3">Lead time {chosen(r).leadTimeDays} days{r.options.length > 1 ? ` · ${r.options.length} suppliers` : ""}</div>
                      </>
                    ) : r.buyable ? <span className="rounded bg-danger-bg px-1.5 py-0.5 font-semibold text-danger">No supplier price</span> : "—"}
                  </td>
                  {(() => {
                    // Order-by follows the chosen supplier: the need date less that supplier's lead time.
                    const c = orderable(r) ? chosen(r) : null;
                    const ob = c && r.suggested > 0 ? (r.earliestDue ? addDays(r.earliestDue, -c.leadTimeDays) : today) : null;
                    const late = ob !== null && ob < today;
                    return <td className={`text-xs ${late ? "font-semibold text-danger" : ""}`}>{ob ? `${ob}${late ? " — late" : ""}` : "—"}</td>;
                  })()}
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.suggested > 0 && orderable(r) && (
                      <button type="button" onClick={() => onRaise(r.itemId, chosen(r).id)}
                        className="min-h-9 cursor-pointer whitespace-nowrap rounded-lg border border-accent px-3 text-xs font-semibold text-accent hover:bg-accent hover:text-white">
                        Raise PO
                      </button>
                    )}
                  </td>
                  <td>
                    <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} what is behind ${r.code}`} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-3" onClick={(e) => { e.stopPropagation(); setOpen((s) => toggle(s, r.itemId)); }}>
                      <ChevronRight size={18} aria-hidden className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ boxShadow: `inset 4px 0 0 ${t.color}` }}><td colSpan={9} className="!p-0"><Detail r={r} horizonDays={horizonDays} presets={presets} can={can} today={today} /></td></tr>
                )}
              </tbody>
            );
          })}
          {shown.length === 0 && (
            <tbody><tr><td className="p-4 text-ink-3" colSpan={9}>{rows.length === 0 ? "Nothing to plan. Load demand, or all stock is above its reorder levels." : "No items match this filter."}</td></tr></tbody>
          )}
        </table>
      </div>

      {visibleTicked.map((r) => (
        <Fragment key={r.itemId}>
          <input type="hidden" name="item" value={r.itemId} />
          <input type="hidden" name={`supplier_${r.itemId}`} value={chosen(r).id} />
          {qty[r.itemId] !== undefined && <input type="hidden" name={`qty_${r.itemId}`} value={qty[r.itemId]} />}
        </Fragment>
      ))}
      {club && <input type="hidden" name="club" value="1" />}

      <div className="space-y-3 rounded-[14px] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold">
              {visibleTicked.length === 0 ? "Nothing ticked" : `${visibleTicked.length} item${visibleTicked.length === 1 ? "" : "s"} ticked → ${groups.length} purchase order${groups.length === 1 ? "" : "s"}`}
            </h3>
            <p className="text-xs text-ink-3">Pick a supplier on each row, or use Raise PO on a row to order just that item. Click a row to see what is behind it.</p>
          </div>
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={club} onChange={(e) => setClub(e.target.checked)} className="size-4 accent-[#c2410c]" />
            Club items for the same supplier on one PO
          </label>
        </div>

        {groups.length > 0 && (
          <ul className="grid gap-2 md:grid-cols-2">
            {groups.map((g) => {
              const value = g.lines.reduce((a, l) => a + lineValue(l), 0);
              const more = alsoFrom(g.supplierId);
              return (
                <li key={g.key} className="space-y-1.5 rounded-xl border border-border bg-canvas p-3 text-[13px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-semibold">{supplierName(g.supplierId)}{g.segment === "AUTOMOTIVE" && <span className="ml-1.5 rounded bg-info-bg px-1 text-[10px] font-bold uppercase text-info-ink">Automotive</span>}</span>
                    <span className="font-mono text-xs">{g.lines.length} line{g.lines.length === 1 ? "" : "s"} · {money(value)}</span>
                  </div>
                  <div className="text-xs text-ink-2">{g.lines.map((l) => l.row.code).join(", ")}</div>
                  {more.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-1.5 text-xs text-ink-3">
                      Also supplies:
                      {more.slice(0, 5).map((r) => (
                        <button key={r.itemId} type="button" onClick={() => tickWith(r, g.supplierId)} className="cursor-pointer rounded-full border border-border bg-white px-2 py-0.5 font-semibold text-ink hover:border-accent hover:text-accent">+ {r.code}</button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {groups.length > 0 && !club && <p className="text-xs text-ink-3">Clubbing is off, so each item gets its own PO.</p>}
        {groups.some((g) => g.segment === "AUTOMOTIVE") && groups.some((g) => g.segment === "NON_AUTOMOTIVE" && groups.some((h) => h.supplierId === g.supplierId && h.segment === "AUTOMOTIVE")) && (
          <p className="text-xs text-ink-3">Automotive lines go on their own PO even from the same supplier, because those lots need a COA at receiving.</p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button className={`${btnCls} disabled:opacity-50`} disabled={visibleTicked.length === 0}>
            Create {groups.length} purchase order{groups.length === 1 ? "" : "s"}
          </button>
          <span className="text-xs text-ink-3">{rows.filter((r) => r.suggested > 0).length} need action, {rows.filter(orderable).length} can be ordered now.</span>
        </div>
      </div>
    </div>
  );
}


/**
 * Raise a PO for one item, choosing the supplier. The supplier's lead time is shown the moment it is picked, against when the plan
 * needs the goods: if the wanted date is inside the lead time the PO is marked "expedite" so the supplier is asked to deliver faster.
 * Other short items the same supplier also supplies can be added, so one PO covers them all.
 */
function RaiseDialog({
  rows, itemId, supplierId: firstSupplier, today, hidden, action, onClose,
}: {
  rows: MrpRowView[]; itemId: string; supplierId: string; today: string; hidden: Record<string, string>; action: FormAction; onClose: () => void;
}) {
  const row = rows.find((r) => r.itemId === itemId)!;
  const [supplierId, setSupplierId] = useState(firstSupplier);
  const supplier = row.options.find((o) => o.id === supplierId) ?? row.options[0];
  const earliest = addDays(today, supplier.leadTimeDays); // earliest delivery on the supplier's normal lead time
  const needBy = row.earliestDue ? row.earliestDue.slice(0, 10) : null;
  const wanted = needBy ? (needBy > today ? needBy : today) : earliest;
  const [date, setDate] = useState<string | null>(null);       // null: follow the default until the person picks a date
  const [expedite, setExpedite] = useState<boolean | null>(null);
  const [qty, setQty] = useState(String(row.suggested));
  const [extra, setExtra] = useState<Record<string, string>>({}); // other items added to this PO, with their quantity
  const expected = date ?? wanted;
  const early = expected < earliest;
  const asked = expedite ?? early;
  const also = rows.filter((r) => r.itemId !== itemId && r.buyable && r.suggested > 0 && r.options.some((o) => o.id === supplierId));
  const lines = [{ r: row, q: Number(qty) }, ...also.filter((r) => extra[r.itemId] !== undefined).map((r) => ({ r, q: Number(extra[r.itemId]) }))];
  const priceOf = (r: MrpRowView) => r.options.find((o) => o.id === supplierId)!.price;
  const value = lines.reduce((a, l) => a + (l.q > 0 ? l.q * priceOf(l.r) : 0), 0);
  const lead = `Lead time ${supplier.leadTimeDays} day${supplier.leadTimeDays === 1 ? "" : "s"}`;

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={`Raise a PO for ${row.code}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/45" />
      <Form action={action} className="relative max-h-[92dvh] w-full space-y-4 overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 shadow-2xl md:max-w-xl md:rounded-2xl md:p-6">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="club" value="1" />
        <input type="hidden" name="item" value={row.itemId} />
        <input type="hidden" name={`supplier_${row.itemId}`} value={supplierId} />
        <input type="hidden" name={`qty_${row.itemId}`} value={qty} />
        {lines.slice(1).map((l) => (
          <Fragment key={l.r.itemId}>
            <input type="hidden" name="item" value={l.r.itemId} />
            <input type="hidden" name={`supplier_${l.r.itemId}`} value={supplierId} />
            <input type="hidden" name={`qty_${l.r.itemId}`} value={extra[l.r.itemId]} />
          </Fragment>
        ))}

        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <TypeTag category={row.category} />
            <div>
              <h2 className="font-display text-lg font-extrabold leading-tight">Raise a PO · {row.code}</h2>
              <p className="text-[13px] text-ink-3">{row.name}. The plan suggests {n1(row.suggested)} {row.uom}{needBy ? `, needed by ${needBy}` : ""}.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-10 flex-none cursor-pointer items-center justify-center rounded-xl bg-canvas text-ink-2"><X size={18} aria-hidden /></button>
        </header>

        <label className="block text-[13px] font-semibold">Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls} aria-label="Supplier">
            {row.options.map((o, i) => <option key={o.id} value={o.id}>{o.name} · ₹{o.price} / {row.uom}{i === 0 && row.options.length > 1 ? " · cheapest" : ""}</option>)}
          </select>
        </label>
        <div className="rounded-xl bg-canvas p-3 text-[13px]" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <strong>{lead}</strong><span className="text-ink-2">earliest delivery <b>{earliest}</b></span>
          </div>
          <p className={`mt-1 text-xs ${early ? "font-semibold text-warn-ink" : "text-ink-3"}`}>
            {needBy ? (needBy < earliest ? `You need it by ${needBy}, ${daysBetween(needBy, earliest)} day${daysBetween(needBy, earliest) === 1 ? "" : "s"} before this supplier can normally deliver.` : `You need it by ${needBy}: ${daysBetween(earliest, needBy)} day${daysBetween(earliest, needBy) === 1 ? "" : "s"} of slack on this lead time.`) : "Nothing is due: the stock policy asks for a top-up."}
            {row.options.length > 1 && !early && " A different supplier may deliver sooner."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px]">Quantity ({row.uom})
            <input type="number" min="0.001" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-[13px]">Expected delivery
            <input name="expected" type="date" required min={today} value={expected} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </label>
        </div>

        <ExpediteBox asked={asked} early={early} leadTimeDays={supplier.leadTimeDays} onChange={setExpedite} />

        {also.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wide text-ink-3">{supplier.name} also supplies these short items</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-border text-[13px]">
              {also.map((r) => {
                const on = extra[r.itemId] !== undefined;
                return (
                  <li key={r.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={on} onChange={(e) => setExtra((x) => { const n = { ...x }; if (e.target.checked) n[r.itemId] = String(r.suggested); else delete n[r.itemId]; return n; })} className="size-4 accent-[#c2410c]" />
                      <TypeTag category={r.category} /><span className="truncate"><b>{r.code}</b> <span className="text-ink-3">{r.name}</span></span>
                    </label>
                    <span className="font-mono text-xs text-ink-3">₹{priceOf(r)} / {r.uom}</span>
                    {on && <input type="number" min="0.001" step="any" aria-label={`Quantity for ${r.code}`} value={extra[r.itemId]} onChange={(e) => setExtra((x) => ({ ...x, [r.itemId]: e.target.value }))} className="min-h-9 w-24 rounded-lg border border-border px-2 text-right font-mono text-xs" />}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-[13px] text-ink-2">{lines.length} line{lines.length === 1 ? "" : "s"} · <strong>{money(value)}</strong>{row.policy === "KANBAN" && " · automotive PO"}</span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className="inline-flex min-h-12 cursor-pointer items-center rounded-xl border border-border px-5 text-[15px] font-semibold">Cancel</button>
            <button className={btnCls}>Raise PO</button>
          </span>
        </footer>
      </Form>
    </div>
  );
}

const GROUP_SWATCH: Record<string, string> = { FG: "FG", RM: "RM_RESIN", MB: "RM_MASTERBATCH", BOP: "BOP", PKG: "PACKAGING", RG: "REGRIND" };

/** The type chips and the "only what needs action" switch. They sit at the top of the page and survive a recalculation. */
function MrpFilters({
  rows, group, setGroup, onlyAction, setOnlyAction,
}: { rows: MrpRowView[]; group: string; setGroup: (g: string) => void; onlyAction: boolean; setOnlyAction: (v: boolean) => void }) {
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(itemType(r.category).group, (c.get(itemType(r.category).group) ?? 0) + 1);
    return c;
  }, [rows]);
  const chip = (on: boolean) => `flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-border bg-white text-ink"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by type">
      <button type="button" className={chip(group === "all")} onClick={() => setGroup("all")}>All <span className="font-mono text-[11px] opacity-70">{rows.length}</span></button>
      {TYPE_GROUPS.filter((g) => counts.has(g.key)).map((g) => (
        <button key={g.key} type="button" className={chip(group === g.key)} onClick={() => setGroup(g.key)}>
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: itemType(GROUP_SWATCH[g.key] ?? g.key).color }} />
          {g.label} <span className="font-mono text-[11px] opacity-70">{counts.get(g.key)}</span>
        </button>
      ))}
      <label className="ml-auto flex min-h-9 cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={onlyAction} onChange={(e) => setOnlyAction(e.target.checked)} className="size-4 accent-[#c2410c]" /> Only items that need action
      </label>
    </div>
  );
}

/**
 * The whole interactive part of the MRP page. The filters live here, above the horizon controls, and are kept in the address
 * (`?type=…&action=1`) as well as in state, and every control that reloads the plan (the horizon chips, Recalculate) carries them,
 * so recalculating changes the numbers and never the view you were looking at.
 */
export function MrpWorkspace({
  rows, horizonDays, scrapPct, presets, can, today, initialGroup, initialOnlyAction, action, children,
}: {
  rows: MrpRowView[]; horizonDays: number; scrapPct: number; presets: readonly { days: number; label: string }[]; can: MrpCan; today: string;
  initialGroup: string; initialOnlyAction: boolean; action: FormAction; children?: React.ReactNode;
}) {
  const [group, setGroup] = useState(initialGroup);
  const [onlyAction, setOnlyAction] = useState(initialOnlyAction);
  const [raising, setRaising] = useState<{ itemId: string; supplierId: string } | null>(null);
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [days, setDays] = useState(String(horizonDays));
  const [allow, setAllow] = useState(String(scrapPct));
  const [customOpen, setCustomOpen] = useState(!presets.some((h) => h.days === horizonDays));

  // Keep the address in step with the filters (without navigating) so a reload, a shared link or the back button keeps them.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (group === "all") url.searchParams.delete("type"); else url.searchParams.set("type", group);
    if (onlyAction) url.searchParams.set("action", "1"); else url.searchParams.delete("action");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [group, onlyAction]);

  const keep = `${group === "all" ? "" : `&type=${group}`}${onlyAction ? "&action=1" : ""}`;
  const preset = presets.find((h) => h.days === horizonDays);
  // Recalculating swaps the plan underneath without scrolling: replace the address (scroll: false) and keep the filters in it.
  const recalc = (d: number, s: number) => {
    if (!(d >= 7 && d <= 365) || !(s >= 0 && s <= 50)) return;
    startNav(() => router.replace(`/mrp?horizon=${Math.round(d)}${s !== 2 ? `&scrap=${s}` : ""}${keep}`, { scroll: false }));
  };
  const chipCls = (on: boolean) => `flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-border bg-white text-ink"}`;

  return (
    <div className="space-y-4">
      <MrpFilters rows={rows} group={group} setGroup={setGroup} onlyAction={onlyAction} setOnlyAction={setOnlyAction} />

      {/* Planning settings: the window, the reject allowance, and one button. It recalculates in place (the page does not jump to the top). */}
      <section aria-labelledby="plan-settings" className="space-y-2.5 rounded-[14px] bg-white p-4">
        <h2 id="plan-settings" className="font-mono text-[11px] font-bold uppercase tracking-wide text-ink-3">Planning settings</h2>
        <form onSubmit={(e) => { e.preventDefault(); recalc(customOpen ? Number(days) : horizonDays, Number(allow)); }} className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
          <div className="space-y-1">
            <span className="block text-[13px] font-semibold" id="plan-window">Plan ahead</span>
            <div role="group" aria-labelledby="plan-window" className="flex flex-wrap gap-1.5">
              {presets.map((h) => (
                <button key={h.days} type="button" aria-pressed={!customOpen && h.days === horizonDays} onClick={() => { setCustomOpen(false); recalc(h.days, Number(allow)); }} className={chipCls(!customOpen && h.days === horizonDays)}>
                  {h.label} · {h.days}d
                </button>
              ))}
              <button type="button" aria-pressed={customOpen} onClick={() => setCustomOpen((v) => !v)} className={chipCls(customOpen)}>{customOpen || !preset ? `Custom${!preset ? ` · ${horizonDays}d` : ""}` : "Custom"}</button>
            </div>
          </div>
          {customOpen && (
            <label className="text-[13px] font-semibold">Days
              <input type="number" min="7" max="365" required value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 block min-h-11 w-24 rounded-xl border border-border bg-white px-3 text-base text-ink" />
            </label>
          )}
          <label className="text-[13px] font-semibold" title="Extra parts planned to cover the ones that will be rejected">Reject allowance %
            <input type="number" min="0" max="50" step="any" required value={allow} onChange={(e) => setAllow(e.target.value)} className="mt-1 block min-h-11 w-28 rounded-xl border border-border bg-white px-3 text-base text-ink" />
          </label>
          <button className={`${btnCls} min-h-11 disabled:opacity-60`} disabled={navigating}>{navigating ? "Recalculating…" : "Recalculate"}</button>
        </form>
      </section>

      {children}

      <Form action={action} className="space-y-3">
        <input type="hidden" name="horizon" value={horizonDays} />
        <input type="hidden" name="scrap" value={scrapPct} />
        {group !== "all" && <input type="hidden" name="type" value={group} />}
        {onlyAction && <input type="hidden" name="action" value="1" />}
        <MrpTable rows={rows} horizonDays={horizonDays} presets={presets} can={can} today={today} group={group} onlyAction={onlyAction} onRaise={(itemId, supplierId) => setRaising({ itemId, supplierId })} />
      </Form>
      {raising && (
        <RaiseDialog
          key={`${raising.itemId}:${raising.supplierId}`} rows={rows} itemId={raising.itemId} supplierId={raising.supplierId} today={today} action={action} onClose={() => setRaising(null)}
          hidden={{ horizon: String(horizonDays), scrap: String(scrapPct), ...(group !== "all" ? { type: group } : {}), ...(onlyAction ? { action: "1" } : {}) }}
        />
      )}
    </div>
  );
}
