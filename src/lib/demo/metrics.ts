// Sample performance data from the Claude Design example. Display only; no OEE data is recorded yet.

export type KpiTile = { label: string; value: string; note: string; tone: "ok" | "warn" | "danger" | "neutral"; href: string };
export type MetricsPeriod = {
  name: string; trend: string; unit: string; labels: string[];
  A: number[]; P: number[]; Q: number[];
  pareto: [string, number][]; shifts: [string, number][]; machines: [string, number, number, number][];
  kpis: KpiTile[];
};

const K = (label: string, value: string, note: string, tone: KpiTile["tone"], href: string): KpiTile => ({ label, value, note, tone, href });

export const METRICS: MetricsPeriod[] = [
  { name: "Daily", trend: "last 7 working days", unit: "day",
    labels: ["Tue 13", "Wed 14", "Thu 15", "Fri 16", "Sat 17", "Mon 19", "Tue 20"],
    A: [.84, .86, .82, .88, .85, .89, .867], P: [.80, .82, .78, .83, .81, .84, .837], Q: [.96, .97, .95, .96, .96, .97, .979],
    pareto: [["Mould repair", 95], ["Colour change", 60], ["Mould change", 45], ["No material", 30], ["Machine breakdown", 25], ["QC hold", 15]],
    shifts: [["A · 06–14", .74], ["B · 14–22", .71], ["C · 22–06", .63]],
    machines: [["M-01", .78, .87, .93], ["M-03", .84, .80, .97], ["M-05", .72, .76, .95], ["M-07", .867, .837, .979], ["M-09", .90, .86, .98], ["M-11", .70, .82, .96]],
    kpis: [K("QC lot rejects", "0 of 3", "Today", "ok", "/qc"), K("Items below min", "4", "Raise POs", "danger", "/stock?status=RED"),
      K("Regrind usage", "14.6%", "Limit 20%", "ok", "/production"), K("On-time dispatch", "1 of 1", "Today", "ok", "/dispatch"),
      K("MTBF (plant)", "138 h", "Run h ÷ breakdowns", "neutral", "/maintenance"), K("MTTR (plant)", "49 min", "Repair min ÷ breakdowns", "neutral", "/maintenance"),
      K("PM compliance", "4 of 5", "MD-131 overdue", "warn", "/maintenance"), K("Returnables out", "102", "24 > 30 days", "danger", "/returnables")] },
  { name: "Weekly", trend: "last 8 weeks", unit: "week",
    labels: ["W36", "W37", "W38", "W39", "W40", "W41", "W42", "W43"],
    A: [.82, .84, .85, .83, .86, .87, .87, .88], P: [.74, .76, .77, .75, .78, .80, .79, .81], Q: [.95, .955, .96, .96, .965, .965, .96, .968],
    pareto: [["Mould change", 410], ["Mould repair", 360], ["Colour change", 280], ["No material", 190], ["No operator", 120], ["Power cut", 90]],
    shifts: [["A · 06–14", .72], ["B · 14–22", .70], ["C · 22–06", .64]],
    machines: [["M-01", .76, .85, .94], ["M-03", .86, .79, .96], ["M-05", .80, .74, .95], ["M-07", .90, .82, .97], ["M-09", .92, .85, .98], ["M-11", .88, .80, .97]],
    kpis: [K("QC lot rejects", "1 of 14", "7.1% of lots", "warn", "/qc"), K("Items below min", "4", "Raise POs", "danger", "/stock?status=RED"),
      K("Regrind usage", "13.8%", "Limit 20%", "ok", "/production"), K("On-time dispatch", "11 of 12", "91.7%", "warn", "/dispatch"),
      K("MTBF (plant)", "140 h", "Run h ÷ breakdowns", "neutral", "/maintenance"), K("MTTR (plant)", "52 min", "Repair min ÷ breakdowns", "neutral", "/maintenance"),
      K("PM compliance", "9 of 10", "90%", "warn", "/maintenance"), K("Returnables out", "102", "24 > 30 days", "danger", "/returnables")] },
  { name: "Monthly", trend: "last 6 months", unit: "month",
    labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"],
    A: [.80, .81, .83, .84, .85, .86], P: [.73, .74, .76, .77, .79, .83], Q: [.94, .95, .95, .96, .955, .94],
    pareto: [["Mould change", 1650], ["Mould repair", 1420], ["Colour change", 1180], ["No material", 760], ["No plan", 540], ["Machine breakdown", 480]],
    shifts: [["A · 06–14", .70], ["B · 14–22", .68], ["C · 22–06", .62]],
    machines: [["M-01", .74, .84, .93], ["M-03", .85, .80, .95], ["M-05", .81, .76, .94], ["M-07", .89, .84, .95], ["M-09", .90, .87, .96], ["M-11", .87, .82, .94]],
    kpis: [K("QC lot rejects", "2 of 52", "3.8% of lots", "ok", "/qc"), K("Items below min", "4", "Raise POs", "danger", "/stock?status=RED"),
      K("Regrind usage", "14.1%", "Limit 20%", "ok", "/production"), K("On-time dispatch", "44 of 47", "93.6%", "warn", "/dispatch"),
      K("MTBF (plant)", "133 h", "Run h ÷ breakdowns", "neutral", "/maintenance"), K("MTTR (plant)", "55 min", "Repair min ÷ breakdowns", "neutral", "/maintenance"),
      K("PM compliance", "38 of 41", "92.7%", "warn", "/maintenance"), K("Returnables out", "102", "24 > 30 days", "danger", "/returnables")] },
];

export const METRIC_DEFS: Record<string, [string, string]> = {
  oee: ["OEE", "Overall Equipment Effectiveness = Availability × Performance × Quality. 85% is world-class; many shops run 50 to 65%."],
  Availability: ["Availability", "Run time ÷ planned time. Lost to breakdowns and changeovers."],
  Performance: ["Performance", "Actual output ÷ output at the standard cycle time. Lost to slow cycles and short stops."],
  Quality: ["Quality rate", "Good parts ÷ total parts made."],
  down: ["Downtime reasons", "Minutes lost by stop code — mould change, mould repair, machine breakdown, no material, no operator, no plan, power cut, QC hold, colour change, trial. Longest first."],
  mach: ["OEE by machine", "A × P × Q for each machine. Dot: green ≥ 75%, amber 60–75%, red below 60%."],
  shift: ["Shift", "A work period, usually 8 or 12 hours; data is booked per shift."],
  "QC lot rejects": ["QC lot rejects", "Inward lots rejected or deviated at QC ÷ lots received."],
  "Items below min": ["Items below min", "Stock items under their minimum level. Tap the tile to open them in Stores."],
  "Regrind usage": ["Regrind usage", "Regrind fed ÷ total resin fed. Each part grade has a maximum %."],
  "On-time dispatch": ["On-time dispatch", "Dispatches made on or before the customer due date."],
  "MTBF (plant)": ["MTBF", "Mean Time Between Failures — run hours ÷ number of breakdowns."],
  "MTTR (plant)": ["MTTR", "Mean Time To Repair — repair minutes ÷ number of breakdowns."],
  "PM compliance": ["PM compliance", "Preventive Maintenance on machines and moulds done on time ÷ PMs due."],
  "Returnables out": ["Returnables out", "Customer crates, pallets and trolleys issued but not yet returned."],
};
