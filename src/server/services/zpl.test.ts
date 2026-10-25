import net from "node:net";
import { describe, expect, it } from "vitest";
import { buildLabel } from "./label";
import { printerFromEnv, sendZpl, zplBinLabel, zplBoxLabel, zplEscape, zplLotTag } from "./zpl";

const oem = buildLabel({
  format: "OEM", partNo: "FG-CLIP-001", partName: "Dashboard Clip", batchCode: "PB-261020-0002", shift: "B",
  machineCode: "IMM-01", qty: 500, date: new Date("2026-10-20T08:00:00Z"), boxCode: "BX-261020-0001",
});

describe("zplEscape", () => {
  it("hex-encodes ZPL control characters and the escape character", () => {
    expect(zplEscape("a^b~c\\d_e")).toBe("a_5Eb_7Ec_5Cd_5Fe");
  });
  it("flattens newlines so data can't break out of its field", () => {
    expect(zplEscape("line1\nline2\r\nline3")).toBe("line1 line2 line3");
  });
  it("leaves ordinary text alone", () => expect(zplEscape("FG-CLIP-001 / 500 pcs")).toBe("FG-CLIP-001 / 500 pcs"));
});

describe("zplBoxLabel", () => {
  const zpl = zplBoxLabel(oem, "BX-261020-0001");
  it("is one complete job that starts and ends correctly", () => {
    expect(zpl.startsWith("^XA\n")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
    expect(zpl.match(/\^XA/g)).toHaveLength(1);
    expect(zpl.match(/\^XZ/g)).toHaveLength(1);
  });
  it("prints every label field and a QR carrying the full payload", () => {
    for (const v of ["FG-CLIP-001", "PB-261020-0002", "IMM-01", "500", "2026-10-20"]) expect(zpl).toContain(v);
    expect(zpl).toContain("^BQN,2,7");
    expect(zpl).toContain(`^FDQA,${oem.qrPayload.replace(/\|/g, "|")}`);
  });
  it("cannot be hijacked by hostile data", () => {
    const evil = buildLabel({ format: "GENERIC", partNo: "X^XZ^XA", partName: "~JA^PQ9999", batchCode: "b", shift: "A", machineCode: "m", qty: 1, date: new Date(), boxCode: "BX^FS" });
    const out = zplBoxLabel(evil, "BX^FS");
    expect(out.match(/\^XA/g)).toHaveLength(1); // injected ^XA/^XZ were escaped
    expect(out.match(/\^XZ/g)).toHaveLength(1);
    expect(out).not.toContain("~JA");
    expect(out).not.toContain("^PQ9999");
  });
});

describe("zplLotTag / zplBinLabel", () => {
  it("lot tag carries the lot number as its QR", () => {
    const z = zplLotTag({ itemCode: "RM-PP-001", itemName: "PP Homopolymer", lotNumber: "LOT-261014-0001", supplierLotNo: "HEAT-1", qty: "2000 KG", status: "APPROVED" });
    expect(z).toContain("^FDQA,LOT-261014-0001");
    expect(z).toContain("HEAT-1");
  });
  it("bin label is a Code 128 barcode of the bin code", () => {
    const z = zplBinLabel("A-01-03");
    expect(z).toContain("^BCN");
    expect(z).toContain("^FDA-01-03");
  });
});

describe("printerFromEnv", () => {
  it("returns null unless a host is configured", () => {
    expect(printerFromEnv({})).toBeNull();
    expect(printerFromEnv({ PRINTER_HOST: "  " })).toBeNull();
  });
  it("defaults to the standard raw port and rejects bad ports", () => {
    expect(printerFromEnv({ PRINTER_HOST: "10.0.0.50" })).toEqual({ host: "10.0.0.50", port: 9100 });
    expect(printerFromEnv({ PRINTER_HOST: "p", PRINTER_PORT: "9101" })).toEqual({ host: "p", port: 9101 });
    expect(printerFromEnv({ PRINTER_HOST: "p", PRINTER_PORT: "99999" })).toBeNull();
    expect(printerFromEnv({ PRINTER_HOST: "p", PRINTER_PORT: "abc" })).toBeNull();
  });
});

describe("sendZpl over a real TCP socket", () => {
  const listen = () =>
    new Promise<{ port: number; received: Promise<string>; close: () => void }>((resolve) => {
      let done!: (s: string) => void;
      const received = new Promise<string>((r) => (done = r));
      const server = net.createServer((sock) => {
        const chunks: Buffer[] = [];
        sock.on("data", (c) => chunks.push(c));
        sock.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
      });
      server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() }));
    });

  it("delivers the whole job to the printer port", async () => {
    const srv = await listen();
    const job = zplBoxLabel(oem, "BX-261020-0001");
    await sendZpl({ host: "127.0.0.1", port: srv.port }, job);
    expect(await srv.received).toBe(job);
    srv.close();
  });

  it("gives a plain message when the printer refuses the connection", async () => {
    const srv = await listen();
    const port = srv.port;
    srv.close();
    await new Promise((r) => setTimeout(r, 50));
    await expect(sendZpl({ host: "127.0.0.1", port }, "^XA^XZ")).rejects.toThrow(/refused|Couldn't reach/);
  });

  it("fails with a plain message instead of hanging when the printer can't be reached", async () => {
    // A non-routable address either times out or is rejected immediately, depending on the network; both must surface as our message.
    await expect(sendZpl({ host: "10.255.255.1", port: 9100 }, "^XA^XZ", 300)).rejects.toThrow(/didn't respond|Couldn't reach/);
  });
});
