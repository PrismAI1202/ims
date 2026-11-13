"use client";

import { useState } from "react";
import { btnCls, btnSecondaryCls, inputCls } from "@/components/flash";
import type { BomItem } from "@/components/bom-form";

// "Not in the list?": adds a new part or material from inside the BOM editor. It is deliberately not a <form> (it sits inside the
// BOM form) and its inputs have no names, so nothing here posts with the BOM. Creating it calls /api/v1/items, which also records
// the stock levels and the supplier price, so the item is tracked in Stores and can be ordered from the moment it exists.

export const NEW_TYPES = [
  { cat: "RM_RESIN", label: "Resin", uom: "KG", bought: true },
  { cat: "RM_MASTERBATCH", label: "Masterbatch", uom: "KG", bought: true },
  { cat: "REGRIND", label: "Regrind", uom: "KG", bought: false },
  { cat: "BOP", label: "Insert / bought-out", uom: "NOS", bought: true },
  { cat: "PACKAGING", label: "Packaging", uom: "NOS", bought: true },
  { cat: "FG", label: "Finished part", uom: "NOS", bought: false },
] as const;

export function NewItemCard({ cat: startCat, lockType, suppliers, onCreated, onCancel }: {
  cat: string; lockType?: boolean; suppliers: { id: string; name: string }[];
  onCreated: (item: BomItem) => void; onCancel: () => void;
}) {
  const [cat, setCat] = useState(startCat);
  const type = NEW_TYPES.find((t) => t.cat === cat) ?? NEW_TYPES[0];
  const [v, setV] = useState({ code: "", name: "", uom: "", grade: "", maxRegrind: "", min: "", rop: "", max: "", supplierId: "", price: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const f = "block text-xs";
  const inp = `${inputCls} mt-1 min-h-10`;

  async function create() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/items", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: v.code, name: v.name, category: cat, uom: v.uom || type.uom, polymerGrade: v.grade, maxRegrindPct: cat === "RM_RESIN" ? v.maxRegrind : "",
          minStock: v.min || 0, reorderPoint: v.rop || 0, maxStock: v.max || 0,
          ...(type.bought && v.supplierId ? { supplierId: v.supplierId, price: v.price } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't create it.");
      onCreated({ ...body.item, polymerGrade: body.item.polymerGrade ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create it.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-dashed border-accent bg-white p-3.5" role="group" aria-label="New item">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-sm font-bold">New {type.label.toLowerCase()}</span>
        <span className="text-xs text-ink-3">Added to the item master, so it also shows in Stores and the PO form.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!lockType && (
          <label className={f}>Type
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={inp}>{NEW_TYPES.map((t) => <option key={t.cat} value={t.cat}>{t.label}</option>)}</select>
          </label>
        )}
        <label className={f}>Code<input value={v.code} onChange={set("code")} maxLength={30} placeholder="e.g. RM-PA6-GF30" autoCapitalize="characters" className={inp} /></label>
        <label className={`${f} sm:col-span-2`}>Name<input value={v.name} onChange={set("name")} className={inp} /></label>
        <label className={f}>Unit<input value={v.uom} onChange={set("uom")} placeholder={type.uom} maxLength={10} className={inp} /></label>
        {(cat === "RM_RESIN" || cat === "REGRIND") && <label className={f}>Polymer grade<input value={v.grade} onChange={set("grade")} placeholder="PP, ABS, PA6…" className={inp} /></label>}
        {cat === "RM_RESIN" && <label className={f}>Max regrind %<input value={v.maxRegrind} onChange={set("maxRegrind")} type="number" min="0" max="100" step="any" placeholder="e.g. 20" className={inp} /></label>}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-ink-3">Stock levels: Stores flags it red below Min, and suggests a PO at the reorder point</p>
        <div className="grid grid-cols-3 gap-3 sm:max-w-md">
          <label className={f}>Min<input value={v.min} onChange={set("min")} type="number" min="0" step="any" placeholder="0" className={inp} /></label>
          <label className={f}>Reorder point<input value={v.rop} onChange={set("rop")} type="number" min="0" step="any" placeholder="0" className={inp} /></label>
          <label className={f}>Max<input value={v.max} onChange={set("max")} type="number" min="0" step="any" placeholder="0" className={inp} /></label>
        </div>
      </div>

      {type.bought && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-3">Who you buy it from <span className="font-normal">(optional, but needed for MRP to suggest a PO)</span></p>
          <div className="grid gap-3 sm:max-w-xl sm:grid-cols-[1fr_9rem]">
            <label className={f}>Supplier
              <select value={v.supplierId} onChange={set("supplierId")} className={inp}><option value="">— none yet —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label className={f}>Buying price (₹)<input value={v.price} onChange={set("price")} type="number" min="0" step="any" disabled={!v.supplierId} className={inp} /></label>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={create} disabled={busy || !v.code.trim() || !v.name.trim()} className={`${btnCls} disabled:opacity-50`}>{busy ? "Creating…" : `Create ${type.label.toLowerCase()}`}</button>
        <button type="button" onClick={onCancel} className={btnSecondaryCls}>Cancel</button>
      </div>
    </div>
  );
}
