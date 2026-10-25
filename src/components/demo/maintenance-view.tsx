"use client";

import { useState } from "react";
import { Camera, Check, ChevronLeft } from "lucide-react";
import { Badge, Card, Mono, PageHeader } from "@/components/ui";
import { MACHINES, MOULD_LIFE, MOULDS, PM_CHECKS, PM_INTERVAL, type MouldRow } from "@/lib/demo/maintenance";

const fmt = (n: number) => Math.abs(n).toLocaleString("en-US");

function view(m: MouldRow) {
  const left = m.last + PM_INTERVAL - m.shots;
  const st = left <= 0 ? { t: "Overdue", cls: "bg-danger-bg text-danger", color: "#B42318" }
    : left < 15000 ? { t: "PM due soon", cls: "bg-warn-bg text-warn-ink", color: "#E0A526" }
    : { t: "OK", cls: "bg-ok-bg text-ok-ink", color: "#1E7A46" };
  return { ...st, pmTxt: left <= 0 ? `${fmt(left)} over` : `${fmt(left)} shots`, pmW: Math.max(2, Math.min(100, ((m.shots - m.last) / PM_INTERVAL) * 100)), life: `${((m.shots / MOULD_LIFE) * 100).toFixed(0)}%` };
}

export function MaintenanceView() {
  const [tab, setTab] = useState(0);
  const [moulds, setMoulds] = useState(MOULDS);
  const [open, setOpen] = useState<number | null>(null);
  const [checks, setChecks] = useState<boolean[]>(PM_CHECKS.map(() => false));
  const [photo, setPhoto] = useState(false);

  const m = open !== null ? moulds[open] : null;
  const v = m ? view(m) : null;
  const all = checks.every(Boolean);
  const can = all && photo;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="TOOL ROOM" title={m ? `${m.id} · mould` : "Maintenance"}>
        {m ? (
          <button onClick={() => setOpen(null)} className="flex min-h-9 cursor-pointer items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> All moulds</button>
        ) : (
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-shell-2 p-1">
            {["Moulds", "Machines"].map((l, i) => (
              <button key={l} role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={`min-h-10 cursor-pointer rounded-[9px] text-[13px] font-semibold ${tab === i ? "bg-on-shell text-ink" : "text-[#d5d7db]"}`}>{l}</button>
            ))}
          </div>
        )}
      </PageHeader>
      <div className="flex items-center gap-2 text-[13px] text-ink-3"><Badge tone="info">Sample data</Badge>Shot counters and PM records aren&apos;t captured yet; actions here are not saved.</div>

      {!m && tab === 0 && (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {moulds.map((x, i) => {
            const w = view(x);
            return (
              <button key={x.id} onClick={() => { setOpen(i); setChecks(PM_CHECKS.map(() => false)); setPhoto(false); }} className="flex cursor-pointer flex-col gap-2 rounded-[14px] bg-white p-3.5 text-left">
                <span className="flex items-start justify-between gap-2">
                  <span className="flex flex-col"><Mono className="text-sm font-semibold">{x.id}</Mono><span className="text-xs text-ink-3">{x.part} · on {x.machine}</span></span>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${w.cls}`}>{w.t}</span>
                </span>
                <span className="flex flex-col gap-1">
                  <span className="flex justify-between text-xs"><span className="text-ink-3">To next PM</span><Mono>{w.pmTxt}</Mono></span>
                  <span aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px]" style={{ width: `${w.pmW}%`, background: w.color }} /></span>
                </span>
                <span className="flex justify-between text-[11px] text-ink-3"><span>Life used {w.life}</span><span>{fmt(x.shots)} shots</span></span>
              </button>
            );
          })}
        </div>
      )}

      {!m && tab === 1 && (
        <div className="space-y-2">
          <p className="text-xs text-ink-3">Last 30 days · MTBF = run hours ÷ breakdowns · MTTR = repair minutes ÷ breakdowns</p>
          <Card className="space-y-2 p-0">
            <div className="grid grid-cols-[1fr_4rem_4.5rem_4.5rem] gap-2 px-3.5 pt-3 text-[11px] font-semibold text-ink-3"><span>Machine</span><span>MTBF</span><span>MTTR</span><span>Next PM</span></div>
            {MACHINES.map(([id, hrs, fails, rep, pm], i) => (
              <div key={id} className="grid grid-cols-[1fr_4rem_4.5rem_4.5rem] items-center gap-2 border-t border-line px-3.5 py-2.5 text-[13px]">
                <span className="flex flex-col"><strong className="font-mono">{id}</strong><span className="text-[11px] text-ink-3">{fails} breakdowns</span></span>
                <Mono>{fails ? Math.round(hrs / fails) : `${hrs}+`} h</Mono>
                <Mono className={fails && rep / fails > 60 ? "text-danger" : ""}>{fails ? `${Math.round(rep / fails)} min` : "—"}</Mono>
                <span className={i === 5 ? "font-semibold text-warn-ink" : "text-ink-2"}>{pm}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {m && v && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">{m.part} · {m.cav} cav</span><span className={`rounded-md px-2 py-1 text-[11px] font-bold ${v.cls}`}>{v.t}</span></div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{fmt(m.shots)}</strong>Shot counter</span>
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{fmt(m.last)}</strong>Last PM at</span>
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{v.pmTxt}</strong>To next PM</span>
            </div>
          </Card>
          <Card className="space-y-2">
            <span className="font-mono text-[11px] tracking-[0.06em] text-ink-3">PM checklist · every 50,000 shots</span>
            {PM_CHECKS.map((l, i) => (
              <button key={l} onClick={() => setChecks(checks.map((c, j) => (j === i ? !c : c)))} aria-pressed={checks[i]} className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 text-left text-sm">
                <span className={`flex size-6 flex-none items-center justify-center rounded-md border-2 ${checks[i] ? "border-ok bg-ok" : "border-[#9AA0A8] bg-white"}`}>{checks[i] && <Check size={14} color="#fff" aria-hidden />}</span>{l}
              </button>
            ))}
            <button onClick={() => setPhoto(true)} className={`flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold ${photo ? "bg-shell-2 text-on-shell" : "border-[1.5px] border-dashed border-[#E3A79F] bg-white text-danger"}`}>
              <Camera size={16} aria-hidden />{photo ? "After-PM photo captured" : "After-PM photo (required)"}
            </button>
            <button disabled={!can} onClick={() => {
              if (!can || open === null) return;
              const x = moulds[open];
              setMoulds(moulds.map((y, j) => (j === open ? { ...x, last: x.shots, hist: [["Today", "PM", `PM at ${x.shots.toLocaleString("en-US")} shots`, "All 5 checks · 1 photo"] as [string, string, string, string], ...x.hist] } : y)));
              setChecks(PM_CHECKS.map(() => false)); setPhoto(false);
            }} className={`min-h-12 w-full rounded-xl text-[15px] font-semibold ${can ? "cursor-pointer bg-ok text-white" : "bg-border text-ink-3"}`}>
              {can ? "Complete PM · reset counter" : all ? "Add the after-PM photo" : `${checks.filter(Boolean).length} of 5 checks done`}
            </button>
          </Card>
          <div className="space-y-2 lg:col-span-2">
            <h2 className="font-display text-[15px] font-bold text-ink-3">Repair &amp; PM history</h2>
            {m.hist.map((h, i) => (
              <div key={i} className="flex flex-col gap-0.5 rounded-xl bg-white px-3.5 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-xs text-ink-3"><span>{h[0]}</span><Badge tone={h[1] === "Repair" ? "warn" : h[1] === "PM" ? "ok" : "info"}>{h[1]}</Badge></span>
                <span className="font-semibold">{h[2]}</span><span className="text-xs text-ink-3">{h[3]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
