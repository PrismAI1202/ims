// Where a customer order stands, from its quantity, what has shipped and its due date. One rule for the timeline, the list and the tests.

export type Standing = "open" | "part" | "overdue" | "shipped" | "forecast";

export interface StandingInput { type: "FIRM" | "SPOT" | "FORECAST"; qty: number; shipped: number; due: string }

export const standingOf = (l: StandingInput, today: string): Standing =>
  l.type === "FORECAST" ? "forecast" : l.shipped >= l.qty ? "shipped" : l.due < today ? "overdue" : l.shipped > 0 ? "part" : "open";

export const STANDING: Record<Standing, { label: string; bg: string; fg: string; ring: string }> = {
  open: { label: "Open", bg: "#1D4ED8", fg: "#fff", ring: "#1D4ED8" },
  part: { label: "Part shipped", bg: "#1D4ED8", fg: "#fff", ring: "#1D4ED8" },
  overdue: { label: "Overdue", bg: "#B42318", fg: "#fff", ring: "#B42318" },
  shipped: { label: "Shipped", bg: "#1E7A46", fg: "#fff", ring: "#1E7A46" },
  forecast: { label: "Forecast", bg: "#fff", fg: "#585C63", ring: "#8A8F98" },
};
