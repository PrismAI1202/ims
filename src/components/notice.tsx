"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

// A short message that pops up and goes away by itself. Used where a button is switched off: a disabled button swallows clicks,
// so such buttons stay clickable (aria-disabled, greyed) and tell the user why they can't act.

export function useNotice(ms = 3500) {
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = msg && typeof document !== "undefined"
    ? createPortal(
        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex justify-center px-4 md:bottom-6">
          <p className="flex max-w-sm items-start gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-2xl">
            <Info size={16} className="mt-0.5 flex-none" aria-hidden />{msg}
          </p>
        </div>,
        document.body,
      )
    : null;
  return [notify, node] as const;
}

/** A button that may be inactive. While `why` is set it looks greyed, does nothing, and pops up the reason when pressed. */
export function ReasonButton({ why, onClick, className = "", children, ...rest }: {
  why?: string | false | null;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled">) {
  const [notify, node] = useNotice();
  return (
    <>
      <button {...rest} aria-disabled={why ? true : undefined} title={why || rest.title} className={`${className} ${why ? "cursor-not-allowed" : ""}`}
        onClick={(e) => {
          if (why) { e.preventDefault(); e.stopPropagation(); notify(why); return; }
          onClick?.(e);
        }}>
        {children}
      </button>
      {node}
    </>
  );
}
