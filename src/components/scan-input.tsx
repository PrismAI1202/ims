"use client";

import { useEffect, useRef, useState } from "react";

// One input for both scanner types: a Zebra handheld types the code like a keyboard (and sends Enter),
// a phone can use the camera button. Either way the parent just gets the scanned text.
export function ScanInput({
  label, value, onChange, onScan, autoFocus,
}: {
  label: string; value: string; onChange: (v: string) => void; onScan?: (v: string) => void; autoFocus?: boolean;
}) {
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!cameraOn) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (result && !cancelled) {
            const text = result.getText();
            onChange(text);
            onScan?.(text);
            setCameraOn(false);
          }
        });
        stop = () => controls.stop();
        if (cancelled) controls.stop();
      } catch {
        setCameraError("Camera unavailable. Use the handheld scanner or type the code.");
        setCameraOn(false);
      }
    })();
    return () => { cancelled = true; stop?.(); };
  }, [cameraOn, onChange, onScan]);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onScan && value.trim()) {
              e.preventDefault();
              onScan(value.trim());
            }
          }}
          autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-border bg-white px-3.5 py-3 min-h-13 text-base"
        />
        <button type="button" onClick={() => { setCameraError(""); setCameraOn((v) => !v); }}
          className="rounded-xl border border-border bg-white px-4 text-sm font-semibold">
          {cameraOn ? "Stop" : "Camera"}
        </button>
      </div>
      {cameraOn && <video ref={videoRef} className="w-full rounded-xl bg-black" muted playsInline />}
      {cameraError && <p className="text-sm text-danger">{cameraError}</p>}
    </div>
  );
}
