export type LabelFormat = "OEM" | "GENERIC";

export interface LabelInput {
  format: LabelFormat;
  partNo: string;
  partName: string;
  batchCode: string;
  shift: string;
  machineCode: string;
  qty: number;
  date: Date;
  boxCode: string;
}

export interface Label {
  title: string;
  fields: [label: string, value: string][];
  qrPayload: string; // what the QR encodes; always ends with the box code
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const iso = (d: Date) => d.toISOString().slice(0, 10);

// OEM labels carry the full traceability set the SRS asks for (part no, batch, shift, machine, quantity,
// date) and encode it in the QR as a pipe-separated record. The exact OEM layout varies per customer,
// so this is the one place to adapt when a customer specifies its own standard.
export function buildLabel(i: LabelInput): Label {
  if (i.format === "OEM") {
    return {
      title: "OEM PART LABEL",
      fields: [
        ["Part No", i.partNo], ["Batch Code", i.batchCode], ["Shift", i.shift],
        ["Machine ID", i.machineCode], ["Quantity", String(i.qty)], ["Date", iso(i.date)],
      ],
      qrPayload: [i.partNo, i.batchCode, i.shift, i.machineCode, i.qty, ymd(i.date), i.boxCode].join("|"),
    };
  }
  return {
    title: "PRODUCT LABEL",
    fields: [["Part No", i.partNo], ["Description", i.partName], ["Quantity", String(i.qty)], ["Date", iso(i.date)], ["Box", i.boxCode]],
    qrPayload: i.boxCode,
  };
}

// A scan may be the bare box code (generic labels, manual entry) or a full OEM record. Either way the
// box code is the last field.
export function parseBoxCode(scan: string): string {
  const parts = scan.split("|");
  return parts[parts.length - 1].trim().toUpperCase();
}
