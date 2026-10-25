// Sample mould and machine maintenance data from the Claude Design example. Display only.

export const PM_INTERVAL = 50000;
export const MOULD_LIFE = 1000000;

export type MouldRow = { id: string; part: string; machine: string; cav: number; shots: number; last: number; hist: [string, string, string, string][] };

export const MOULDS: MouldRow[] = [
  { id: "MD-131", part: "Bezel BZ-31", machine: "M-05", cav: 2, shots: 351200, last: 300000, hist: [["14 Sep", "PM", "PM at 300,000 shots", "All 5 checks · 2 photos"], ["02 Aug", "Repair", "Cracked ejector pin #3 replaced", "Downtime 95 min · 3 photos"]] },
  { id: "MD-052", part: "Cap CP-08", machine: "M-01", cav: 8, shots: 92000, last: 50000, hist: [["21 Aug", "PM", "PM at 50,000 shots", "All 5 checks · 1 photo"]] },
  { id: "MD-090", part: "Handle HX-14", machine: "M-03", cav: 2, shots: 188400, last: 150000, hist: [["30 Aug", "PM", "PM at 150,000 shots", "All 5 checks"], ["11 Jul", "Repair", "Hot sprue heater replaced", "Downtime 140 min"]] },
  { id: "MD-118", part: "Door trim clip DT-220", machine: "M-07", cav: 4, shots: 412880, last: 400000, hist: [["18 Oct", "Repair", "Cavity 3 flash — parting line polished", "Downtime 25 min · 2 photos · from shift B stop"], ["02 Oct", "PM", "PM at 400,000 shots", "All 5 checks · 2 photos"]] },
  { id: "MD-201", part: "Housing HS-40", machine: "M-09", cav: 1, shots: 24500, last: 0, hist: [["05 Sep", "Trial", "New tool approved", "PPAP samples · 6 photos"]] },
];

export const PM_CHECKS = [
  "Clean vents and parting line", "Check ejector pins and return springs", "Flush cooling lines, check leaks",
  "Inspect gate and runner wear", "Grease guide pillars and bushes",
];

/** [machine, run hours, breakdowns, repair minutes, next PM] */
export const MACHINES: [string, number, number, number, string][] = [
  ["M-01", 610, 2, 70, "02 Nov"], ["M-03", 590, 3, 165, "28 Oct"], ["M-05", 640, 4, 260, "24 Oct"],
  ["M-07", 655, 2, 50, "05 Nov"], ["M-09", 420, 1, 45, "12 Nov"], ["M-11", 300, 0, 0, "Wed 21"],
];
