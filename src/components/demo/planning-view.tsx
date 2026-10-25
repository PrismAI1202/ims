"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Card, Mono, PageHeader } from "@/components/ui";
import { PLAN_DAYS, PLAN_JOBS, PLAN_KINDS as K, PLAN_MACHINES, PLAN_SCHEDULE } from "@/lib/demo/planning";

export function PlanningView() {
  const [sched, setSched] = useState<Record<string, string>>(PLAN_SCHEDULE);
  const [jobs, setJobs] = useState(PLAN_JOBS);
  const [sel, setSel] = useState<number | null>(null);
  const [cell, setCell] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "warn" | "bad" } | null>(null);

  function place(m: string, ton: number, d: number) {
    const key = `${m}-${d}`;
    if (sched[key]) { setCell(key); setMsg(null); return; }
    if (sel === null) { setCell(null); setMsg({ t: "Pick a job above first, then tap a free slot.", tone: "warn" }); return; }
    const j = jobs[sel];
    if (j.left <= 0) return;
    if (ton < j.ton) { setMsg({ t: `${m} is ${ton} T — ${K[j.k].mould} needs at least ${j.ton} T.`, tone: "bad" }); return; }
    const prev = sched[`${m}-${d - 1}`];
    const warn = prev && prev !== j.k && K[prev].colour !== "—" && K[prev].colour !== K[j.k].colour;
    setSched({ ...sched, [key]: j.k });
    const nj = jobs.map((x, i) => (i === sel ? { ...x, left: x.left - 1 } : x));
    setJobs(nj);
    setCell(key);
    if (nj[sel].left === 0) setSel(null);
    setMsg({ t: `${K[j.k].mould} on ${m}, ${PLAN_DAYS[d]}${warn ? ` · colour change ${K[prev].colour} → ${K[j.k].colour}: allow ~15 min purge` : " · mould change booked"}`, tone: warn ? "warn" : "ok" });
  }

  const detKind = cell && sched[cell] ? K[sched[cell]] : null;
  const parts = cell?.split("-");

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="PLANNING · WEEK 43" title="Mould × machine plan" subtitle={sel !== null ? `Placing ${K[jobs[sel].k].part} — tap a free slot` : "Today is Tue 20 · 6 machines"} />
      <div className="flex items-center gap-2 text-[13px] text-ink-3"><Badge tone="info">Sample data</Badge>Planning here is for demonstration; placements are not saved.</div>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="space-y-2 self-start">
          <span className="font-mono text-[11px] tracking-[0.06em] text-ink-3">TO SCHEDULE · tap one, then tap a free slot</span>
          {jobs.map((j, i) => {
            const k = K[j.k];
            return (
              <button key={j.k} onClick={() => j.left && setSel(sel === i ? null : i)} aria-pressed={sel === i}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-2 p-2.5 text-left ${sel === i ? "border-accent" : "border-line"} ${j.left ? "" : "opacity-55"}`}>
                <span className="h-9 w-1.5 flex-none rounded-sm" style={{ background: k.bg }} />
                <span className="flex min-w-0 flex-1 flex-col"><span className="text-sm font-semibold">{k.part} · {k.mould}</span><span className="text-xs text-ink-3">{k.order} · needs ≥ {j.ton} T · {j.qty}</span></span>
                <span className={`text-[11px] font-bold ${j.left ? "text-warn-ink" : "text-ok"}`}>{j.left ? `${j.left} day${j.left > 1 ? "s" : ""} left` : "Planned"}</span>
              </button>
            );
          })}
          {msg && <div role="status" className={`rounded-lg px-3 py-2 text-[13px] font-semibold ${msg.tone === "bad" ? "bg-danger-bg text-danger" : msg.tone === "warn" ? "bg-warn-bg text-[#6B3200]" : "bg-ok-bg text-ok-ink"}`}>{msg.t}</div>}
        </Card>
        <div className="space-y-3">
          <Card className="overflow-x-auto">
            <div className="grid min-w-[22rem] grid-cols-[3.5rem_repeat(6,1fr)] gap-1">
              <span />
              {PLAN_DAYS.map((d, i) => <span key={d} className={`rounded-md py-1 text-center text-[10px] font-semibold ${i === 1 ? "bg-ink text-white" : "text-ink-3"}`}>{d}</span>)}
              {PLAN_MACHINES.map(([m, ton]) => (
                <div key={m} className="contents">
                  <span className="flex flex-col justify-center text-[11px]"><strong className="font-mono">{m}</strong><span className="text-ink-3">{ton} T</span></span>
                  {PLAN_DAYS.map((_, d) => {
                    const v = sched[`${m}-${d}`]; const k = v ? K[v] : null;
                    return (
                      <button key={d} onClick={() => place(m, ton, d)} aria-label={`${m} ${PLAN_DAYS[d]}${k ? `: ${k.part} ${k.mould}` : ": free"}`}
                        className={`flex h-12 cursor-pointer flex-col items-center justify-center whitespace-pre-line rounded-md text-center font-mono text-[9px] leading-tight ${cell === `${m}-${d}` ? "outline-[3px] outline-accent" : ""} ${k ? "" : sel !== null ? "border-[1.5px] border-dashed border-accent bg-[#f4f3ef]" : "border border-dashed border-[#C9C5BC] bg-[#f4f3ef]"}`}
                        style={k ? { background: k.bg, color: k.fg } : undefined}>{k ? `${k.part}\n${k.mould}` : ""}</button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
          {detKind && parts && (
            <Card className="space-y-1">
              <span className="font-mono text-[11px] text-ink-3">{parts[0]}-{parts[1]} · {PLAN_DAYS[Number(parts[2])]}</span>
              <span className="block font-display text-base font-bold">{detKind.part} · {detKind.mould}</span>
              <span className="block text-[13px] text-ink-3">{detKind.order} · colour {detKind.colour}</span>
              {["DT-220", "HX-14", "BZ-31", "CP-08", "HS-40"].includes(detKind.part) && <Link href="/bom" className="inline-block pt-1 text-[13px] font-semibold text-accent">View BOM · {detKind.part}</Link>}
              {sched[cell!] !== "pm" && (
                <button onClick={() => {
                  const v = sched[cell!]; const ns = { ...sched }; delete ns[cell!]; setSched(ns);
                  setJobs(jobs.map((j) => (j.k === v ? { ...j, left: j.left + 1 } : j))); setCell(null); setMsg({ t: "Slot freed", tone: "ok" });
                }} className="mt-1 block min-h-10 cursor-pointer text-[13px] font-semibold text-danger">Unschedule this day</button>
              )}
            </Card>
          )}
          <p className="text-xs text-ink-3">Mould PM blocks come from the tool room (<Mono>PM</Mono> cells). <Link href="/maintenance" className="font-semibold text-accent">Maintenance</Link></p>
        </div>
      </div>
    </div>
  );
}
