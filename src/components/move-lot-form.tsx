"use client";

import { useState } from "react";

export type MoveTarget = { code: string; rack: string; note: string };

/** Qty + destination for moving all or part of one lot out of a bin. `max` is what the source bin can give up. */
export function MoveLotForm({
  action, lotNumber, fromCode, back, max, uom, targets,
}: {
  action: (formData: FormData) => void | Promise<void>;
  lotNumber: string; fromCode: string; back: string; max: number; uom: string; targets: MoveTarget[];
}) {
  const [qty, setQty] = useState(String(max));
  const n = Number(qty);
  const bad = !(n > 0) || n > max;
  const racks = [...new Set(targets.map((t) => t.rack))];
  const quick = "min-h-9 cursor-pointer rounded-lg border border-shell-line px-3 text-xs font-semibold text-on-shell";
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="lotNumber" value={lotNumber} />
      <input type="hidden" name="fromCode" value={fromCode} />
      <input type="hidden" name="back" value={back} />
      <div className="flex items-end gap-2">
        <label className="flex-1 text-xs text-on-shell-2">Quantity to move ({uom})
          <input
            name="qty" type="number" inputMode="decimal" step="any" min="0" max={max} required value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-shell-line bg-shell px-3 font-mono text-base text-white"
          />
        </label>
        <button type="button" className={quick} onClick={() => setQty(String(max))}>All</button>
        <button type="button" className={quick} onClick={() => setQty(String(Math.round((max / 2) * 1000) / 1000))}>Half</button>
      </div>
      <label className="block text-xs text-on-shell-2">Move to
        <select name="toCode" required defaultValue="" className="mt-1 min-h-11 w-full rounded-lg border border-shell-line bg-shell px-3 font-mono text-sm text-white">
          <option value="" disabled>Choose a bin…</option>
          {racks.map((r) => (
            <optgroup key={r} label={`Rack ${r}`}>
              {targets.filter((t) => t.rack === r).map((t) => <option key={t.code} value={t.code}>{t.code} · {t.note}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {n > max && <p className="text-xs text-[#F4A29A]">Only {max.toLocaleString("en-US")} {uom} can be moved from this bin.</p>}
      <button disabled={bad} className="min-h-11 w-full cursor-pointer rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        Move {bad ? "" : `${n.toLocaleString("en-US")} ${uom}`}
      </button>
    </form>
  );
}
