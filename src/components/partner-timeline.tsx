"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// A partner's orders on a time axis: one row per order, a dot on the day it was raised or is due, and (for a purchase order) a bar
// to the date it is expected. Scrolls sideways; opens at today.

export interface TimelineOrder { key: string; id: string; what: string; meta: string; status: string; open: boolean; date: string; until?: string; href?: string }

const DAY = 86400000;
const PX = 26;
const at = (iso: string) => Math.floor(new Date(iso).getTime() / DAY);

export function PartnerTimeline({ orders, today }: { orders: TimelineOrder[]; today: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const t0 = at(today);
  const all = orders.flatMap((o) => [at(o.date), o.until ? at(o.until) : at(o.date)]);
  const start = Math.min(t0 - 7, ...all) - 3;
  const end = Math.max(t0 + 21, ...all) + 5;
  const days = end - start + 1;
  const x = (d: number) => (d - start) * PX;
  const width = days * PX;

  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(t0) - 160); });

  const ticks = Array.from({ length: days }, (_, i) => start + i);
  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-white">
      <ul className="w-36 flex-none divide-y divide-line border-r border-border md:w-52" aria-label="Orders">
        <li className="h-8 bg-canvas" />
        {orders.map((o) => (
          <li key={o.key} className="h-12 px-2.5 py-1.5">
            <span className="block truncate font-mono text-[12px] font-semibold">{o.id}</span>
            <span className="block truncate text-[11px] text-ink-3">{o.what}</span>
          </li>
        ))}
      </ul>
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative" style={{ width }}>
          <div className="relative h-8 border-b border-border bg-canvas">
            {ticks.map((d) => {
              const dt = new Date(d * DAY);
              const first = dt.getUTCDate() === 1;
              const label = first ? dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) : dt.getUTCDay() === 1 ? String(dt.getUTCDate()) : "";
              return label ? <span key={d} className={`absolute top-2 text-[10px] ${first ? "font-bold text-ink" : "text-ink-3"}`} style={{ left: x(d) + 3 }}>{label}</span> : null;
            })}
          </div>
          {ticks.filter((d) => new Date(d * DAY).getUTCDay() === 1).map((d) => <span key={d} aria-hidden className="absolute bottom-0 top-8 border-l border-line" style={{ left: x(d) }} />)}
          <span aria-hidden className="absolute bottom-0 top-0 z-10 border-l-2 border-accent" style={{ left: x(t0) + PX / 2 }} title="Today" />
          <ul className="divide-y divide-line">
            {orders.map((o) => {
              const a = at(o.date), b = o.until ? at(o.until) : a;
              const colour = o.open ? "bg-accent" : "bg-ink-3";
              const bar = (
                <>
                  {b > a && <span className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${colour} opacity-30`} style={{ left: x(a) + PX / 2, width: (b - a) * PX }} />}
                  <span className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full ring-2 ring-white ${colour}`} style={{ left: x(a) + PX / 2 - 7 }} />
                  {b > a && <span className={`absolute top-1/2 size-3.5 -translate-y-1/2 rotate-45 ${colour}`} style={{ left: x(b) + PX / 2 - 7, borderRadius: 2 }} />}
                  <span className="absolute top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap text-[11px] text-ink-2" style={{ left: x(Math.max(a, b)) + PX / 2 + 10 }}>{o.status} · {o.meta}</span>
                </>
              );
              const cls = "relative block h-12";
              return <li key={o.key}>{o.href ? <Link href={o.href} className={cls} title={`${o.id}: ${o.meta}`}>{bar}</Link> : <div className={cls} title={`${o.id}: ${o.meta}`}>{bar}</div>}</li>;
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
