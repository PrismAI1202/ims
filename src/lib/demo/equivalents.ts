// Sample equivalent-group data from the Claude Design example. Display only.

export type EqGrade = { grade: string; vendor: string; auto: boolean; stock: number; lead: string; evidence: string };
export type EqGroup = { code: string; name: string; unit: string; qty: number; min: number; used: string[]; spec: string[]; grades: EqGrade[]; warn?: string };

const G = (grade: string, vendor: string, auto: boolean, stock: number, lead: string, evidence: string): EqGrade => ({ grade, vendor, auto, stock, lead, evidence });

export const EQ_GROUPS: EqGroup[] = [
  { code: "EQ-RM-014", name: "PP Homopolymer MFI 12", unit: "kg", qty: 1840, min: 2000, used: ["DT-220", "CP-08"], spec: ["MFI 11–13 g/10min", "ρ 0.900–0.910", "H₂O ≤ 0.05%"],
    grades: [G("Grade H110", "Vendor A", true, 880, "7 d", "COA + PPAP · 3 photos"), G("Grade PH-12N", "Vendor B", true, 550, "12 d", "Trial report · 2 photos"), G("Grade 1200MC", "Vendor C", false, 410, "4 d", "Datasheet · 1 photo")] },
  { code: "EQ-RM-021", name: "ABS natural", unit: "kg", qty: 2900, min: 1000, used: ["HX-14"], spec: ["MFI 18–24 g/10min", "Izod ≥ 20 kJ/m²", "H₂O ≤ 0.1%"],
    grades: [G("AB-NT-20", "Vendor A", true, 1900, "7 d", "COA + trial · 2 photos"), G("ABS-750", "Vendor B", true, 1000, "12 d", "Trial report · 1 photo")] },
  { code: "EQ-RM-030", name: "PA66 GF30", unit: "kg", qty: 1150, min: 800, used: ["BZ-31"], spec: ["30% glass", "Tensile ≥ 170 MPa", "Dry to ≤ 0.2%"],
    grades: [G("PA-G30", "Vendor A", true, 700, "9 d", "PPAP · 4 photos"), G("A3-GF30", "Vendor B", true, 450, "14 d", "PPAP · 3 photos")] },
  { code: "EQ-RM-040", name: "POM copolymer", unit: "kg", qty: 650, min: 400, used: ["HS-40"], spec: ["MFI 8–10 g/10min", "ρ 1.41", "H₂O ≤ 0.2%"],
    grades: [G("POM-C27", "Vendor A", false, 650, "10 d", "PPAP pending · 2 photos")],
    warn: "Single source and not yet auto-approved — add a second grade before HS-40 goes to series production." },
  { code: "EQ-MB-002", name: "Black masterbatch 40%", unit: "kg", qty: 310, min: 100, used: ["DT-220", "BZ-31", "HS-40"], spec: ["Carbon 40%", "Carrier PP", "ΔE ≤ 1.0 vs master"],
    grades: [G("BK-4021", "Vendor D", true, 260, "5 d", "Colour plaque · 2 photos"), G("CB-40", "Vendor E", true, 50, "6 d", "Colour plaque · 1 photo")] },
  { code: "EQ-BOP-003", name: "Brass insert M4 knurled", unit: "pc", qty: 12000, min: 40000, used: ["DT-220", "HS-40"], spec: ["M4 × 6 mm", "CuZn39Pb3", "Pull-out ≥ 900 N"],
    grades: [G("INS-M4-K", "Vendor F", true, 12000, "10 d", "PPAP · 3 photos"), G("M4-BR-06", "Vendor G", false, 0, "14 d", "PPAP pending · 1 photo")] },
];

/** Colours for each vendor grade segment of a group's stock bar. */
export const EQ_COLORS = ["#1D4ED8", "#6E95E8", "#E98A3E"];
