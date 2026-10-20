"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanInput } from "@/components/scan-input";
import { cacheGet, cachePut, enqueue, newUuid } from "@/lib/offline-queue";
import { QueueBar, useQueue } from "@/lib/use-queue";

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
      {note && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
      <label className="block text-sm font-medium">Dispatch
        <select value={id} onChange={(e) => { setId(e.target.value); setTally([]); }} className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-3 text-base">
          <option value="">Select…</option>
          {list.map((d) => <option key={d.id} value={d.id}>{d.dcNumber} · {d.customer} · {d.vehicle}</option>)}
        </select>
      </label>
      {dispatch && (
        <>
          <ul className="rounded bg-slate-100 px-3 py-2 text-sm">
            {dispatch.lines.map((l) => <li key={l.code}>{l.code}: {l.scanned.toLocaleString()} of {l.ordered.toLocaleString()} loaded</li>)}
          </ul>
          <ScanInput label="Scan box label (press Enter after each box)" value={scan} onChange={setScan} onScan={submit} autoFocus />
          {tally.length > 0 && <p className="text-sm text-slate-700">Scanned on this device: {tally.join(", ")}</p>}
          <p className="text-xs text-slate-500">Finish and post the dispatch from the desktop; it needs the full pick list scanned.</p>
        </>
      )}
    </div>
  );
}
