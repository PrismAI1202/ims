"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, HelpCircle, TriangleAlert } from "lucide-react";
import { Badge, Card, LegendDot, Mono, PageHeader } from "@/components/ui";
import { METRIC_DEFS } from "@/lib/metric-defs";
import type { KpiTile, MetricsData } from "@/server/services/metrics";

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const pct0 = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(0)}%`);
const TONE_FG: Record<KpiTile["tone"], string> = { ok: "text-ok", warn: "text-warn-ink", danger: "text-danger", neutral: "text-ink-2" };

const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

/** Info tip: opens on hover (and keyboard focus) on desktop; on touch screens it opens on tap. */
function Tip({ k, openKey, setOpen, align = "right" }: { k: string; openKey: string | null; setOpen: (v: string | null) => void; align?: "left" | "right" }) {
  const [name, text] = METRIC_DEFS[k];
  const open = openKey === k;
  return (
    <span className="relative inline-flex flex-none"
      onMouseEnter={() => canHover() && setOpen(k)} onMouseLeave={() => canHover() && setOpen(null)}>
      <button onClick={() => { if (!canHover()) setOpen(open ? null : k); }}
        onFocus={() => canHover() && setOpen(k)} onBlur={() => canHover() && setOpen(null)}
        aria-label={`What is ${name}?`} aria-expanded={open}
        className="-m-1.5 flex size-8 cursor-help items-center justify-center rounded-full text-ink-3 hover:text-ink">
        <HelpCircle size={15} aria-hidden />
      </button>
      {open && (
        <span role="tooltip" className={`absolute top-full z-10 mt-1 w-56 rounded-[10px] bg-shell p-3 text-left text-xs font-normal leading-snug text-on-shell shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          <strong className="mb-0.5 block">{name}</strong>{text}
        </span>
      )}
    </span>
  );
}

export function MetricsView({ data, footer }: { data: MetricsData; footer?: React.ReactNode }) {
  const [mode, setMode] = useState(0);
  const [selIdx, setSel] = useState<number | null>(null);
  const [tip, setTip] = useState<string | null>(null);

  const D = data.periods[mode];
  const n = D.labels.length;
  const oeeAt = (i: number): number | null => (D.A[i] === null || D.P[i] === null || D.Q[i] === null ? null : D.A[i]! * D.P[i]! * D.Q[i]!);
  // Start on the latest period that has data (today may be a day off), unless the viewer tapped a bar.
  const latest = Math.max(0, D.labels.map((_, i) => i).filter((i) => oeeAt(i) !== null).pop() ?? n - 1);
  const sel = selIdx === null || selIdx >= n ? latest : selIdx;
  const o = oeeAt(sel);
  const before = sel > 0 ? oeeAt(sel - 1) : null;
  const dpp = o !== null && before !== null ? (o - before) * 100 : null;
  const band = o === null ? { t: "No data", cls: "bg-canvas text-ink-2", Icon: ArrowRight } : o >= 0.85 ? { t: "World-class", cls: "bg-ok-bg text-ok-ink", Icon: Check } : o >= 0.65 ? { t: "Above typical", cls: "bg-info-bg text-info-ink", Icon: ArrowRight } : { t: "Below target", cls: "bg-danger-bg text-danger", Icon: TriangleAlert };
  const total = D.pareto.reduce((a, x) => a + x[1], 0);
  const maxDown = D.pareto[0]?.[1] ?? 1;
  const top2 = (D.pareto[0]?.[1] ?? 0) + (D.pareto[1]?.[1] ?? 0);
  const kpis = D.kpis;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="PLANT 2 · ALL MACHINES" title="Performance">
        <div role="tablist" aria-label="Period" className="grid grid-cols-3 gap-1 rounded-xl bg-shell-2 p-1">
          {data.periods.map((d, i) => (
            <button key={d.name} role="tab" aria-selected={i === mode} onClick={() => { setMode(i); setSel(null); }}
              className={`min-h-10 cursor-pointer rounded-[9px] text-[13px] font-semibold ${i === mode ? "bg-on-shell text-ink" : "text-[#d5d7db]"}`}>{d.name}</button>
          ))}
        </div>
      </PageHeader>

      {!data.hasData && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-info-bg px-3.5 py-2.5 text-[13px] text-info-ink">
          <Badge tone="info">No data yet</Badge>Book production and log downtime on the Production screen. OEE, downtime and machine charts fill in from those records.
        </div>
      )}
      {data.missingCycle.length > 0 && (
        <div className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-ink">
          Performance can&apos;t be measured for {data.missingCycle.join(", ")} because the standard cycle time isn&apos;t set. Add it under Maintenance → mould settings.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1 text-xs font-semibold text-ink-3">OEE · {D.labels[sel]}{sel === latest ? ` (latest ${D.unit} with data)` : ""} <Tip k="oee" openKey={tip} setOpen={setTip} align="left" /></span>
              <span className="font-display text-[44px] font-extrabold leading-none">{pct(o)}</span>
              <span className={`text-[13px] font-semibold ${dpp === null ? "text-ink-3" : dpp >= 0 ? "text-ok" : "text-danger"}`}>
                {dpp === null ? (o === null ? `Nothing booked this ${D.unit}` : before === null ? `Nothing to compare with` : `First ${D.unit} in view`) : `${dpp >= 0 ? "▲" : "▼"} ${Math.abs(dpp).toFixed(1)} pts vs previous ${D.unit}`}
              </span>
            </div>
            <span className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold ${band.cls}`}><band.Icon size={14} aria-hidden />{band.t}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([["Availability", D.A], ["Performance", D.P], ["Quality", D.Q]] as const).map(([label, arr]) => (
              <div key={label} className="flex flex-col gap-1 rounded-[10px] bg-[#f4f3ef] p-2.5">
                <span className="flex items-center justify-between text-[11px] font-semibold text-ink-3">{label} <Tip k={label} openKey={tip} setOpen={setTip} align={label === "Quality" ? "right" : "left"} /></span>
                <Mono className="text-[17px]">{pct(arr[sel])}</Mono>
              </div>
            ))}
          </div>
          <span className="text-xs text-ink-3">OEE = Availability × Performance × Quality · 85% is world-class; many shops run 50–65%.</span>
        </Card>

        <Card className="space-y-2.5">
          <div className="flex items-baseline justify-between"><h2 className="font-display text-base font-bold">OEE trend · {D.trend}</h2><span className="text-[11px] text-ink-3">Tap a bar</span></div>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3"><span className="h-2.5 w-3.5 rounded-sm bg-[#ECEAE4]" />Shaded band = typical 50–65%</span>
          <div className="flex gap-1.5">
            <div aria-hidden className="relative h-[150px] w-6 font-mono text-[10px] text-ink-3">
              <span className="absolute right-0" style={{ bottom: "calc(100% - 6px)" }}>100</span>
              <span className="absolute right-0" style={{ bottom: "calc(50% - 6px)" }}>50</span>
              <span className="absolute right-0 -bottom-1.5">0</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="relative h-[150px] border-b border-[#9AA0A8]">
                <span aria-hidden className="absolute inset-x-0 bottom-1/2 border-t border-[#ECEAE4]" />
                <span aria-hidden className="absolute inset-x-0 bottom-full border-t border-[#ECEAE4]" />
                <span aria-hidden className="absolute inset-x-0 bottom-1/2 h-[15%] bg-[#ECEAE4]" />
                <span aria-hidden className="absolute inset-x-0 bottom-[85%] border-t-2 border-dashed border-ok" />
                <span aria-hidden className="absolute right-0 text-[10px] font-bold text-ok" style={{ bottom: "calc(85% + 3px)" }}>World-class 85%</span>
                <div className="absolute inset-0 flex items-end gap-1.5">
                  {D.labels.map((l, i) => {
                    const v = oeeAt(i);
                    const h = v === null ? 0 : v;
                    const on = i === sel;
                    return (
                      <button key={l} onClick={() => setSel(i)} aria-label={`${l}: OEE ${pct(v)}`} aria-pressed={on} className="relative h-full min-w-0 flex-1 cursor-pointer">
                        <span className={`absolute left-1/2 -translate-x-1/2 font-mono text-[10px] ${on ? "visible font-bold text-ink" : "invisible"}`} style={{ bottom: `calc(${(h * 100).toFixed(1)}% + 3px)` }}>{pct0(v)}</span>
                        <span className="absolute inset-x-0 bottom-0 rounded-t" style={{ height: `${Math.max(h * 100, v === null ? 1 : 0).toFixed(1)}%`, background: v === null ? "#E7E4DD" : on ? "#1D4ED8" : "#A9C0F2" }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-1.5">{D.labels.map((l, i) => <span key={l} className={`min-w-0 flex-1 truncate text-center text-[10px] ${i === sel ? "font-bold text-ink" : "text-ink-3"}`}>{l}</span>)}</div>
            </div>
          </div>
        </Card>

        <Card className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1"><h2 className="font-display text-base font-bold">Downtime reasons</h2><Tip k="down" openKey={tip} setOpen={setTip} align="left" /></span>
            <Mono className="text-xs text-ink-3">{total.toLocaleString("en-US")} min</Mono>
          </div>
          {D.pareto.map(([r, m]) => (
            <div key={r} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-xs">
              <span className="truncate">{r}</span>
              <span aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px] bg-[#E98A3E]" style={{ width: `${(m / maxDown) * 100}%` }} /></span>
              <Mono className="text-right">{m.toLocaleString("en-US")}</Mono>
            </div>
          ))}
          {D.pareto.length === 0 && <span className="text-sm text-ink-3">No downtime logged in this period.</span>}
          {D.pareto.length > 1 && <span className="text-xs text-ink-3">Top two reasons are {Math.round((top2 / total) * 100)}% of lost time — {D.pareto[0][0].toLowerCase()} and {D.pareto[1][0].toLowerCase()}.</span>}
        </Card>

        <Card className="space-y-2">
          <span className="flex items-center gap-1"><h2 className="font-display text-base font-bold">OEE by machine</h2><Tip k="mach" openKey={tip} setOpen={setTip} align="left" /></span>
          <div className="grid grid-cols-[3rem_1fr_3rem_3rem_3rem] gap-2 text-[11px] font-semibold text-ink-3"><span>Mach.</span><span>OEE</span><span>Avail.</span><span>Perf.</span><span>Qual.</span></div>
          {D.machines.map((m) => {
            const v = m[1] === null || m[2] === null || m[3] === null ? null : m[1] * m[2] * m[3];
            return (
              <div key={m[0]} className="grid grid-cols-[3rem_1fr_3rem_3rem_3rem] items-center gap-2 border-t border-line pt-2 text-xs">
                <Mono>{m[0]}</Mono>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: v === null ? "#C9C5BC" : v >= 0.75 ? "#1E7A46" : v >= 0.6 ? "#E0A526" : "#B42318" }} /><strong>{pct0(v)}</strong></span>
                <Mono>{pct0(m[1])}</Mono><Mono>{pct0(m[2])}</Mono><Mono>{pct0(m[3])}</Mono>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-ink-3"><LegendDot color="#1E7A46" label="≥ 75%" /><LegendDot color="#E0A526" label="60–75%" /><LegendDot color="#B42318" label="< 60% needs attention" /></div>
        </Card>

        <Card className="space-y-2.5">
          <span className="flex items-center gap-1"><h2 className="font-display text-base font-bold">OEE by shift</h2><Tip k="shift" openKey={tip} setOpen={setTip} align="left" /></span>
          {D.shifts.map(([nm, v]) => (
            <div key={nm} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 text-xs">
              <span>{nm}</span>
              <span aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px]" style={{ width: v === null ? "0%" : pct0(v), background: v !== null && v >= 0.65 ? "#1D4ED8" : "#E98A3E" }} /></span>
              <Mono className="text-right">{pct0(v)}</Mono>
            </div>
          ))}
        </Card>

        <Card>
          <div className="grid grid-cols-2 gap-2.5">
            {kpis.map((k, i) => (
              <div key={k.label} className="relative rounded-[10px] bg-[#f4f3ef]">
                <Link href={k.href} className="flex min-h-[4.5rem] flex-col gap-0.5 p-2.5">
                  <span className="text-[11px] font-semibold text-ink-3">{k.label}</span>
                  <Mono className="text-lg">{k.value}</Mono>
                  <span className={`text-[11px] font-semibold ${TONE_FG[k.tone]}`}>{k.note}</span>
                </Link>
                <span className="absolute right-1 top-1"><Tip k={k.label} openKey={tip} setOpen={setTip} align={i % 2 === 0 ? "left" : "right"} /></span>
              </div>
            ))}
          </div>
          <Link href="/reports/variance" className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border text-sm font-semibold">BOM variance report (live) <ArrowRight size={15} aria-hidden /></Link>
        </Card>
      </div>
      {footer}
    </div>
  );
}
