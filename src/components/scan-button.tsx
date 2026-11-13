"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScanLine, X } from "lucide-react";
import { codeOf } from "@/lib/scan-parse";

// The camera, wherever a step needs to identify something: a lot tag, a bin label, a box label, a supplier's heat number.
// A button that opens a camera sheet and hands the scanned text to `onScan`. A handheld scanner needs no button (it types into
// whatever field has focus), so the sheet also has a typing box that takes a handheld's scan or a typed code.
//
// `onScan` may return a short note ("✓ Loaded BX-…" or "✗ reason"). With `continuous` the camera stays open for the next scan and the
// notes pile up in a list (loading a truck box after box); otherwise the sheet closes after the first scan.

type Note = void | string | Promise<void | string>;

export function ScanButton({ onScan, title, hint, continuous = false, label = "Scan with the camera", className = "", size = "md" }: {
  onScan: (code: string) => Note; title: string; hint?: string; continuous?: boolean; label?: string; className?: string; size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<{ code: string; note?: string }[]>([]);
  const [typed, setTyped] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  const last = useRef({ code: "", at: 0 });
  useEffect(() => { handler.current = onScan; });

  async function accept(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 2500) return; // the same label seen again in the same moment
    last.current = { code, at: now };
    const note = await handler.current(code);
    if (continuous) setLog((l) => [{ code, note: note || undefined }, ...l].slice(0, 8));
    else setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError("");
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("The camera needs a secure (https) connection. Type the code below, or use a handheld scanner.");
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (result) => {
          if (result && !cancelled) void accept(result.getText());
        });
        stop = () => controls.stop();
        if (cancelled) controls.stop();
      } catch {
        setError("The camera isn't available (permission refused, or no camera). Type the code below, or use a handheld scanner.");
      }
    })();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => { cancelled = true; stop?.(); window.removeEventListener("keydown", key); };
    // `accept` only reads refs and stable props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => { setLog([]); setTyped(""); setOpen(true); }} aria-label={label} title={label}
        className={`flex flex-none cursor-pointer items-center justify-center rounded-xl border border-border bg-white text-ink hover:border-accent hover:text-accent ${size === "sm" ? "size-10" : "size-12"} ${className}`}>
        <ScanLine size={size === "sm" ? 18 : 20} aria-hidden />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
          <button type="button" aria-label="Close the camera" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-black/60" />
          <div className="relative max-h-[94dvh] w-full space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl md:max-w-md md:rounded-2xl">
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-extrabold leading-tight">{title}</h2>
                {hint && <p className="text-[13px] text-ink-3">{hint}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-10 flex-none cursor-pointer items-center justify-center rounded-xl bg-canvas"><X size={18} aria-hidden /></button>
            </header>

            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={video} muted playsInline className="aspect-[4/3] w-full object-cover" />
              <span aria-hidden className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80" />
            </div>
            {error && <p role="alert" className="rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">{error}</p>}

            <label className="block text-[13px] font-semibold">Or type the code, or use a handheld scanner
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="go"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void accept(typed); setTyped(""); } }}
                className="mt-1 min-h-12 w-full rounded-xl border border-border bg-white px-3.5 text-base" />
            </label>

            {continuous && log.length > 0 && (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-border text-[13px]" aria-live="polite">
                {log.map((l, i) => (
                  <li key={`${l.code}-${i}`} className={`px-3 py-2 ${l.note?.startsWith("✗") ? "bg-danger-bg text-danger" : ""}`}>
                    <span className="font-mono text-xs font-semibold">{l.code.split("|").pop()}</span>
                    {l.note && <span className="block text-xs">{l.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            {continuous && <button type="button" onClick={() => setOpen(false)} className="min-h-12 w-full cursor-pointer rounded-xl bg-ink text-[15px] font-semibold text-white">Done</button>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * An input with a camera button beside it, for a field that holds a scanned code (a lot, a bin, a heat number). The scanned code
 * goes into the field as if it had been typed, so forms, validation and the "keep what I typed" behaviour all see it.
 */
export function ScanField({
  label, title, hint, upper = false, className = "", wrap = "block text-[13px]", ...input
}: {
  label: React.ReactNode; title: string; hint?: string; upper?: boolean; className?: string; wrap?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "title">) {
  const ref = useRef<HTMLInputElement>(null);
  const put = (scanned: string) => {
    const el = ref.current;
    if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, upper ? codeOf(scanned).toUpperCase() : codeOf(scanned));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };
  return (
    <label className={wrap}>
      {label}
      <span className="mt-1 flex gap-2">
        <input ref={ref} autoCapitalize="characters" autoCorrect="off" spellCheck={false} {...input} className={`min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-white px-3.5 text-base text-ink ${className}`} />
        <ScanButton onScan={put} title={title} hint={hint} label={`Scan: ${title}`} />
      </span>
    </label>
  );
}
