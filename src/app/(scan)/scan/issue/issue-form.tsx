"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanInput } from "@/components/scan-input";
import { cacheGet, cachePut, enqueue, newUuid } from "@/lib/offline-queue";
import { QueueBar, useQueue } from "@/lib/use-queue";

type Line = {
  requestLineId: string; requestNumber: string; itemCode: string; itemName: string; uom: string; remaining: number;
  lots: { lotNumber: string; available: number; locations: { code: string; qty: number }[] }[];
};

export function IssueForm() {
  const queue = useQueue();
  const [lines, setLines] = useState<Line[]>([]);
  const [stale, setStale] = useState("");
  const [lineId, setLineId] = useState("");
  const [lot, setLot] = useState("");
  const [bin, setBin] = useState("");
  const [qty, setQty] = useState("");
  const [override, setOverride] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/open-lines");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { lines: Line[] };
      await cachePut("open-lines", data.lines);
      setLines(data.lines);
      setStale("");
    } catch {
      const cached = await cacheGet<Line[]>("open-lines");
      if (cached) {
        setLines(cached.data);
        setStale(`Offline: showing requests saved at ${new Date(cached.savedAt).toLocaleTimeString()}.`);
      } else setStale("Offline and nothing saved yet — open this screen once while online.");
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, queue.lastSync]);

  const line = lines.find((l) => l.requestLineId === lineId);
  const next = line?.lots[0];

  function choose(id: string) {
    setLineId(id);
    const l = lines.find((x) => x.requestLineId === id);
    const first = l?.lots[0];
    setLot(first?.lotNumber ?? "");
    setBin(first?.locations[0]?.code ?? "");
    setQty(l ? String(Math.min(l.remaining, first?.available ?? l.remaining)) : "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!line || !lot.trim() || !bin.trim() || !(n > 0)) { setMsg("Choose a request, scan lot and bin, and enter a quantity."); return; }
    await enqueue({
      type: "ISSUE", clientUuid: newUuid(), requestLineId: line.requestLineId,
      lotNumber: lot.trim(), locationCode: bin.trim(), qty: n, fifoOverrideReason: override.trim() || undefined,
    });
    // Reflect it locally right away so the next scan sees the reduced remaining qty even offline.
    setLines((prev) => prev.map((l) => (l.requestLineId === line.requestLineId ? { ...l, remaining: l.remaining - n } : l)));
    setLot(""); setBin(""); setQty(""); setOverride("");
    setMsg("Saved. Sending…");
    await queue.sync();
    setMsg("Saved.");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <QueueBar queue={queue} />
      {stale && <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-ink">{stale}</p>}
      <label className="block text-sm font-medium">Material request
        <select value={lineId} onChange={(e) => choose(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-white px-3.5 py-3 min-h-13 text-base">
          <option value="">Select…</option>
          {lines.filter((l) => l.remaining > 0).map((l) => (
            <option key={l.requestLineId} value={l.requestLineId}>
              {l.requestNumber} · {l.itemCode} · {l.remaining} {l.uom} left
            </option>
          ))}
        </select>
      </label>
      {line && (
        <p className="rounded-xl bg-info-bg px-3 py-2 text-sm text-info-ink">
          {next ? <>Pick first: <b>{next.lotNumber}</b> from {next.locations.map((x) => `${x.code} (${x.qty})`).join(", ")}</> : "No approved stock for this item."}
        </p>
      )}
      <ScanInput label="Lot tag" value={lot} onChange={setLot} />
      <ScanInput label="Bin" value={bin} onChange={setBin} />
      <label className="block text-sm font-medium">Quantity{line && ` (${line.uom})`}
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal"
          className="mt-1 w-full rounded-xl border border-border bg-white px-3.5 py-3 min-h-13 text-base" />
      </label>
      <label className="block text-sm font-medium">FIFO override reason (only if skipping the lot above)
        <input value={override} onChange={(e) => setOverride(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-white px-3.5 py-3 min-h-13 text-base" />
      </label>
      {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
      <button className="w-full min-h-13 cursor-pointer rounded-xl bg-accent text-base font-semibold text-white hover:bg-accent-hover">Issue</button>
    </form>
  );
}
