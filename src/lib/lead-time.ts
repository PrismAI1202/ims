// Day arithmetic on ISO dates (YYYY-MM-DD) for lead times and need-by dates. Pure and timezone-free: dates are read as UTC midnights.

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** Earliest delivery on a supplier's normal lead time, counted from today. */
export const earliestDelivery = (today: string, leadTimeDays: number) => addDays(today, leadTimeDays);

/** Is the wanted date inside the supplier's lead time (so the supplier would have to expedite)? */
export const isExpedite = (today: string, leadTimeDays: number, wanted: string) => wanted < earliestDelivery(today, leadTimeDays);

export const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
