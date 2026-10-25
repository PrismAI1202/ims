import net from "node:net";
import type { Label } from "./label";

// ZPL II for Zebra-compatible thermal printers, 100 × 75 mm label at 203 dpi (812 × 600 dots).
const W = 812;

// With ^FH_ in effect, "_" starts a two-digit hex escape. Data containing ZPL control characters
// (^ ~ \ and the escape character itself) is encoded so a part name can never inject printer commands.
export function zplEscape(s: string): string {
  return [...s].map((ch) => (/[\^~\\_]/.test(ch) ? `_${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}` : ch)).join("").replace(/[\r\n]+/g, " ");
}

const field = (x: number, y: number, size: number, text: string) => `^FO${x},${y}^A0N,${size},${size}^FH_^FD${zplEscape(text)}^FS`;

export function zplBoxLabel(label: Label, boxCode: string): string {
  const lines: string[] = ["^XA", "^CI28", `^PW${W}`, "^LL600", `^FO20,20^GB${W - 40},4,4^FS`, field(30, 36, 34, label.title), field(W - 330, 40, 26, boxCode)];
  label.fields.forEach(([k, v], i) => {
    const y = 110 + i * 62;
    lines.push(field(30, y + 6, 24, k), field(230, y, 40, v));
  });
  // QR at the right, model 2, magnification 7. "QA," selects automatic input mode.
  lines.push(`^FO${W - 290},150^BQN,2,7^FH_^FDQA,${zplEscape(label.qrPayload)}^FS`, "^XZ");
  return lines.join("\n") + "\n";
}

export function zplLotTag(t: { itemCode: string; itemName: string; lotNumber: string; supplierLotNo: string; qty: string; status: string }): string {
  return [
    "^XA", "^CI28", `^PW${W}`, "^LL600",
    field(30, 30, 56, t.itemCode), field(30, 100, 28, t.itemName),
    field(30, 160, 30, `Lot: ${t.lotNumber}`), field(30, 210, 30, `Heat/Mfr lot: ${t.supplierLotNo}`),
    field(30, 260, 30, `Qty: ${t.qty}`), field(30, 310, 34, `QC: ${t.status}`),
    `^FO${W - 290},60^BQN,2,7^FH_^FDQA,${zplEscape(t.lotNumber)}^FS`, "^XZ",
  ].join("\n") + "\n";
}

// Bin labels are linear Code 128 so any handheld reads them, even without a camera.
export function zplBinLabel(code: string): string {
  return [
    "^XA", "^CI28", "^PW600", "^LL300",
    field(30, 30, 70, code),
    `^FO30,130^BY3^BCN,110,N,N,N^FH_^FD${zplEscape(code)}^FS`, "^XZ",
  ].join("\n") + "\n";
}

export interface PrinterTarget { host: string; port: number }

// The printer address comes from configuration only, never from a request, so this can't be pointed at arbitrary hosts.
export function printerFromEnv(env: Record<string, string | undefined> = process.env): PrinterTarget | null {
  const host = env.PRINTER_HOST?.trim();
  if (!host) return null;
  const port = Number(env.PRINTER_PORT ?? 9100);
  return Number.isInteger(port) && port > 0 && port < 65536 ? { host, port } : null;
}

// Raw TCP to the printer's port 9100: write the job, close, resolve. Fails with a plain message on timeout or refusal.
export function sendZpl(target: PrinterTarget, zpl: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: target.host, port: target.port });
    const fail = (msg: string) => { sock.destroy(); reject(new Error(msg)); };
    sock.setTimeout(timeoutMs, () => fail(`The label printer at ${target.host} didn't respond. Check it's on and connected.`));
    sock.once("error", (e: NodeJS.ErrnoException) =>
      fail(e.code === "ECONNREFUSED" ? `The label printer at ${target.host} refused the connection.` : `Couldn't reach the label printer (${e.code ?? e.message}).`));
    sock.once("connect", () => sock.end(zpl, "utf8", () => resolve()));
  });
}
