export interface ScaleReading {
  kg: number;
  stable: boolean; // false while the load is still settling: don't record these
  raw: string;
}

const TO_KG: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237 };

// Reads one line of serial output from a bench or floor scale. Handles the common styles:
//   "ST,GS,+0012.34kg"   (CAS / A&D / Ohaus continuous output; US = unstable)
//   "S S     12.34 kg"   (Mettler SICS; "S D" = dynamic/unstable)
//   "  12.34 kg", "N 1.20 kg", "WT:0.250KG", "250 g"
// A unit is required: a bare number could be grams or kilograms, and guessing wrong is a 1000× error.
export function parseScaleLine(line: string): ScaleReading | null {
  const raw = line.trim();
  if (!raw) return null;

  const m = raw.match(/([+-]?\d+(?:[.,]\d+)?)\s*(kg|g|lbs?|lb)\b/i);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value) || value < 0) return null; // negative = tare error or overload

  const head = raw.slice(0, m.index).toUpperCase();
  const unstable = /(^|[\s,])(US|M|\?)([\s,]|$)/.test(head) || /\bS\s+D\b/.test(head) || /\bMOTION\b/.test(head);
  return { kg: Math.round(value * TO_KG[unit] * 1e6) / 1e6, stable: !unstable, raw };
}

// Accumulates streamed text and yields complete lines, since serial data arrives in arbitrary chunks.
export function lineSplitter() {
  let buf = "";
  return (chunk: string): string[] => {
    buf += chunk;
    const parts = buf.split(/\r\n|\r|\n/);
    buf = parts.pop() ?? "";
    if (buf.length > 500) buf = ""; // never grow without bound if the device sends no line endings
    return parts;
  };
}
