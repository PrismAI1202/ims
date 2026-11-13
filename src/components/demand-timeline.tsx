"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, daysBetween } from "@/lib/lead-time";
import { standingOf, STANDING, type Standing } from "@/lib/demand-standing";
import { Form } from "@/components/form";
import type { FormAction } from "@/lib/action-result";

// Customer demand on a scrollable timeline. One row per customer and part, one column per day, one chip per order on its due date.
// Colour says where an order stands (open, part shipped, overdue, shipped, or forecast); the letter on the chip says what kind it is
// (F firm, S spot). A strip above the grid adds up what is still to ship in each week, so a heavy week stands out.

export interface TimelineLine {
  id: string; customer: string; customerId: string; segment: string; part: string; partName: string;
  due: string; // YYYY-MM-DD
  qty: number; shipped: number; type: "FIRM" | "SPOT" | "FORECAST";
  ref: string | null; // the customer's own PO number
}
const TYPE_LETTER = { FIRM: "F", SPOT: "S", FORECAST: "~" } as const;
const TYPE_NAME = { FIRM: "Firm order", SPOT: "Spot order", FORECAST: "Forecast" } as const;

const DAY_W = 34;      // px per day column
const LABEL_W = 208;   // sticky left column
const LANE_H = 28;     // one chip lane
const CHIP_W = 56;     // chips are this wide, so two on neighbouring days share the row by using another lane

const short = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
const monday = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const dm = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const monthOf = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function DemandTimeline({ lines, today, canOpenOrders, canOpenMrp, removeAction, backHref }: {
  lines: TimelineLine[]; today: string; canOpenOrders: boolean; canOpenMrp: boolean;
  removeAction?: FormAction; backHref?: string; // who may take an unshipped line back out (the planner), and where to return
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The window covers from two weeks back to eight weeks ahead, widened to take in every line, within a sane cap.
  const { start, days } = useMemo(() => {
    const dues = lines.map((l) => l.due).sort();
    const from = monday(dues[0] && dues[0] < addDays(today, -14) ? dues[0] : addDays(today, -14));
    const to = dues.length && dues[dues.length - 1] > addDays(today, 56) ? dues[dues.length - 1] : addDays(today, 56);
    return { start: from, days: Math.min(Math.max(daysBetween(from, to) + 7, 70), 300) };
  }, [lines, today]);
  const dayIso = (i: number) => addDays(start, i);
  const col = (iso: string) => daysBetween(start, iso);
  const todayCol = col(today);

  // Rows: one per customer and part, grouped under the customer. Chips on the same day are merged into one.
  const groups = useMemo(() => {
    const byCustomer = new Map<string, { name: string; segment: string; parts: Map<string, { part: string; partName: string; lines: TimelineLine[] }> }>();
    for (const l of lines) {
      const c = byCustomer.get(l.customerId) ?? { name: l.customer, segment: l.segment, parts: new Map() };
      const p = c.parts.get(l.part) ?? { part: l.part, partName: l.partName, lines: [] };
      p.lines.push(l);
      c.parts.set(l.part, p);
      byCustomer.set(l.customerId, c);
    }
    return [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ ...c, parts: [...c.parts.values()].sort((a, b) => a.part.localeCompare(b.part)) }));
  }, [lines]);

  // Merge same-day orders of one part into one chip (summed quantity, the most urgent standing), then give each chip a lane.
  const rank: Standing[] = ["overdue", "open", "part", "forecast", "shipped"];
  const chipsOf = (rows: TimelineLine[]) => {
    const byDay = new Map<string, TimelineLine[]>();
    for (const l of rows) byDay.set(l.due, [...(byDay.get(l.due) ?? []), l]);
    const chips = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([due, ls]) => {
      const standing = ls.map((l) => standingOf(l, today)).sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0];
      const qty = ls.reduce((a, l) => a + l.qty, 0), shipped = ls.reduce((a, l) => a + l.shipped, 0);
      return { due, lines: ls, standing, qty, shipped, type: ls[0].type, lane: 0 };
    });
    const laneEnd: number[] = [];
    for (const c of chips) {
      const x = col(c.due) * DAY_W;
      let lane = laneEnd.findIndex((end) => x >= end);
      if (lane < 0) lane = laneEnd.length;
      laneEnd[lane] = x + CHIP_W + 2;
      c.lane = lane;
    }
    return { chips, lanes: Math.max(laneEnd.length, 1) };
  };

  // What is still to ship in each week (orders), and the forecast on top of it.
  const weeks = useMemo(() => {
    const out: { start: string; orders: number; forecast: number }[] = [];
    for (let i = 0; i < days; i += 7) out.push({ start: dayIso(i), orders: 0, forecast: 0 });
    for (const l of lines) {
      const w = out[Math.floor(col(l.due) / 7)];
      if (!w) continue;
      if (l.type === "FORECAST") w.forecast += l.qty; else w.orders += Math.max(l.qty - l.shipped, 0);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, start, days]);
  const peak = Math.max(1, ...weeks.map((w) => w.orders + w.forecast));

  useEffect(() => { // open with today near the left edge
    scroller.current?.scrollTo({ left: Math.max(0, (todayCol - 4) * DAY_W), behavior: "auto" });
  }, [todayCol]);

  const width = LABEL_W + days * DAY_W;
  const chosen = lines.filter((l) => l.id === selected);
  const month: { label: string; span: number }[] = [];
  for (let i = 0; i < days; i++) {
    const label = monthOf(dayIso(i));
    if (month.length && month[month.length - 1].label === label) month[month.length - 1].span++; else month.push({ label, span: 1 });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2" aria-label="Legend">
        {(["open", "part", "overdue", "shipped", "forecast"] as Standing[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded" style={{ background: k === "part" ? `linear-gradient(90deg, #1E7A46 45%, ${STANDING.part.bg} 45%)` : STANDING[k].bg, border: `1.5px ${k === "forecast" ? "dashed" : "solid"} ${STANDING[k].ring}` }} />{STANDING[k].label}</span>
        ))}
        <span className="text-ink-3">· F firm · S spot · ~ forecast · chip shows parts</span>
      </div>

      <div ref={scroller} role="region" aria-label="Demand timeline, scrolls sideways" tabIndex={0}
        className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-[14px] bg-white focus-visible:outline-2 focus-visible:outline-accent">
        <div style={{ width, minHeight: "100%" }} className="relative">
          {/* Header: months, weeks (with the load in each), then days. Sticky to the top while rows scroll. */}
          <div className="sticky top-0 z-30 bg-white">
            <div className="flex border-b border-line text-[11px] font-semibold text-ink-2">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-40 flex-none bg-white px-3 py-1.5 text-ink-3">Customer · part</div>
              {month.map((m) => <div key={m.label} style={{ width: m.span * DAY_W }} className="flex-none truncate border-l border-line px-2 py-1.5">{m.label}</div>)}
            </div>
            <div className="flex border-b border-line">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-40 flex-none bg-white px-3 py-1 text-[11px] text-ink-3">To ship per week</div>
              {weeks.map((w) => {
                const h = (n: number) => Math.round((n / peak) * 30);
                return (
                  <div key={w.start} style={{ width: 7 * DAY_W }} className="flex flex-none items-end gap-px border-l border-line px-1 pt-1" title={`Week of ${dm(w.start)}: ${w.orders.toLocaleString()} to ship${w.forecast ? `, ${w.forecast.toLocaleString()} forecast` : ""}`}>
                    <div className="flex h-9 w-full flex-col justify-end">
                      <div className="flex items-end gap-px">
                        <span style={{ height: h(w.orders) }} className="w-1.5 rounded-t-sm bg-[#1D4ED8]" aria-hidden />
                        <span style={{ height: h(w.forecast) }} className="w-1.5 rounded-t-sm border border-dashed border-[#8A8F98] bg-white" aria-hidden />
                        <span className="ml-1 self-end font-mono text-[10px] text-ink-3">{w.orders + w.forecast ? short(w.orders + w.forecast) : ""}</span>
                      </div>
                      <span className="text-[10px] text-ink-3">{dm(w.start)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex border-b border-line text-[10px] text-ink-3">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-40 flex-none bg-white" />
              {Array.from({ length: days }, (_, i) => {
                const iso = dayIso(i); const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
                return (
                  <div key={i} style={{ width: DAY_W }} className={`flex-none py-0.5 text-center ${dow === 0 || dow === 6 ? "bg-canvas" : ""} ${i === todayCol ? "bg-accent font-bold text-white" : ""}`}>
                    <div>{"SMTWTFS"[dow]}</div><div className="font-mono">{iso.slice(8)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* The today line runs through every row. */}
          {todayCol >= 0 && todayCol < days && <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-accent/50" style={{ left: LABEL_W + todayCol * DAY_W + DAY_W / 2 }} />}

          {groups.map((c) => (
            <section key={c.name}>
              <div className="sticky left-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-3 py-1.5 text-[12px] font-bold" style={{ width: LABEL_W + days * DAY_W }}>
                <span className="sticky left-3">{c.name}</span>
                <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${c.segment === "AUTOMOTIVE" ? "bg-info-bg text-info-ink" : "bg-warn-bg text-warn-ink"}`}>{c.segment === "AUTOMOTIVE" ? "Auto" : "Non-auto"}</span>
              </div>
              {c.parts.map((p) => {
                const { chips, lanes } = chipsOf(p.lines);
                const toShip = p.lines.filter((l) => l.type !== "FORECAST").reduce((a, l) => a + Math.max(l.qty - l.shipped, 0), 0);
                return (
                  <div key={p.part} className="flex border-b border-line" style={{ height: lanes * LANE_H + 12 }}>
                    <div style={{ width: LABEL_W }} className="sticky left-0 z-20 flex-none bg-white px-3 py-1.5">
                      <div className="truncate font-mono text-[12px] font-semibold">{p.part}</div>
                      <div className="truncate text-[10px] text-ink-3">{p.partName}{toShip > 0 && <> · {short(toShip)} to ship</>}</div>
                    </div>
                    <div className="relative flex-none" style={{ width: days * DAY_W }}>
                      {/* weekend shading */}
                      {Array.from({ length: days }, (_, i) => { const dow = new Date(`${dayIso(i)}T00:00:00Z`).getUTCDay(); return dow === 0 || dow === 6 ? <span key={i} aria-hidden className="absolute inset-y-0 bg-canvas/70" style={{ left: i * DAY_W, width: DAY_W }} /> : null; })}
                      {chips.map((c) => {
                        const st = STANDING[c.standing];
                        const fill = c.standing === "part" ? `linear-gradient(90deg, #1E7A46 ${Math.round((c.shipped / c.qty) * 100)}%, ${st.bg} ${Math.round((c.shipped / c.qty) * 100)}%)` : st.bg;
                        const on = c.lines.some((l) => l.id === selected);
                        return (
                          <button key={c.due} type="button" onClick={() => setSelected(on ? null : c.lines[0].id)}
                            aria-label={`${p.part} for ${c.lines[0].customer}: ${c.qty.toLocaleString()} parts, due ${c.due}, ${st.label}`} aria-pressed={on}
                            title={`${c.lines.map((l) => `${TYPE_NAME[l.type]} · ${l.qty.toLocaleString()}${l.type !== "FORECAST" && l.shipped ? ` (${l.shipped.toLocaleString()} shipped)` : ""}`).join("\n")}\nDue ${c.due} · ${st.label}`}
                            className={`absolute z-[5] flex cursor-pointer items-center justify-center gap-1 rounded-md px-1 text-[11px] font-bold leading-none shadow-sm ${on ? "outline-2 outline-offset-2 outline-ink" : ""}`}
                            style={{ left: col(c.due) * DAY_W + (DAY_W - CHIP_W) / 2, top: 6 + c.lane * LANE_H, width: CHIP_W, height: LANE_H - 4, background: fill, color: st.fg, border: `1.5px ${c.standing === "forecast" ? "dashed" : "solid"} ${st.ring}` }}>
                            <span className="opacity-80">{c.lines.length > 1 ? c.lines.length : TYPE_LETTER[c.type]}</span><span className="font-mono">{short(c.qty)}</span>
                            {c.standing === "shipped" && <span aria-hidden>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          {lines.length === 0 && <p className="sticky left-0 p-6 text-sm text-ink-3" style={{ width: LABEL_W + 600 }}>No demand matches these filters.</p>}
        </div>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 rounded-[14px] bg-white p-3.5 text-[13px]" role="status">
          {(() => {
            // every order on that chip's day and part
            const l = chosen[0];
            const same = lines.filter((x) => x.customerId === l.customerId && x.part === l.part && x.due === l.due);
            return (
              <>
                <span><b>{l.customer}</b> · <span className="font-mono font-semibold">{l.part}</span> <span className="text-ink-3">{l.partName}</span><br /><span className="text-xs text-ink-3">due {l.due} · {dm(l.due)}{same.some((x) => x.ref) && <> · PO <span className="font-mono">{[...new Set(same.map((x) => x.ref).filter(Boolean))].join(", ")}</span></>}</span></span>
                {same.map((x) => {
                  const st = standingOf(x, today);
                  return (
                    <span key={x.id} className="flex flex-col">
                      <span><span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: st === "forecast" ? "#585C63" : STANDING[st].bg }}>{STANDING[st].label}</span> <span className="text-xs text-ink-2">{TYPE_NAME[x.type]}</span></span>
                      <span className="font-mono text-xs">{x.qty.toLocaleString()} ordered{x.type !== "FORECAST" && <> · {x.shipped.toLocaleString()} shipped · <b>{Math.max(x.qty - x.shipped, 0).toLocaleString()} to ship</b></>}</span>
                      {removeAction && x.shipped === 0 && (confirming === x.id ? (
                        <Form action={removeAction} className="mt-1 flex items-center gap-2 text-xs">
                          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="back" value={backHref ?? "/demand"} />
                          <span className="font-semibold text-danger">Remove this line for good?</span>
                          <button className="cursor-pointer rounded-md bg-danger px-2 py-1 font-semibold text-white">Yes, remove</button>
                          <button type="button" onClick={() => setConfirming(null)} className="cursor-pointer font-semibold text-ink-2">Keep</button>
                        </Form>
                      ) : <button type="button" onClick={() => setConfirming(x.id)} className="mt-1 w-fit cursor-pointer text-xs font-semibold text-danger">Remove line</button>)}
                    </span>
                  );
                })}
                <span className="ml-auto flex gap-4">
                  {canOpenOrders && <Link href={`/orders?kind=demand&q=${encodeURIComponent(l.part)}&state=all`} className="font-semibold text-accent">In Orders →</Link>}
                  {canOpenMrp && <Link href="/mrp" className="font-semibold text-accent">MRP plan →</Link>}
                </span>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
