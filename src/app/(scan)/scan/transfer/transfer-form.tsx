"use client";

import { useState } from "react";
import { ScanInput } from "@/components/scan-input";
import { enqueue, newUuid } from "@/lib/offline-queue";
import { QueueBar, useQueue } from "@/lib/use-queue";

export function TransferForm() {
  const queue = useQueue();
  const [lot, setLot] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!lot.trim() || !from.trim() || !to.trim() || !(n > 0)) { setMsg("Scan lot, both bins and enter a quantity."); return; }
    await enqueue({ type: "TRANSFER", clientUuid: newUuid(), lotNumber: lot.trim(), fromCode: from.trim(), toCode: to.trim(), qty: n });
    setLot(""); setFrom(""); setTo(""); setQty("");
    setMsg("Saved. Sending…");
    await queue.sync();
    setMsg("Saved.");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <QueueBar queue={queue} />
      <ScanInput label="Lot tag" value={lot} onChange={setLot} autoFocus />
      <ScanInput label="From bin" value={from} onChange={setFrom} />
      <ScanInput label="To bin" value={to} onChange={setTo} />
      <label className="block text-sm font-medium">Quantity
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal"
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-3 text-base" />
      </label>
      {msg && <p role="status" className="text-sm text-slate-700">{msg}</p>}
      <button className="w-full rounded bg-slate-900 py-3 text-base font-medium text-white">Move stock</button>
    </form>
  );
}
