import { DomainError } from "@/server/services/inventory";

// Order forms post their rows as repeated fields (itemId, qty, price, date), one of each per row, in row order.
export interface FormLine { itemId: string; qty: number; price?: number; date?: string }

export function readLines(f: FormData): FormLine[] {
  const ids = f.getAll("itemId").map(String);
  const qty = f.getAll("qty").map(String);
  const price = f.getAll("price").map(String);
  const date = f.getAll("date").map(String);
  return ids
    .map((itemId, i) => ({
      itemId, qty: Number(qty[i] ?? 0),
      price: price[i]?.trim() ? Number(price[i]) : undefined,
      date: date[i]?.trim() || undefined,
    }))
    .filter((l) => l.itemId);
}

/** A date field from a form as a UTC midnight Date, or undefined when blank or invalid. */
export function dateField(v: FormDataEntryValue | string | null | undefined): Date | undefined {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Rows of a price list posted as repeated fields: `<key>` (an id) and `price`, in row order. Blank rows are ignored; a row with an id but no price is an error. */
export function readPriceRows(f: FormData, key: "supplierId" | "itemId"): { id: string; price: number }[] {
  const ids = f.getAll(key).map(String);
  const prices = f.getAll("price").map(String);
  const rows: { id: string; price: number }[] = [];
  ids.forEach((id, i) => {
    if (!id) return;
    if ((prices[i] ?? "").trim() === "") throw new DomainError("Enter a price for every row, or remove the row.", ["price"]);
    rows.push({ id, price: Number(prices[i]) });
  });
  return rows;
}
