"use client";

import { useId, useState } from "react";
import { ChevronUp, Plus } from "lucide-react";

/**
 * A "create new" button for the top of a page. Clicking it expands the form in place and the content below
 * slides down; clicking again collapses it. The form stays mounted while collapsed so nothing typed is lost.
 */
export function NewPanel({
  label, defaultOpen = false, children,
}: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="print:hidden">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}
        className={`flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold md:w-auto ${
          open ? "border border-border bg-white text-ink" : "bg-accent text-white hover:bg-accent-hover"
        }`}
      >
        {open ? <ChevronUp size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
        {open ? "Close" : label}
      </button>
      <div
        id={id} inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
