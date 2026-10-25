import { describe, expect, it } from "vitest";
import { buildEwayData } from "./eway";
import { buildLabel, parseBoxCode } from "./label";

const base = {
  partNo: "FG-CLIP-001", partName: "Dashboard Clip", batchCode: "PB-261020-0001", shift: "A",
  machineCode: "IMM-01", qty: 500, date: new Date("2026-10-20T08:00:00Z"), boxCode: "BX-261020-0007",
};

describe("buildLabel", () => {
  it("OEM label carries part, batch, shift, machine, quantity and date", () => {
    const l = buildLabel({ ...base, format: "OEM" });
    expect(Object.fromEntries(l.fields)).toEqual({
      "Part No": "FG-CLIP-001", "Batch Code": "PB-261020-0001", Shift: "A",
      "Machine ID": "IMM-01", Quantity: "500", Date: "2026-10-20",
    });
    expect(l.qrPayload).toBe("FG-CLIP-001|PB-261020-0001|A|IMM-01|500|20261020|BX-261020-0007");
  });

  it("generic label is simpler and its QR is just the box code", () => {
    const l = buildLabel({ ...base, format: "GENERIC" });
    expect(l.fields.map(([k]) => k)).toEqual(["Part No", "Description", "Quantity", "Date", "Box"]);
    expect(l.qrPayload).toBe("BX-261020-0007");
  });
});

describe("parseBoxCode", () => {
  it("reads the box code from a full OEM record or a bare code", () => {
    const oem = buildLabel({ ...base, format: "OEM" }).qrPayload;
    expect(parseBoxCode(oem)).toBe("BX-261020-0007");
    expect(parseBoxCode("bx-261020-0007 ")).toBe("BX-261020-0007");
  });

  it("round-trips every label format", () => {
    for (const format of ["OEM", "GENERIC"] as const) {
      expect(parseBoxCode(buildLabel({ ...base, format }).qrPayload)).toBe(base.boxCode);
    }
  });
});

describe("buildEwayData", () => {
  const input = {
    dcNumber: "DC-261020-0001", date: new Date("2026-10-20T10:00:00Z"), vehicleNumber: "mh 12 ab 1234",
    company: { name: "Crimson Moulders", gstin: "27AAAAA0000A1Z5", address: "Pune" },
    customer: { name: "Apex Motors", gstin: "27BBBBB1111B1Z6", address: "Chakan" },
    items: [{ name: "Dashboard Clip", hsnCode: "39269099", qty: 1000, uom: "NOS", unitPrice: 4.25 }],
  };

  it("builds a challan record with portal-style date, vehicle and totals", () => {
    const e = buildEwayData(input);
    expect(e).toMatchObject({
      supplyType: "O", docType: "CHL", docNo: "DC-261020-0001", docDate: "20/10/2026",
      vehicleNo: "MH12AB1234", fromGstin: "27AAAAA0000A1Z5", toGstin: "27BBBBB1111B1Z6", totalValue: 4250,
    });
    expect(e.itemList[0]).toMatchObject({ hsnCode: "39269099", quantity: 1000, qtyUnit: "NOS", taxableAmount: 4250 });
    expect(e.missing).toEqual([]);
  });

  it("lists missing master data instead of silently emitting blanks", () => {
    const e = buildEwayData({
      ...input, company: { ...input.company, gstin: "" }, customer: { name: "Apex Motors" },
      items: [{ name: "Dashboard Clip", qty: 10, uom: "NOS" }],
    });
    expect(e.missing).toEqual(expect.arrayContaining([
      expect.stringContaining("Company GSTIN"), "GSTIN for Apex Motors",
      "HSN code for Dashboard Clip", "Unit price for Dashboard Clip",
    ]));
  });

  it("rounds amounts to paise", () => {
    const e = buildEwayData({ ...input, items: [{ name: "X", hsnCode: "1", qty: 3, uom: "NOS", unitPrice: 0.3333 }] });
    expect(e.totalValue).toBe(1);
  });
});
