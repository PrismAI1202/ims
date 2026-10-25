"use client";

import { useEffect, useRef, useState } from "react";
import { lineSplitter, parseScaleLine, type ScaleReading } from "@/lib/scale-parse";

// Minimal Web Serial typings (not in TypeScript's DOM lib yet).
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
type SerialNav = { serial?: { requestPort(): Promise<SerialPortLike> } };

// A weight field that always accepts typing, and can also read a connected serial scale (Chrome or Edge, on
// HTTPS or localhost). "Use this weight" only enables once the scale reports a stable reading.
export function WeightInput({
  name, placeholder, className, min = 0, defaultValue,
}: { name: string; placeholder?: string; className?: string; min?: number; defaultValue?: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [baud, setBaud] = useState(9600);
  const [error, setError] = useState("");
  const stop = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(typeof navigator !== "undefined" && "serial" in navigator);
    return () => { void stop.current?.(); };
  }, []);

  async function connect() {
    setError("");
    try {
      const port = await (navigator as unknown as SerialNav).serial!.requestPort();
      await port.open({ baudRate: baud });
      const reader = port.readable!.getReader();
      const decoder = new TextDecoder(); // scales send ASCII; stream mode keeps characters split across chunks intact
      const feed = lineSplitter();
      let live = true;
      stop.current = async () => {
        live = false;
        try { await reader.cancel(); } catch { /* already closed */ }
        try { await port.close(); } catch { /* already closed */ }
        setConnected(false);
        setReading(null);
      };
      setConnected(true);
      void (async () => {
        try {
          while (live) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const line of feed(decoder.decode(value, { stream: true }))) {
              const r = parseScaleLine(line);
              if (r) setReading(r);
            }
          }
        } catch {
          setError("The scale was disconnected.");
        }
        setConnected(false);
      })();
    } catch (e) {
      // The browser throws NotFoundError when the user dismisses the port picker; that isn't a fault.
      if (!(e instanceof DOMException && e.name === "NotFoundError")) setError("Couldn't open the scale. Check the cable, the baud rate and that no other program is using it.");
    }
  }

  function useWeight() {
    if (!reading?.stable || !inputRef.current) return;
    inputRef.current.value = String(Math.round(reading.kg * 1000) / 1000);
    inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <div className="space-y-1">
      <input ref={inputRef} name={name} type="number" step="any" min={min} placeholder={placeholder} defaultValue={defaultValue} className={className} />
      {supported && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!connected ? (
            <>
              <button type="button" onClick={connect} className="rounded border px-2 py-1">Connect scale</button>
              <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} aria-label="Scale baud rate" className="rounded border px-1 py-1">
                {[2400, 4800, 9600, 19200].map((b) => <option key={b} value={b}>{b} baud</option>)}
              </select>
            </>
          ) : (
            <>
              <span className={reading ? (reading.stable ? "font-semibold text-ok" : "text-warn-ink") : "text-ink-3"}>
                {reading ? `${reading.kg} kg${reading.stable ? "" : " (settling…)"}` : "Waiting for the scale…"}
              </span>
              <button type="button" onClick={useWeight} disabled={!reading?.stable} className="min-h-9 cursor-pointer rounded-lg border border-border bg-white px-3 text-xs font-semibold disabled:opacity-40">Use this weight</button>
              <button type="button" onClick={() => void stop.current?.()} className="min-h-9 cursor-pointer text-xs font-semibold text-ink-2">Disconnect</button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
