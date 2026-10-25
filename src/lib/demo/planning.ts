// Sample mould × machine plan from the Claude Design example. Display only; nothing here is scheduled for real.

export const PLAN_MACHINES: [string, number][] = [["M-01", 80], ["M-03", 120], ["M-05", 150], ["M-07", 180], ["M-09", 250], ["M-11", 350]];
export const PLAN_DAYS = ["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23", "Sat 24"];

export type PlanKind = { part: string; mould: string; order: string; colour: string; bg: string; fg: string };
export const PLAN_KINDS: Record<string, PlanKind> = {
  dt: { part: "DT-220", mould: "MD-118", order: "CPO-2310", colour: "Black", bg: "#15171A", fg: "#FFFFFF" },
  hx: { part: "HX-14", mould: "MD-090", order: "CPO-2298+", colour: "Grey", bg: "#9AA0A8", fg: "#15171A" },
  bz: { part: "BZ-31", mould: "MD-131", order: "SCH-W43", colour: "Black", bg: "#3D434B", fg: "#FFFFFF" },
  cp: { part: "CP-08", mould: "MD-052", order: "CPO-2321", colour: "Natural", bg: "#F5E7C6", fg: "#3A2A00" },
  hs: { part: "HS-40", mould: "MD-201", order: "CPO-2335", colour: "Grey", bg: "#6E95E8", fg: "#0B1F4D" },
  tr: { part: "Trial", mould: "MD-212", order: "New tool", colour: "—", bg: "#FDF0E4", fg: "#8A4B00" },
  pm: { part: "PM", mould: "Machine", order: "Tool room", colour: "—", bg: "#FCEDEB", fg: "#B42318" },
};

export const PLAN_SCHEDULE: Record<string, string> = {
  "M-07-0": "dt", "M-07-1": "dt", "M-03-0": "hx", "M-03-1": "hx", "M-03-2": "hx", "M-05-3": "bz", "M-05-4": "bz", "M-09-1": "tr", "M-11-2": "pm",
};
export const PLAN_JOBS = [
  { k: "dt", ton: 150, qty: "15,400 pcs left", left: 2 },
  { k: "cp", ton: 80, qty: "25,000 pcs", left: 2 },
  { k: "hs", ton: 250, qty: "6,000 pcs", left: 2 },
];
