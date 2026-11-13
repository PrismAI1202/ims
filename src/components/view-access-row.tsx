"use client";

import { useState } from "react";

/**
 * A screen in the role editor that is granted as a ladder: the checkbox gives the screen, and a toggle picks how far
 * the role may go on it (for Stores: View, Move stock, Edit layout). The toggle is greyed out until the screen is ticked.
 */
export function ViewAccessRow({ viewKey, name, note, levels, defaultOn, defaultLevel }: {
  viewKey: string; name: string; note?: string; levels: string[]; defaultOn: boolean; defaultLevel: number;
}) {
  const [on, setOn] = useState(defaultOn);
  const [level, setLevel] = useState(defaultLevel);
  return (
    <div>
      <label className="flex min-h-10 items-center gap-2.5 text-sm">
        <input type="checkbox" name="views" value={viewKey} checked={on} onChange={(e) => setOn(e.target.checked)} className="size-5 flex-none accent-[#c2410c]" />
        <span>
          <span className="font-semibold">{name}</span>
          {note && <span className="block text-xs text-ink-3">{note}</span>}
        </span>
      </label>
      <fieldset disabled={!on} className={`ml-7 mt-1 transition-opacity ${on ? "" : "opacity-45"}`}>
        <legend className="sr-only">{name} access level</legend>
        <div className="inline-grid gap-1 rounded-xl bg-canvas p-1" style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}>
          {levels.map((label, i) => (
            <label key={label} className={`relative flex min-h-9 items-center justify-center rounded-[9px] px-3 text-[13px] font-semibold ${on ? "cursor-pointer" : "cursor-not-allowed"} ${level === i ? "bg-ink text-white" : "text-ink-2"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent`}>
              <input type="radio" name={`level_${viewKey}`} value={i} checked={level === i} onChange={() => setLevel(i)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        {!on && <p className="mt-1 text-xs text-ink-3">Tick {name} to choose how far this role can go.</p>}
      </fieldset>
    </div>
  );
}
