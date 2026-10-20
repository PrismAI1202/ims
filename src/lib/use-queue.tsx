"use client";

import { useCallback, useEffect, useState } from "react";
import { discard, flushQueue, listQueue, type QueueEntry } from "./offline-queue";

export function useQueue() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<string>("");

  const refresh = useCallback(async () => setEntries(await listQueue()), []);

  const sync = useCallback(async () => {
    const r = await flushQueue();
    if (r.offline) setOnline(false);
    else {
      setOnline(true);
      if (r.sent || r.failed) setLastSync(`${r.sent} synced${r.failed ? `, ${r.failed} rejected` : ""}`);
    }
    await refresh();
    return r;
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);
    void sync();
    const onOnline = () => { setOnline(true); void sync(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = setInterval(() => void sync(), 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [sync]);

  return { entries, online, lastSync, refresh, sync };
}

function describe(op: QueueEntry["op"]): string {
  if (op.type === "DISPATCH_SCAN") return `Load ${op.scan.split("|").pop()} onto ${op.dcNumber}`;
  return `${op.type === "ISSUE" ? "Issue" : "Move"} ${op.lotNumber} ×${op.qty}`;
}

export function QueueBar({ queue }: { queue: ReturnType<typeof useQueue> }) {
  const pending = queue.entries.filter((e) => !e.error);
  const rejected = queue.entries.filter((e) => e.error);
  return (
    <div className="space-y-2 text-sm">
      <div className={`rounded px-3 py-2 ${queue.online ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
        {queue.online ? "Online" : "Offline — scans are saved on this device"} · {pending.length} waiting to sync
        {queue.lastSync && ` · last: ${queue.lastSync}`}
      </div>
      {rejected.map((e) => (
        <div key={e.op.clientUuid} className="flex items-start justify-between gap-2 rounded bg-red-50 px-3 py-2 text-red-800">
          <span>{describe(e.op)}: {e.error}</span>
          <button className="underline" onClick={async () => { await discard(e.op.clientUuid); await queue.refresh(); }}>Discard</button>
        </div>
      ))}
    </div>
  );
}
