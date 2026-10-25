/** Builds "/path?a=1&b=2", skipping empty values. Used by list filters so they keep each other's settings. */
export function href(path: string, params: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Case-insensitive "does any of these fields contain every word of the query". */
export function matches(query: string | undefined, ...fields: (string | number | null | undefined)[]): boolean {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.map((f) => String(f ?? "").toLowerCase()).join(" ");
  return words.every((w) => hay.includes(w));
}
