import { Minus } from "lucide-react";

// Pieces shared by the screens that have an "Edit layout" / "Edit list" mode (Stores bins, Customers & suppliers):
// dotted tiles that open a form in place, and the red circled minus in a corner.

export const field = "mt-1 w-full min-h-10 rounded-lg border border-border bg-white px-2 text-sm";
export const dotted = "border-2 border-dashed border-border text-ink-3 hover:border-accent hover:text-accent";

/** A tile that opens a form in place; once open it shows a Cancel row so it can be closed again. */
export function Drawer({ label, tile, tileClass, className = "", children }: {
  label: string; tile: React.ReactNode; tileClass: string; className?: string; children: React.ReactNode;
}) {
  return (
    <details className={`group ${className}`}>
      <summary aria-label={label} className="block cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className={`${tileClass} group-open:hidden`}>{tile}</span>
        <span className="hidden py-1 text-right text-xs font-semibold text-ink-3 group-open:block">Cancel ✕</span>
      </summary>
      {children}
    </details>
  );
}

/** The red circled minus at a corner. Greyed out, with the reason on hover, while the thing can't be removed. */
export function RemoveButton({ label, busy, why }: { label: string; busy: boolean; why: string }) {
  return (
    <button aria-label={label} title={busy ? why : label} disabled={busy}
      className="absolute -right-1.5 -top-1.5 z-10 flex size-5 cursor-pointer items-center justify-center rounded-full bg-danger text-white shadow-sm ring-2 ring-white hover:bg-[#8f1a10] disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-3">
      <Minus size={12} strokeWidth={3.5} aria-hidden />
    </button>
  );
}
