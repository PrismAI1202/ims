"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { itemType, TYPE_GROUPS } from "@/lib/item-types";
import { btnCls } from "@/components/flash";
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
  rows, horizonDays, presets, can, today, group, onlyAction,
}: { rows: MrpRowView[]; horizonDays: number; presets: readonly { days: number; label: string }[]; can: MrpCan; today: string; group: string; onlyAction: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const orderable = (r: MrpRowView) => r.buyable && !!r.supplier;
  const [ticked, setTicked] = useState(() => new Set(rows.filter(orderable).map((r) => r.itemId)));
  const [qty, setQty] = useState<Record<string, string>>({});

  const shown = rows.filter((r) => (group === "all" || itemType(r.category).group === group) && (!onlyAction || r.suggested > 0));
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const visibleTicked = shown.filter((r) => orderable(r) && ticked.has(r.itemId));

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
              <th className="text-right!">Needed<div className="font-normal text-[10px]">week / month / quarter</div></th><th className="text-right!">Suggested</th><th>Supplier</th><th>Order by</th><th className="w-8"></th>
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
                  <td className="text-xs">
                    {r.inHouse && r.suggested > 0 ? "In-house regrind" : r.role === "FG" ? "—" : r.supplier ? <>{r.supplier.name}<div className="text-ink-3">₹{r.supplier.price} · {r.supplier.leadTimeDays}d lead</div></> : r.buyable ? <span className="rounded bg-danger-bg px-1.5 py-0.5 font-semibold text-danger">No supplier price</span> : "—"}
                  </td>
                  <td className={`text-xs ${r.late ? "font-semibold text-danger" : ""}`}>{r.orderBy ? `${day(r.orderBy)}${r.late ? " — late" : ""}` : "—"}</td>
                  <td>
                    <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} what is behind ${r.code}`} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-3" onClick={(e) => { e.stopPropagation(); setOpen((s) => toggle(s, r.itemId)); }}>
                      <ChevronRight size={18} aria-hidden className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ boxShadow: `inset 4px 0 0 ${t.color}` }}><td colSpan={8} className="!p-0"><Detail r={r} horizonDays={horizonDays} presets={presets} can={can} today={today} /></td></tr>
                )}
              </tbody>
            );
          })}
          {shown.length === 0 && (
            <tbody><tr><td className="p-4 text-ink-3" colSpan={8}>{rows.length === 0 ? "Nothing to plan. Load demand, or all stock is above its reorder levels." : "No items match this filter."}</td></tr></tbody>
          )}
        </table>
      </div>

      {visibleTicked.map((r) => <Fragment key={r.itemId}><input type="hidden" name="item" value={r.itemId} />{qty[r.itemId] !== undefined && <input type="hidden" name={`qty_${r.itemId}`} value={qty[r.itemId]} />}</Fragment>)}
      <div className="flex flex-wrap items-center gap-4">
        <button className={`${btnCls} disabled:opacity-50`} disabled={visibleTicked.length === 0}>
          Create purchase orders for {visibleTicked.length} ticked item{visibleTicked.length === 1 ? "" : "s"}
        </button>
        <span className="text-xs text-ink-3">{rows.filter((r) => r.suggested > 0).length} need action, {rows.filter(orderable).length} can be ordered now. Click a row to see what is behind it.</span>
      </div>
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

  // Keep the address in step with the filters (without navigating) so a reload, a shared link or the back button keeps them.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (group === "all") url.searchParams.delete("type"); else url.searchParams.set("type", group);
    if (onlyAction) url.searchParams.set("action", "1"); else url.searchParams.delete("action");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [group, onlyAction]);

  const keep = `${group === "all" ? "" : `&type=${group}`}${onlyAction ? "&action=1" : ""}`;
  const href = (days: number) => `/mrp?horizon=${days}${scrapPct !== 2 ? `&scrap=${scrapPct}` : ""}${keep}`;
  const preset = presets.find((h) => h.days === horizonDays);
  const chipCls = (on: boolean) => `flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-border bg-white text-ink"}`;

  return (
    <div className="space-y-4">
      <MrpFilters rows={rows} group={group} setGroup={setGroup} onlyAction={onlyAction} setOnlyAction={setOnlyAction} />

      <div className="space-y-3 rounded-[14px] bg-white p-4">
        <div role="group" className="flex flex-wrap gap-1.5">
          {presets.map((h) => <Link key={h.days} href={href(h.days)} scroll={false} aria-current={h.days === horizonDays ? "true" : undefined} className={chipCls(h.days === horizonDays)}>{h.label} · {h.days}d</Link>)}
          <a href="#custom" className={chipCls(!preset)}>{preset ? "Custom" : `Custom · ${horizonDays}d`}</a>
        </div>
        <form method="get" id="custom" className="flex scroll-mt-4 flex-wrap items-end gap-3">
          {group !== "all" && <input type="hidden" name="type" value={group} />}
          {onlyAction && <input type="hidden" name="action" value="1" />}
          <label className="text-[13px]">Plan ahead (days)<input name="horizon" type="number" min="7" max="365" defaultValue={horizonDays} className="mt-1 min-h-12 w-28 rounded-xl border border-border bg-white px-3.5 text-base text-ink" /></label>
          <label className="text-[13px]">Reject allowance %<input name="scrap" type="number" min="0" max="50" step="any" defaultValue={scrapPct} className="mt-1 min-h-12 w-28 rounded-xl border border-border bg-white px-3.5 text-base text-ink" /></label>
          <button className={btnCls}>Recalculate</button>
          <span className="pb-3 text-xs text-ink-3">Any number from 7 to 365 days. Your filters stay as they are.</span>
        </form>
      </div>

      {children}

      <Form action={action} className="space-y-3">
        <input type="hidden" name="horizon" value={horizonDays} />
        <input type="hidden" name="scrap" value={scrapPct} />
        {group !== "all" && <input type="hidden" name="type" value={group} />}
        {onlyAction && <input type="hidden" name="action" value="1" />}
        <MrpTable rows={rows} horizonDays={horizonDays} presets={presets} can={can} today={today} group={group} onlyAction={onlyAction} />
      </Form>
    </div>
  );
}
