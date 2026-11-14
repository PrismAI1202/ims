"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { inputCls } from "@/components/flash";
import { itemType } from "@/lib/item-types";

// The supplier ↔ product price list, edited from either side. On an item it lists its suppliers (kind="supplier"); on a supplier it
// lists the products it supplies (kind="item"). Rows post as repeated `supplierId` / `itemId` and `price` fields, in row order,
// and a form that holds this component saves the whole list (see syncItemSuppliers and syncSupplierCatalogue).

export interface CatalogueOption { id: string; label: string; hint?: string; category?: string; unit?: string }
interface Row { key: number; id: string; price: string }

export function CatalogueRows({ kind, options, initial, unit, emptyNote, compact = false }: {
  kind: "supplier" | "item"; options: CatalogueOption[]; initial: { id: string; price: string }[];
  unit?: string; // "KG": the price is per this unit (an item's suppliers all share the item's unit)
  emptyNote?: string; compact?: boolean; // compact: tighter rows in a scrolling list, no hint line
}) {
  const [{ rows }, setState] = useState(() => ({ next: initial.length, rows: initial.map((r, i) => ({ key: i, id: r.id, price: r.price })) as Row[] }));
  const byId = new Map(options.map((o) => [o.id, o]));
  const taken = new Set(rows.map((r) => r.id).filter(Boolean));
  const noun = kind === "supplier" ? "supplier" : "product";
  const set = (key: number, patch: Partial<Row>) => setState((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const name = kind === "supplier" ? "supplierId" : "itemId";

  return (
    <div className="space-y-2.5">
      {rows.length === 0 && <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">{emptyNote ?? `No ${noun}s yet.`}</p>}
      <ol className={compact ? "max-h-[22rem] space-y-1.5 overflow-y-auto pr-1" : "space-y-2"}>
        {rows.map((r, i) => {
          const o = byId.get(r.id);
          const u = o?.unit ?? unit;
          return (
            <li key={r.key} className={`rounded-xl border border-border bg-canvas ${compact ? "px-2.5 py-2" : "p-3"}`}>
              <div className="grid items-start gap-x-3 gap-y-2 md:grid-cols-[2.75rem_minmax(0,1fr)_9rem_2rem]">
                {compact && o?.category ? (
                  <span className="hidden h-7 items-center justify-center rounded-md font-mono text-xs font-bold text-white md:mt-2.5 md:flex" style={{ background: itemType(o.category).color }} title={itemType(o.category).name}>{itemType(o.category).tag}</span>
                ) : (
                  <span className="hidden size-7 items-center justify-center rounded-full bg-ink font-mono text-xs font-bold text-white md:mt-2.5 md:flex" aria-hidden>{i + 1}</span>
                )}
                <label className="block min-w-0 text-[13px]">
                  <span className="text-xs text-ink-3 md:sr-only">{kind === "supplier" ? "Supplier" : "Product"}{compact && o?.category && <b className="ml-1.5 font-mono" style={{ color: itemType(o.category).color }}>{itemType(o.category).tag}</b>}</span>
                  <select name={name} value={r.id} onChange={(e) => set(r.key, { id: e.target.value })} className={`${inputCls} mt-1 md:mt-0`}>
                    <option value="">— choose a {noun} —</option>
                    {options.map((x) => <option key={x.id} value={x.id} disabled={taken.has(x.id) && x.id !== r.id}>{x.category ? `[${itemType(x.category).tag}] ` : ""}{x.label}{taken.has(x.id) && x.id !== r.id ? " (already listed)" : ""}</option>)}
                  </select>
                </label>
                <label className="block text-[13px]">
                  <span className="text-xs text-ink-3 md:sr-only">Price (₹{u ? ` per ${u}` : ""})</span>
                  <span className="relative mt-1 block md:mt-0">
                    <input name="price" type="number" min="0" step="any" inputMode="decimal" placeholder="Price ₹" value={r.price} onChange={(e) => set(r.key, { price: e.target.value })} className={`${inputCls} mt-0 pr-14`} />
                    {u && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3">/{u}</span>}
                  </span>
                </label>
                <button type="button" onClick={() => setState((s) => ({ ...s, rows: s.rows.filter((x) => x.key !== r.key) }))} aria-label={`Remove ${noun} ${i + 1}`}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-danger text-white hover:bg-[#8f1a10] md:mt-1.5">
                  <Minus size={16} strokeWidth={3} aria-hidden />
                </button>
              </div>
              {o?.hint && !compact && <p className="mt-1.5 text-xs text-ink-3 md:pl-[2.75rem]">{o.category && <span className="mr-1.5 font-mono font-bold" style={{ color: itemType(o.category).color }}>{itemType(o.category).tag}</span>}{o.hint}</p>}
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={() => setState((s) => ({ next: s.next + 1, rows: [...s.rows, { key: s.next, id: "", price: "" }] }))}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-ink-3 hover:border-accent hover:text-accent">
        <Plus size={18} aria-hidden /> Add {rows.length === 0 ? "a" : "another"} {noun}
      </button>
    </div>
  );
}
