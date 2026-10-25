"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, FileText } from "lucide-react";
import { Badge, Card, Mono, PageHeader } from "@/components/ui";
import { EQ_COLORS, EQ_GROUPS, type EqGroup } from "@/lib/demo/equivalents";

const fmt = (n: number) => n.toLocaleString("en-US");

function GroupBar({ g }: { g: EqGroup }) {
  const tot = Math.max(g.qty, 1);
  return (
    <span aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-md bg-canvas">
      {g.grades.map((x, j) => <span key={x.grade} style={{ width: `${(x.stock / tot) * 100}%`, background: EQ_COLORS[j % 3] }} />)}
    </span>
  );
}

export function EquivalentsView() {
  const [open, setOpen] = useState<number | null>(null);

  if (open !== null) {
    const g = EQ_GROUPS[open];
    const low = g.qty < g.min;
    const warn = g.warn ?? (g.grades.length < 2 ? "Single-source group — consider approving an alternate grade." : "");
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={g.code} title={g.name}>
          <div className="space-y-2.5">
            <button onClick={() => setOpen(null)} className="flex min-h-9 cursor-pointer items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> All groups</button>
            <div className="flex flex-wrap gap-1.5">{g.spec.map((sp) => <span key={sp} className="rounded-md bg-shell-2 px-2 py-1 font-mono text-[11px]">{sp}</span>)}</div>
          </div>
        </PageHeader>
        <Card className="space-y-2">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-ink-3">Group stock (all grades)</span>
            <Mono className={low ? "text-danger" : ""}>{fmt(g.qty)} / min {fmt(g.min)} {g.unit}</Mono>
          </div>
          <GroupBar g={g} />
          <span className="text-xs text-ink-3">Used in {g.used.join(", ")}. Automotive parts draw only from auto-approved grades.</span>
        </Card>
        {warn && <div className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-ink">{warn}</div>}
        <h2 className="font-display text-[15px] font-bold text-ink-3">Approved grades · priority order</h2>
        <div className="grid gap-2.5 md:grid-cols-2">
          {g.grades.map((x, j) => (
            <article key={x.grade} className={`space-y-2.5 rounded-[14px] border-2 bg-white p-3.5 ${j === 0 ? "border-ok" : "border-white"}`}>
              <div className="flex items-center gap-2.5">
                <span className={`flex size-7 flex-none items-center justify-center rounded-full text-xs font-bold ${j === 0 ? "bg-ok text-white" : "bg-canvas"}`}>{j + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col"><span className="font-semibold">{x.grade}</span><span className="text-xs text-ink-3">{x.vendor}</span></span>
                <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${x.auto ? "bg-[#EEF3FD] text-[#1A3D8F]" : "bg-warn-bg text-warn-ink"}`}>
                  {x.auto ? "Auto + Non-auto" : x.evidence.startsWith("PPAP pending") ? "PPAP pending" : "Non-auto only"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
                <span className="flex flex-col"><strong className="font-mono text-[13px] font-medium text-ink">{fmt(x.stock)} {g.unit}</strong>In stock</span>
                <span className="flex flex-col"><strong className="font-mono text-[13px] font-medium text-ink">{x.lead}</strong>Lead time</span>
                <span className="flex flex-col"><strong className="font-mono text-[13px] font-medium text-ink">[₹/{g.unit}]</strong>Price</span>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-ink-2"><FileText size={13} aria-hidden />{x.evidence}</span>
            </article>
          ))}
        </div>
        <p className="text-center text-xs text-ink-3">Snap datasheet → check spec window → attach trial report → QA approves. <Badge tone="info">Sample data</Badge></p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="BOMs · EQUIVALENT GROUPS" title="Equivalent groups" subtitle="One spec, many vendor grades. BOMs, MRP and stock use the group.">
        <Link href="/bom" className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> BOMs</Link>
      </PageHeader>
      <div className="flex items-center gap-2 text-[13px] text-ink-3"><Badge tone="info">Sample data</Badge>Equivalent grades aren&apos;t stored yet. Adding groups and grades will arrive with that feature.</div>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {EQ_GROUPS.map((g, i) => {
          const low = g.qty < g.min;
          const warn = g.warn ?? (g.grades.length < 2 ? "Single-source group — consider approving an alternate grade." : "");
          return (
            <button key={g.code} onClick={() => setOpen(i)} className="flex cursor-pointer flex-col gap-2 rounded-[14px] bg-white p-3.5 text-left">
              <span className="flex items-start justify-between gap-2">
                <span className="flex flex-col"><span className="font-semibold">{g.name}</span>
                  <span className="text-xs text-ink-3"><Mono>{g.code}</Mono> · {g.grades.length} grade{g.grades.length > 1 ? "s" : ""} · used in {g.used.join(", ")}</span></span>
                <span className={`flex-none rounded-md px-2 py-1 text-[11px] font-bold ${low ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok-ink"}`}>{low ? "Below min" : "In stock"}</span>
              </span>
              <GroupBar g={g} />
              {warn && <span className="rounded-lg bg-warn-bg px-2.5 py-1.5 text-xs text-warn-ink">{warn}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
