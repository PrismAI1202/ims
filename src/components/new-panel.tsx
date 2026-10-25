"use client";

import { createContext, useContext, useId, useState } from "react";
import { ChevronUp, Plus } from "lucide-react";

const ease = "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none";

/** The animated "slide open" wrapper shared by every create panel. */
function Slide({ id, open, children }: { id?: string; open: boolean; children: React.ReactNode }) {
  return (
    <div id={id} inert={!open} className={`grid ${ease} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden"><div className="pt-3">{children}</div></div>
    </div>
  );
}

// ── Header button + panel below ──────────────────────────────────────────────────────────────────────
// <CreateProvider> wraps a page; <CreateButton> goes in the page header (top right); <CreatePanel> holds the form
// in the content area. Clicking the button slides the panel open and pushes the list down.
const Ctx = createContext<{ open: string | null; toggle: (k: string) => void; base: string } | null>(null);

/** `defaultOpen`: true opens the main panel; a string opens the panel with that id. */
export function CreateProvider({ defaultOpen = false, children }: { defaultOpen?: boolean | string; children: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(defaultOpen === true ? "main" : defaultOpen || null);
  const base = useId();
  return <Ctx.Provider value={{ open, toggle: (k) => setOpen((o) => (o === k ? null : k)), base }}>{children}</Ctx.Provider>;
}

export function CreateButton({ label, id = "main" }: { label: string; id?: string }) {
  const c = useContext(Ctx);
  if (!c) return null;
  const open = c.open === id;
  return (
    <button
      type="button" onClick={() => c.toggle(id)} aria-expanded={open} aria-controls={`${c.base}-${id}`}
      className={`flex min-h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-semibold ${
        open ? "bg-shell-2 text-on-shell" : "bg-accent text-white hover:bg-accent-hover"
      }`}
    >
      {open ? <ChevronUp size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
      {open ? "Close" : label}
    </button>
  );
}

export function CreatePanel({ id = "main", children }: { id?: string; children: React.ReactNode }) {
  const c = useContext(Ctx);
  if (!c) return null;
  return <div className="print:hidden"><Slide id={`${c.base}-${id}`} open={c.open === id}>{children}</Slide></div>;
}

// ── Stand-alone button + panel (used where the page header has no room) ──────────────────────────────
export function NewPanel({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return <Panels items={[{ label, node: children }]} defaultOpen={defaultOpen ? 0 : -1} />;
}

/** Several create buttons side by side; the chosen one opens full width underneath (one at a time). */
export function Panels({ items, defaultOpen = -1 }: { items: { label: string; node: React.ReactNode }[]; defaultOpen?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const base = useId();
  return (
    <div className="print:hidden">
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <button key={it.label} type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} aria-controls={`${base}-${i}`}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-semibold ${
              open === i ? "border border-border bg-white text-ink" : "bg-accent text-white hover:bg-accent-hover"
            }`}>
            {open === i ? <ChevronUp size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
            {open === i ? `Close ${it.label.toLowerCase()}` : it.label}
          </button>
        ))}
      </div>
      {items.map((it, i) => <Slide key={it.label} id={`${base}-${i}`} open={open === i}>{it.node}</Slide>)}
    </div>
  );
}
