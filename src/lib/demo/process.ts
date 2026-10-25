// Sample data for the Process screen, taken from the Claude Design example. Display only; nothing here is stored.

export type ProcessEntry = {
  id: string; by: string; init: string; avBg: string; time: string; status: string;
  photos: string[]; fields: [string, string][];
};
export type ProcessStage = {
  key: string; name: string; role: string; owners: string[]; color: string; rule: string;
  proofs: string[]; link: string; linkLabel: string; desc: string; entries: ProcessEntry[];
};

type Person = [name: string, init: string, bg: string];
const RK: Person = ["Ravi · Incharge", "RK", "#C2410C"], PS: Person = ["Priya · QA", "PS", "#1D4ED8"],
  AM: Person = ["Arun · Lead", "AM", "#6B4FB0"], SG: Person = ["Sunil · Operator", "SG", "#6B4FB0"],
  MI: Person = ["Meera · Planner", "MI", "#4B5563"], SN: Person = ["Suresh · Security", "SN", "#585C63"],
  KR: Person = ["Kiran · Dispatch", "KR", "#15171A"], SY: Person = ["System (EDI)", "SY", "#4B5563"];

const E = (id: string, who: Person, time: string, status: string, photos: string[], fields: [string, string][]): ProcessEntry =>
  ({ id, by: who[0], init: who[1], avBg: who[2], time, status, photos, fields });

const LIB: Record<string, Omit<ProcessStage, "key">> = {
  sched: { name: "Customer schedule", role: "Planner", owners: ["Planner"], color: "#4B5563", rule: "EDI / CSV import", proofs: [], link: "/demand", linkLabel: "Customer demand",
    desc: "Rolling forecasts, firm weekly call-offs and spot POs are imported and tagged Automotive or Non-automotive, which decides the rules every later step applies.",
    entries: [
      E("EDI-W44", SY, "11:30", "Review", [], [["Customer", "[OEM CUSTOMER A]"], ["Schedule lines", "52"], ["Change vs W43", "+6% on DT-220"]]),
      E("CPO-2335", MI, "10:05", "Imported", [], [["Customer", "[TIER-1 CUSTOMER C]"], ["Part", "HS-40 housing"], ["Qty", "6,000 pcs"]]),
      E("SCH-W43", MI, "09:10", "Imported", [], [["Source", "Customer EDI"], ["Schedule lines", "46"], ["Firm weeks", "2"]]),
    ] },
  mrp: { name: "MRP & PO release", role: "Planner", owners: ["Planner"], color: "#4B5563", rule: "Equivalents allowed", proofs: [], link: "/mrp", linkLabel: "MRP plan",
    desc: "Net requirement is worked out per equivalent group (not per grade) from live stock, safety stock and active BOMs. A PO is then released to the chosen vendor grade.",
    entries: [
      E("PO-0934", MI, "12:15", "Draft", [], [["Item", "Brass insert M4"], ["Net need", "68,000 pcs"], ["For", "CPO-2310, SCH-W43"]]),
      E("PO-0935", MI, "12:18", "Draft", [], [["Group", "Grey MB RAL 7035"], ["Net need", "150 kg"], ["Grade", "Vendor E"]]),
      E("PO-0933", MI, "03 Oct", "Approved", [], [["Group", "EQ-RM-014"], ["Net need", "2,000 kg"], ["Grade", "H110 · Vendor A"]]),
    ] },
  gate: { name: "Gate entry", role: "Security / Store Incharge", owners: ["Store Incharge"], color: "#C2410C", rule: "Vehicle + invoice", proofs: ["Vehicle at gate", "Supplier invoice"], link: "/grn", linkLabel: "Gate entry & GRN",
    desc: "Security logs the vehicle, driver and supplier invoice before material enters the yard. The invoice is matched to an open PO.",
    entries: [
      E("GE-1183", SN, "12:40", "Waiting", ["Vehicle at gate"], [["Vehicle", "[VEHICLE NO.]"], ["Invoice", "Not yet matched to a PO"], ["Supplier", "Vendor F"]]),
      E("GE-1182", SN, "11:02", "Done", ["Vehicle at gate", "Supplier invoice"], [["Vehicle", "[VEHICLE NO.]"], ["Invoice", "INV/24-25/7781"], ["PO", "PO-0933"]]),
      E("GE-1181", SN, "09:40", "Done", ["Vehicle at gate", "Supplier invoice"], [["Vehicle", "[VEHICLE NO.]"], ["Invoice", "INV/7702"], ["PO", "PO-0929"]]),
    ] },
  weigh: { name: "Weighbridge check", role: "Security / Store Incharge", owners: ["Store Incharge"], color: "#C2410C", rule: "Scale reading", proofs: ["Weighbridge slip"], link: "", linkLabel: "",
    desc: "Gross and tare readings confirm the invoiced weight before unloading. A difference over tolerance flags the GRN.",
    entries: [E("WB-0771", SN, "11:08", "Done", ["Weighbridge slip"], [["Gross", "9,480 kg"], ["Tare", "8,470 kg"], ["Net vs invoice", "+4.2 kg (OK)"]])] },
  grn: { name: "GRN & lot tagging", role: "Store Incharge", owners: ["Store Incharge"], color: "#C2410C", rule: "Heat / lot no.", proofs: ["Lot / heat label", "Bag count", "Scale reading"], link: "/grn", linkLabel: "Gate entry & GRN",
    desc: "Store counts bags, records the manufacturer heat/lot number and weight. If the vendor shipped another approved grade from the group, it is mapped to the PO line here.",
    entries: [
      E("GRN-2419", RK, "12:44", "Draft", ["Lot / heat label"], [["Received", "INS-M4-K · Vendor F"], ["Mapped to", "PO-0927 L1"], ["Qty", "Counting · 6 of 16 boxes"]]),
      E("GRN-2418", RK, "12:02", "Pending QC", ["Lot / heat label", "Bag count", "Scale reading"], [["Received", "ABS natural · Vendor A"], ["Lot", "AB-2240"], ["Qty", "40 × 25 kg"]]),
      E("GRN-2417", RK, "11:11", "Pending QC", ["Lot / heat label", "Bag count", "Scale reading"], [["Received", "PH-12N · Vendor B"], ["Mapped to", "PO-0933 L1 (equivalent)"], ["Qty", "40 × 25 kg"], ["Scale", "1,004.2 kg"]]),
      E("GRN-2415", RK, "09:52", "Released", ["Lot / heat label", "Bag count", "Scale reading"], [["Received", "BK-4021 · Vendor D"], ["Mapped to", "PO-0929 L2"], ["Qty", "8 × 25 kg"]]),
    ] },
  coa: { name: "COA verification", role: "QA Inspector", owners: ["QA Inspector"], color: "#1D4ED8", rule: "IATF 16949", proofs: ["COA document"], link: "/qc", linkLabel: "Inward QC",
    desc: "QA checks the supplier certificate of analysis against the equivalent group spec. Mandatory before GRN release for automotive lots.",
    entries: [
      E("COA-2418", PS, "12:10", "Pending", [], [["Lot", "AB-2240 (ABS)"], ["COA", "Uploaded by vendor — not checked"], ["Spec", "MFI 18–24"]]),
      E("COA-55821", PS, "11:18", "Verified", ["COA document"], [["Lot", "SB-55821"], ["MFI on COA", "12.2"], ["Spec", "11–13"]]),
    ] },
  qc: { name: "QC hold / release", role: "QA Inspector", owners: ["QA Inspector"], color: "#1D4ED8", rule: "MFI · moisture", proofs: ["Lab printout", "Retained sample"], link: "/qc", linkLabel: "Inward QC",
    desc: "The lot stays on hold until lab results pass. Release prints QR bag tags and adds the lot to the FIFO queue; reject or deviation needs a reason.",
    entries: [
      E("QC-55821", PS, "11:20", "Pending QC", ["Lab printout"], [["MFI", "12.4 (11–13)"], ["Moisture", "0.03% (≤0.05)"], ["Density", "0.905"]]),
      E("QC-2418", PS, "12:05", "Pending QC", [], [["Lot", "AB-2240 ABS"], ["Tests", "Not started"], ["Due", "Before shift C"]]),
      E("QC-55850", PS, "08:40", "Hold", ["Lab printout"], [["Lot", "SB-55850"], ["Moisture", "0.09% — above 0.05"], ["Action", "Re-dry and retest"]]),
      E("QC-55810", PS, "07:30", "Released", ["Lab printout", "Retained sample"], [["MFI", "11.8"], ["Moisture", "0.02%"], ["QR tags", "24 printed"]]),
    ] },
  store: { name: "Bin put-away", role: "Store Incharge", owners: ["Store Incharge"], color: "#1E7A46", rule: "Rack-Shelf-Bin", proofs: [], link: "/stock?view=bins", linkLabel: "Stores bin map",
    desc: "Released bags are scanned into Rack-Shelf-Bin locations so pickers are guided straight to the oldest lot.",
    entries: [
      E("PUT-0913", RK, "12:30", "Pending", [], [["Lot", "BK-4021 L-77"], ["From", "QC-H1"], ["To", "R2-S3-B4"]]),
      E("PUT-0912", RK, "08:48", "Done", [], [["Lot", "SB-55810"], ["Bin", "R3-S2-B4"], ["Bags", "24"]]),
    ] },
  issue: { name: "FIFO issue to floor", role: "Store Incharge", owners: ["Store Incharge"], color: "#1E7A46", rule: "Lot scan", proofs: [], link: "/issue", linkLabel: "FIFO issue",
    desc: "Shop-floor requisitions are filled oldest lot first. Scanning a newer lot is blocked unless QA allows an exception.",
    entries: [
      E("REQ-552", AM, "12:20", "Open", [], [["For", "M-07 · DT-220"], ["Material", "PP blend 42 kg"], ["FIFO lot", "SB-55790"]]),
      E("REQ-553", SG, "12:34", "Open", [], [["For", "M-03 · HX-14"], ["Material", "Grey MB 2 kg"], ["FIFO lot", "GR-7035-12"]]),
      E("REQ-554", AM, "12:41", "Open", [], [["For", "M-05 · BZ-31"], ["Material", "Brass insert M4 2,000"], ["FIFO lot", "Box 14"]]),
      E("ISS-3301", RK, "10:05", "Issued", [], [["To", "M-07 · DT-220"], ["Lot (FIFO)", "SB-55790"], ["Qty", "42 kg"]]),
    ] },
  dry: { name: "Resin drying", role: "Production Lead", owners: ["Production Lead", "Operator"], color: "#6B4FB0", rule: "80°C · 2 h", proofs: [], link: "", linkLabel: "",
    desc: "Moisture-sensitive resins are dried to spec before loading the hopper. Start and end time are logged per lot.",
    entries: [E("DRY-0118", SG, "11:50", "In progress", [], [["Lot", "PA66 PG-118"], ["Dryer", "D-02 · 80 °C"], ["Ready at", "13:50"]])] },
  mould: { name: "Moulding & regrind", role: "Production Lead / Operator", owners: ["Production Lead", "Operator"], color: "#6B4FB0", rule: "Max regrind 20%", proofs: ["Runner on scale"], link: "/production", linkLabel: "Production",
    desc: "Production logs shots, runner/sprue weight and regrind added, checked against the BOM blend ratio and the grade’s regrind limit.",
    entries: [
      E("RG-0449", SG, "12:00", "Due", [], [["Mould", "MD-118 on M-07"], ["Runner weight", "Not logged for 2 h"], ["Limit", "20%"]]),
      E("DT-0212", SG, "11:10", "Open", ["Runner on scale"], [["Machine", "M-05"], ["Stop", "Mould repair · 25 min"], ["Ticket", "Tool room"]]),
      E("RG-0448", AM, "10:40", "Logged", ["Runner on scale"], [["Mould", "MD-118"], ["Regrind", "6.2 kg"], ["Ratio used", "15%"]]),
    ] },
  fg: { name: "FG booking & label", role: "Production Lead / Operator", owners: ["Production Lead", "Operator"], color: "#6B4FB0", rule: "OEM QR label", proofs: [], link: "/fg", linkLabel: "FG & box labels",
    desc: "Hourly good and rejected parts are booked against machine and mould, and customer-format QR labels are printed.",
    entries: [
      E("BK-M07-12", SG, "12:00", "Due", [], [["Machine", "M-07 · MD-118"], ["Hour", "12:00–13:00"], ["Status", "Not booked yet"]]),
      E("FG-1530", AM, "11:00", "Booked", [], [["Good parts", "588"], ["Rejects", "12"], ["Labels", "3 OEM QR"]]),
      E("FG-1500", AM, "10:00", "Booked", [], [["Good parts", "3,880"], ["Rejects", "64"], ["Labels", "16 OEM QR"]]),
    ] },
  disp: { name: "Dispatch & DC", role: "Dispatch Officer", owners: ["Dispatch Officer"], color: "#15171A", rule: "Returnable bins", proofs: ["Loaded truck"], link: "/dispatch", linkLabel: "Dispatch",
    desc: "The pick list is scanned bin by bin before loading. The delivery challan and E-way bill data are generated and returnable bins are logged against the customer.",
    entries: [
      E("DC-0881", KR, "17:00 (planned)", "Picking", [], [["Customer", "[OEM CUSTOMER A]"], ["Bins", "40 returnable"], ["Scanned", "31 / 40"]]),
      E("DC-0882", KR, "Tomorrow 09:00", "Planned", [], [["Customer", "[CUSTOMER B]"], ["Part", "HX-14 · 2,000 pcs"], ["Packing", "Corrugated × 40"]]),
      E("DC-0879", KR, "09:30", "Dispatched", ["Loaded truck"], [["Customer", "[TIER-1 CUSTOMER C]"], ["Part", "BZ-31 · 4,000 pcs"], ["E-way data", "Exported"]]),
    ] },
};

const TEMPLATES = {
  auto: ["sched", "mrp", "gate", "grn", "coa", "qc", "store", "issue", "mould", "fg", "disp"],
  non: ["sched", "mrp", "gate", "grn", "qc", "store", "issue", "mould", "fg", "disp"],
} as const;

export const PROCESS_VERSION = { auto: { ver: 3, by: "INCHARGE" }, non: { ver: 2, by: "INCHARGE" } } as const;

export function processStages(seg: "auto" | "non"): ProcessStage[] {
  return TEMPLATES[seg].map((k) => ({ key: k, ...LIB[k] }));
}

/** Statuses that mean "someone still has to act on this". */
export const PENDING_STATUSES = ["Pending QC", "Draft", "Picking", "Review", "Waiting", "Pending", "Hold", "Open", "In progress", "Due", "Planned"];
