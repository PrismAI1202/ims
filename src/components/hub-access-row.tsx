"use client";

import { useState } from "react";

export interface HubTabOption { tab: string; label: string; what: string; permission: string }

/**
 * A hub screen in the role editor (Quality). Ticking the hub gives the screen; each tab under it is its own permission, so a role
 * can hold just one part of the hub. A live line says which tabs the role will see, and warns when none would open.
 */
export function HubAccessRow({ viewKey, name, note, tabs, defaultOn, defaultPerms }: {
  viewKey: string; name: string; note?: string; tabs: HubTabOption[]; defaultOn: boolean; defaultPerms: string[];
}) {
  const [on, setOn] = useState(defaultOn);
  const [perms, setPerms] = useState(new Set(defaultPerms));
  const toggle = (p: string, v: boolean) => setPerms((s) => { const n = new Set(s); if (v) n.add(p); else n.delete(p); return n; });
  const seen: string[] = [];
  for (const t of tabs) if (perms.has(t.permission) && !seen.includes(t.tab)) seen.push(t.tab);
  const nameOf = (slug: string) => tabs.find((t) => t.tab === slug)?.label ?? slug;
  return (
    <div>
      <label className="flex min-h-10 items-center gap-2.5 text-sm">
        <input type="checkbox" name="views" value={viewKey} checked={on} onChange={(e) => setOn(e.target.checked)} className="size-5 flex-none accent-[#c2410c]" />
        <span>
          <span className="font-semibold">{name}</span>
          <span className="block text-xs text-ink-3">{note ?? "A hub: each tab below is granted on its own."}</span>
        </span>
      </label>
      <fieldset disabled={!on} className={`ml-7 mt-1 space-y-0.5 transition-opacity ${on ? "" : "opacity-45"}`}>
        <legend className="sr-only">{name} tabs</legend>
        {tabs.map((t) => (
          <label key={t.permission} className="flex min-h-10 items-start gap-2.5 py-1 text-[13px]">
            <input type="checkbox" name="permissions" value={t.permission} checked={perms.has(t.permission)} onChange={(e) => toggle(t.permission, e.target.checked)} className="mt-0.5 size-5 flex-none accent-[#c2410c]" />
            <span><span className="font-semibold">{t.label}</span><span className="block text-xs text-ink-3">{t.what}</span></span>
          </label>
        ))}
        {on && seen.length === 0 && <p className="text-xs font-semibold text-danger">Tick at least one, or untick {name}: a role can&apos;t hold it with nothing in it.</p>}
        {on && seen.length > 0 && <p className="text-xs text-ink-2">This role will see: {seen.map(nameOf).join(" · ")}</p>}
        {!on && <p className="text-xs text-ink-3">Tick {name} to choose what this role does there.</p>}
      </fieldset>
    </div>
  );
}
