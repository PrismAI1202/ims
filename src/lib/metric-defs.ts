// Plain-language definitions shown in the Metrics info tips.

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
  Dispatches: ["Dispatches", "Loads completed and shipped in the period."],
  "MTBF (plant)": ["MTBF", "Mean Time Between Failures — run hours ÷ number of breakdowns."],
  "MTTR (plant)": ["MTTR", "Mean Time To Repair — repair minutes ÷ number of breakdowns."],
  "PM compliance": ["PM compliance", "Preventive Maintenance on machines and moulds done on time ÷ PMs due."],
  "Returnables out": ["Returnables out", "Customer crates, pallets and trolleys issued but not yet returned."],
};
