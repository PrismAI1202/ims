"use client";

import { useState } from "react";
import { CloudOff, RefreshCw, Check } from "lucide-react";
import { Card, Eyebrow, PageHeader } from "@/components/ui";
import { discard, type QueueEntry } from "@/lib/offline-queue";
import { useQueue } from "@/lib/use-queue";

function describe(e: QueueEntry): { kind: string; title: string; sub: string } {
  const op = e.op;
  if (op.type === "DISPATCH_SCAN") return { kind: "DISPATCH", title: `Load box onto ${op.dcNumber}`, sub: op.scan.split("|").pop() ?? op.scan };
  if (op.type === "ISSUE") return { kind: "ISSUE", title: `Issue ${op.lotNumber} · ${op.qty}`, sub: `From bin ${op.locationCode}${op.fifoOverrideReason ? " · FIFO override" : ""}` };
  return { kind: "TRANSFER", title: `Move ${op.lotNumber} · ${op.qty}`, sub: `${op.fromCode} → ${op.toCode}` };
}

export function SyncView({ device }: { device: string }) {
  const queue = useQueue();
  const [busy, setBusy] = useState(false);
  const pending = queue.entries.filter((e) => !e.error);
  const rejected = queue.entries.filter((e) => e.error);

  const phase = busy ? "syncing" : !queue.online ? "offline" : pending.length > 0 ? "waiting" : "done";
  const meta = {
    offline: { title: "Offline", sub: `No network · ${pending.length} item${pending.length === 1 ? "" : "s"} waiting`, bg: "#9A3412", Icon: CloudOff },
    syncing: { title: "Syncing…", sub: "Sending queued items", bg: "#1D4ED8", Icon: RefreshCw },
    waiting: { title: "Waiting to sync", sub: `${pending.length} item${pending.length === 1 ? "" : "s"} queued on this device`, bg: "#9A3412", Icon: RefreshCw },
    done: { title: "All synced", sub: queue.lastSync ? `Last sync: ${queue.lastSync}` : "Nothing waiting on this device", bg: "#1E7A46", Icon: Check },
  }[phase];

  async function run() {
    setBusy(true);
    try { await queue.sync(); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`SYNC CENTRE · ${device}`} title="Sync centre">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 flex-none items-center justify-center rounded-full text-white" style={{ background: meta.bg }}><meta.Icon size={20} aria-hidden /></span>
            <span className="flex flex-col"><span className="font-display text-lg font-bold">{meta.title}</span><span className="text-[13px] text-on-shell-2">{meta.sub}</span></span>
          </div>
          <button onClick={run} disabled={busy || !queue.online} className="min-h-12 w-full cursor-pointer rounded-xl bg-accent text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Syncing…" : phase === "done" ? "Sync again" : "Sync now"}
          </button>
        </div>
      </PageHeader>

      <Card className="space-y-2">
        <div className="flex items-baseline justify-between"><h2 className="font-display text-base font-bold">Outbox</h2><span className="text-xs text-ink-3">Stored on this device until confirmed</span></div>
        {queue.entries.length === 0 && <p className="py-3 text-sm text-ink-3">Nothing queued. Scans made offline in the Scanner appear here.</p>}
        {queue.entries.map((e) => {
          const d = describe(e);
          return (
            <div key={e.op.clientUuid} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
              <span className="w-[4.5rem] flex-none rounded-md bg-canvas px-1.5 py-1 text-center font-mono text-[10px] font-semibold">{d.kind}</span>
              <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm font-semibold">{d.title}</span><span className="truncate text-xs text-ink-3">{e.error ?? d.sub}</span></span>
              {e.error ? (
                <button onClick={async () => { await discard(e.op.clientUuid); await queue.refresh(); }} className="min-h-9 cursor-pointer rounded-lg bg-danger-bg px-3 text-xs font-bold text-danger">Discard</button>
              ) : <span className="text-[11px] font-bold text-warn-ink">{busy ? "Uploading" : "Queued"}</span>}
            </div>
          );
        })}
      </Card>

      {rejected.length > 0 && (
        <div className="rounded-xl bg-danger-bg px-3.5 py-3 text-[13px] text-danger">
          <strong>{rejected.length} item{rejected.length === 1 ? "" : "s"} rejected by the server.</strong> Check the reason above, then discard and re-enter if needed.
        </div>
      )}
      <Eyebrow>HOW IT WORKS</Eyebrow>
      <p className="text-sm text-ink-2">Scans are saved on this device and sent automatically every 15 seconds while online. Anything the server rejects stays here with its reason until you discard it.</p>
    </div>
  );
}
