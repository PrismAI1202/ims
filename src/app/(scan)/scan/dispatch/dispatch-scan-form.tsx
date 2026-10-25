"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanInput } from "@/components/scan-input";
import { cacheGet, cachePut, enqueue, newUuid } from "@/lib/offline-queue";
import { QueueBar, useQueue } from "@/lib/use-queue";
import { ProgressBar } from "@/components/ui";

type Open = { id: string; dcNumber: string; customer: string; vehicle: string; lines: { code: string; ordered: number; scanned: number }[] };

// Scans are saved on the device first and checked by the server when they sync. A rejected box (wrong customer,
// not on the pick list, already loaded elsewhere…) shows up in the red list with the reason, so nothing is lost silently.
export function DispatchScanForm() {
  const queue = useQueue();
  const [list, setList] = useState<Open[]>([]);
  const [note, setNote] = useState("");
  const [id, setId] = useState("");
  const [scan, setScan] = useState("");
  const [tally, setTally] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/open-dispatches");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { dispatches: Open[] };
      await cachePut("open-dispatches", data.dispatches);
      setList(data.dispatches);
      setNote("");
    } catch {
      const cached = await cacheGet<Open[]>("open-dispatches");
      if (cached) { setList(cached.data); setNote(`Offline: showing dispatches saved at ${new Date(cached.savedAt).toLocaleTimeString()}.`); }
      else setNote("Offline and nothing saved yet. Open this screen once while online.");
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, queue.lastSync]);

  const dispatch = list.find((d) => d.id === id);

  async function submit(text: string) {
    const value = text.trim();
    if (!dispatch || !value) return;
    await enqueue({ type: "DISPATCH_SCAN", clientUuid: newUuid(), dispatchId: dispatch.id, dcNumber: dispatch.dcNumber, scan: value });
    setTally((t) => [value.split("|").pop() ?? value, ...t].slice(0, 8));
    setScan("");
    void queue.sync();
  }

  return (
    <div className="space-y-4">
      <QueueBar queue={queue} />
      {note && <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-ink">{note}</p>}
      <label className="block text-[13px] font-semibold">Dispatch
        <select value={id} onChange={(e) => { setId(e.target.value); setTally([]); }} className="mt-1 min-h-13 w-full rounded-xl border border-border bg-white px-3.5 text-base">
          <option value="">Select…</option>
          {list.map((d) => <option key={d.id} value={d.id}>{d.dcNumber} · {d.customer} · {d.vehicle}</option>)}
        </select>
      </label>
      {dispatch && (
        <>
          <div className="space-y-3 rounded-[14px] bg-white p-3.5">
            <div className="flex items-baseline justify-between"><span className="font-display text-base font-bold">Pick-list scan</span>
              <span className="font-mono text-[15px]">{dispatch.lines.reduce((a, l) => a + Math.min(l.scanned, l.ordered), 0).toLocaleString()} / {dispatch.lines.reduce((a, l) => a + l.ordered, 0).toLocaleString()}</span></div>
            {dispatch.lines.map((l) => (
              <div key={l.code} className="space-y-1">
                <div className="flex justify-between text-[13px]"><strong>{l.code}</strong><span className="font-mono text-xs">{l.scanned.toLocaleString()} of {l.ordered.toLocaleString()} loaded</span></div>
                <ProgressBar value={Math.min(l.scanned, l.ordered)} max={l.ordered} color={l.scanned >= l.ordered ? "#1E7A46" : "#1D4ED8"} />
              </div>
            ))}
          </div>
          <ScanInput label="Scan box label (press Enter after each box)" value={scan} onChange={setScan} onScan={submit} autoFocus />
          {tally.length > 0 && <p className="text-sm text-ink-2">Scanned on this device: {tally.join(", ")}</p>}
          <p className="text-xs text-ink-3">Finish and post the dispatch from the desktop; it needs the full pick list scanned.</p>
        </>
      )}
    </div>
  );
}
