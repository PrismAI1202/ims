"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Camera, Eye, X } from "lucide-react";
import { Badge, Card, Chip, Mono, PageHeader } from "@/components/ui";
import { PENDING_STATUSES, PROCESS_VERSION, processStages, type ProcessEntry } from "@/lib/demo/process";

const OWNER_OF_ROLE: Record<string, string> = {
  STORE_INCHARGE: "Store Incharge", QA_INSPECTOR: "QA Inspector", PRODUCTION_LEAD: "Production Lead",
  DISPATCH_OFFICER: "Dispatch Officer", ADMIN: "Admin",
};

export function ProcessView({ role }: { role: string }) {
  const [seg, setSeg] = useState<"auto" | "non">("auto");
  const [open, setOpen] = useState(-1);
  const [entry, setEntry] = useState(0);
  const [photo, setPhoto] = useState<{ name: string; e: ProcessEntry } | null>(null);

  const me = OWNER_OF_ROLE[role] ?? "Store Incharge";
  const stages = processStages(seg);
  const v = PROCESS_VERSION[seg];
  const openOf = (i: number) => stages[i].entries.filter((e) => PENDING_STATUSES.includes(e.status)).length;
  const mine = (i: number) => stages[i].owners.includes(me);
  const myOpen = stages.reduce((a, _, i) => a + (mine(i) ? openOf(i) : 0), 0);
  const mySteps = stages.filter((_, i) => mine(i) && openOf(i) > 0).length;
  const allOpen = stages.reduce((a, _, i) => a + openOf(i), 0);

  if (open >= 0 && open < stages.length) {
    const st = stages[open];
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={`STEP ${open + 1} OF ${stages.length}`} title={st.name} subtitle={`Owner: ${st.role} · ${st.rule}`}>
          <button onClick={() => setOpen(-1)} className="flex min-h-9 cursor-pointer items-center gap-1 text-sm font-semibold text-on-shell">
            <ChevronLeft size={16} aria-hidden /> Process
          </button>
        </PageHeader>
        <Card className="space-y-3">
          <span className="font-mono text-[11px] tracking-[0.06em] text-ink-3">WHAT HAPPENS HERE</span>
          <p className="text-[15px] leading-relaxed">{st.desc}</p>
          <div className="space-y-1.5">
            <span className="font-mono text-[11px] tracking-[0.06em] text-ink-3">REQUIRED PHOTO PROOFS</span>
            {st.proofs.length ? (
              <div className="flex flex-wrap gap-1.5">
                {st.proofs.map((p) => <span key={p} className="flex items-center gap-1 rounded-lg bg-info-bg px-2.5 py-1 text-xs font-semibold text-info-ink"><Camera size={13} aria-hidden />{p}</span>)}
              </div>
            ) : <span className="text-sm text-ink-3">None — scan or data entry only</span>}
          </div>
          {st.link && (
            <Link href={st.link} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-accent text-sm font-semibold text-white">
              Open {st.linkLabel} <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </Card>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[15px] font-bold text-ink-3">Today&apos;s entries</h2>
          <span className="text-xs text-ink-3">{st.entries.length} entr{st.entries.length === 1 ? "y" : "ies"}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {st.entries.map((e, j) => {
            const pending = PENDING_STATUSES.includes(e.status);
            const act = pending && st.owners.includes(me);
            const isOpen = entry === j;
            return (
              <article key={e.id} className="overflow-hidden rounded-[14px] bg-white">
                <button onClick={() => setEntry(isOpen ? -1 : j)} aria-expanded={isOpen} className="flex min-h-16 w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left">
                  <span className="flex size-8 flex-none items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: e.avBg }}>{e.init}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Mono className="text-[13px]">{e.id}</Mono>
                    <span className="text-xs text-ink-3">{e.by} · {e.time}</span>
                  </span>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${act ? "bg-accent text-white" : pending ? "bg-warn-bg text-warn-ink" : "bg-ok-bg text-ok-ink"}`}>
                    {act ? `${e.status} · you` : e.status}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-2.5 border-t border-line px-3.5 py-3">
                    <dl className="grid gap-1.5 text-[13px]">
                      {e.fields.map(([k, val]) => (
                        <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="text-right font-semibold">{val}</dd></div>
                      ))}
                    </dl>
                    {e.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {e.photos.map((ph) => (
                          <button key={ph} onClick={() => setPhoto({ name: ph, e })} aria-label={`View photo: ${ph}`}
                            className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[10px] border border-border bg-canvas px-3 text-xs font-semibold">
                            <Eye size={14} aria-hidden />{ph}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {photo && <PhotoDialog photo={photo} onClose={() => setPhoto(null)} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`${seg === "auto" ? "AUTO" : "NON-AUTO"} · v${v.ver} · BY ${v.by}`} title="Factory process">
        <div role="group" aria-label="Customer segment" className="grid grid-cols-2 gap-1 rounded-xl bg-shell-2 p-1">
          {(["auto", "non"] as const).map((k) => (
            <button key={k} onClick={() => { setSeg(k); setOpen(-1); }} aria-pressed={seg === k}
              className={`min-h-10 cursor-pointer rounded-[9px] text-[13px] font-semibold ${seg === k ? "bg-on-shell text-ink" : "text-[#d5d7db]"}`}>
              {k === "auto" ? "Automotive" : "Non-automotive"}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-info-bg px-3.5 py-2.5 text-[13px] text-info-ink">
        <Badge tone="info">Sample data</Badge>
        View only. Set up by the Store Incharge; editing and publishing process versions is not available yet.
      </div>

      <div className="flex items-baseline gap-2.5 rounded-[14px] bg-white px-4 py-3">
        <span className={`font-display text-3xl font-extrabold ${myOpen ? "text-accent" : "text-ok"}`}>{myOpen}</span>
        <span className="text-[13px] text-ink-2">
          {myOpen
            ? `open items need you (${me}) across ${mySteps} step${mySteps === 1 ? "" : "s"} · ${allOpen} open in the plant`
            : `Nothing waiting on you · ${allOpen} open across other roles`}
        </span>
      </div>

      <ol className="grid gap-x-3 md:grid-cols-2">
        {stages.map((s, i) => {
          const pend = openOf(i);
          const isMine = mine(i) && pend > 0;
          return (
            <li key={s.key + i} className="flex gap-3">
              <div className="flex w-8 flex-none flex-col items-center">
                <span className="flex size-8 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: s.color }}>{i + 1}</span>
                <span className="w-0.5 flex-1" style={{ background: i === stages.length - 1 ? "transparent" : "#C9C5BC" }} />
              </div>
              <button onClick={() => { setOpen(i); setEntry(0); }}
                className={`mb-3 flex min-h-20 flex-1 cursor-pointer items-center gap-2 rounded-[14px] border-2 p-3 text-left ${isMine ? "border-[#F2B48C] bg-[#FFF6F0]" : "border-white bg-white"}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-display text-[15px] font-bold">{s.name}</span>
                  <span className="text-xs text-ink-3">{s.role} · {s.rule}</span>
                  <span className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    <span className="flex items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5 text-ink-2"><Camera size={11} aria-hidden />{s.proofs.length ? `${s.proofs.length} photo${s.proofs.length > 1 ? "s" : ""}` : "no photos"}</span>
                    <span className="rounded-md bg-canvas px-1.5 py-0.5 text-ink-2">{s.entries.length} today</span>
                    {pend > 0 && !isMine && <span className="rounded-md bg-warn-bg px-1.5 py-0.5 text-warn-ink">{pend} open</span>}
                    {isMine && <span className="rounded-md bg-accent px-1.5 py-0.5 text-white">{pend} need{pend === 1 ? "s" : ""} you</span>}
                  </span>
                </span>
                <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-xs text-ink-3"><Chip>DEMO</Chip> entries are examples from the design; live data will appear here once process steps are wired up.</p>
    </div>
  );
}

function PhotoDialog({ photo, onClose }: { photo: { name: string; e: ProcessEntry }; onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Photo proof" className="fixed inset-0 z-30 flex flex-col gap-3 overflow-auto bg-shell/95 p-5 text-on-shell md:m-auto md:max-h-[34rem] md:max-w-md md:rounded-2xl">
      <div className="flex items-center justify-between">
        <span className="font-display text-base font-bold">{photo.name}</span>
        <button onClick={onClose} aria-label="Close photo" className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-shell-2"><X size={18} aria-hidden /></button>
      </div>
      <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-shell-line bg-shell-2 text-sm text-on-shell-2">[Captured photo]</div>
      <dl className="grid gap-1.5 text-[13px]">
        <div className="flex justify-between"><dt className="text-on-shell-2">Entry</dt><dd className="font-mono">{photo.e.id}</dd></div>
        <div className="flex justify-between"><dt className="text-on-shell-2">Captured by</dt><dd>{photo.e.by}</dd></div>
        <div className="flex justify-between"><dt className="text-on-shell-2">Time · location</dt><dd>{photo.e.time} · GPS in plant fence</dd></div>
        <div className="flex justify-between"><dt className="text-on-shell-2">Integrity</dt><dd>SHA-256 verified</dd></div>
      </dl>
    </div>
  );
}
