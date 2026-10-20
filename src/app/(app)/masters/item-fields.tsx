import { ITEM_CATEGORIES } from "@/lib/schemas/masters";
import { inputCls } from "@/components/flash";

type Defaults = {
  code?: string; name?: string; category?: string; uom?: string; polymerGrade?: string | null;
  minStock?: number; reorderPoint?: number; maxStock?: number; safetyStock?: number;
  shelfLifeDays?: number | null; requiresCoa?: boolean; maxRegrindPct?: number | null;
  hsnCode?: string | null; unitPrice?: number | null; stockTracked?: boolean;
};

// Shared by the create form and the edit page so both validate the same fields.
export function ItemFields({ d = {} }: { d?: Defaults }) {
  const f = "text-sm";
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <label className={f}>Code<input name="code" required defaultValue={d.code} className={inputCls} /></label>
      <label className={`${f} md:col-span-2`}>Name<input name="name" required defaultValue={d.name} className={inputCls} /></label>
      <label className={f}>Category
        <select name="category" defaultValue={d.category ?? "RM_RESIN"} className={inputCls}>
          {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
      </label>
      <label className={f}>UOM<input name="uom" required defaultValue={d.uom ?? "KG"} className={inputCls} /></label>
      <label className={f}>Polymer grade<input name="polymerGrade" defaultValue={d.polymerGrade ?? ""} placeholder="PP, ABS…" className={inputCls} /></label>
      <label className={f}>Min stock<input name="minStock" type="number" step="any" min="0" required defaultValue={d.minStock ?? 0} className={inputCls} /></label>
      <label className={f}>Reorder point (ROP)<input name="reorderPoint" type="number" step="any" min="0" required defaultValue={d.reorderPoint ?? 0} className={inputCls} /></label>
      <label className={f}>Max stock<input name="maxStock" type="number" step="any" min="0" required defaultValue={d.maxStock ?? 0} className={inputCls} /></label>
      <label className={f}>Safety stock<input name="safetyStock" type="number" step="any" min="0" defaultValue={d.safetyStock ?? 0} className={inputCls} /></label>
      <label className={f}>Shelf life (days)<input name="shelfLifeDays" type="number" min="1" defaultValue={d.shelfLifeDays ?? ""} className={inputCls} /></label>
      <label className={f}>Max regrind %<input name="maxRegrindPct" type="number" step="any" min="0" max="100" defaultValue={d.maxRegrindPct ?? ""} className={inputCls} /></label>
      <label className={f}>HSN code<input name="hsnCode" inputMode="numeric" defaultValue={d.hsnCode ?? ""} placeholder="for challan / e-way bill" className={inputCls} /></label>
      <label className={f}>Unit price (selling)<input name="unitPrice" type="number" step="any" min="0" defaultValue={d.unitPrice ?? ""} className={inputCls} /></label>
      <label className={`${f} flex items-end gap-2 pb-2`}>
        <input name="requiresCoa" type="checkbox" defaultChecked={d.requiresCoa} className="h-4 w-4" /> COA required at GRN
      </label>
      <label className={`${f} flex items-end gap-2 pb-2 md:col-span-2`}>
        <input name="stockTracked" type="checkbox" defaultChecked={d.stockTracked} className="h-4 w-4" /> Returnable containers we own: track their stock (leave off for customer-owned)
      </label>
    </div>
  );
}
