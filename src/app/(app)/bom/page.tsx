import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { DomainError } from "@/server/services/inventory";
import { isBlend, kindForCategory, type BomLineInput } from "@/server/services/bom-math";
import { saveBom } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

const ROWS = 8;
const BOM_CATEGORIES = ["RM_RESIN", "RM_MASTERBATCH", "REGRIND", "BOP", "PACKAGING"] as const;
const GROUP_LABEL: Record<string, string> = {
  RM_RESIN: "Resin (% by weight)", RM_MASTERBATCH: "Masterbatch (% by weight)", REGRIND: "Regrind (% by weight)",
  BOP: "Inserts / bought-out (qty per part)", PACKAGING: "Packaging (qty per good part)",
};

async function save(formData: FormData) {
  "use server";
  await requirePermission("bom.manage");
  await runAction("/bom", "BOM saved.", async () => {
    const wanted = Array.from({ length: ROWS }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), value: Number(formData.get(`value_${i}`) || 0),
    })).filter((r) => r.itemId);
    const items = await db.item.findMany({ where: { id: { in: wanted.map((w) => w.itemId) } } });
    const lines: BomLineInput[] = wanted.map((w) => {
      const kind = kindForCategory(items.find((i) => i.id === w.itemId)?.category ?? "");
      if (!kind) throw new DomainError("That item type can't be used in a BOM.");
      return isBlend(kind) ? { itemId: w.itemId, kind, pct: w.value } : { itemId: w.itemId, kind, qtyPerPart: w.value };
    });
    await saveBom({
      fgItemId: String(formData.get("fgItemId")), mouldId: String(formData.get("mouldId")),
      partWeightG: Number(formData.get("partWeightG")), lines,
    });
  }, "/bom");
}

export default async function BomPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; edit?: string }> }) {
  await requirePermission("bom.manage");
  const { error, ok, edit } = await searchParams;
  const [fgItems, items, moulds, boms] = await Promise.all([
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    db.item.findMany({ where: { category: { in: [...BOM_CATEGORIES] }, active: true }, orderBy: { code: "asc" } }),
    db.mould.findMany({ orderBy: { code: "asc" } }),
    db.bom.findMany({
      orderBy: { createdAt: "desc" },
      include: { fgItem: true, mould: true, lines: { include: { item: true } } },
    }),
  ]);
  const editing = edit ? boms.find((b) => b.id === edit) : undefined;
  const byCat = (c: string) => items.filter((i) => i.category === c);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Moulding BOM</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        One BOM per finished part. Resin + masterbatch + regrind must add up to 100% by weight, and regrind can&apos;t exceed the resin&apos;s max-regrind limit.
        Saving a part that already has a BOM replaces it.
      </p>
      <Flash error={error} ok={ok} />
      {fgItems.length === 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          No finished-goods items yet. Add one in Masters → Items with category FG.
        </p>
      )}

      <form key={editing?.id ?? "new"} action={save} className="max-w-4xl space-y-4 rounded-lg border bg-white p-4">
        <h2 className="font-medium">{editing ? `Edit BOM for ${editing.fgItem.code}` : "New BOM"}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Finished part
            <select name="fgItemId" required defaultValue={editing?.fgItemId} className={inputCls}>
              {fgItems.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Mould
            <select name="mouldId" required defaultValue={editing?.mouldId} className={inputCls}>
              {moulds.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.cavities}-cavity</option>)}
            </select>
          </label>
          <label className="text-sm">Net part weight (g)
            <input name="partWeightG" type="number" step="any" min="0" required defaultValue={editing ? Number(editing.partWeightG) : undefined} className={inputCls} />
          </label>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Materials <span className="font-normal text-slate-500">(% for resin, masterbatch and regrind; quantity per part for inserts and packaging)</span></div>
          {Array.from({ length: ROWS }, (_, i) => {
            const l = editing?.lines[i];
            const v = l ? Number(l.pct ?? l.qtyPerPart) : undefined;
            return (
              <div key={i} className="grid gap-2 md:grid-cols-4">
                <select name={`item_${i}`} defaultValue={l?.itemId ?? ""} className={`${inputCls} md:col-span-3`} aria-label={`Material ${i + 1}`}>
                  <option value="">— none —</option>
                  {BOM_CATEGORIES.map((c) => (
                    <optgroup key={c} label={GROUP_LABEL[c]}>
                      {byCat(c).map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input name={`value_${i}`} type="number" step="any" min="0" defaultValue={v} placeholder="% or qty" className={inputCls} aria-label={`Value ${i + 1}`} />
              </div>
            );
          })}
        </div>
        <button className={btnCls} disabled={fgItems.length === 0}>Save BOM</button>
      </form>

      <div className="space-y-3">
        {boms.map((b) => (
          <div key={b.id} className="max-w-4xl rounded-lg border bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium">{b.fgItem.code} · {b.fgItem.name}
                <span className="ml-2 font-normal text-slate-500">{b.mould.code} · {b.mould.cavities} cav · {Number(b.partWeightG)} g/part</span></div>
              <a href={`/bom?edit=${b.id}`} className="text-xs underline">Edit</a>
            </div>
            <ul className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
              {b.lines.map((l) => (
                <li key={l.id}>
                  <span className="text-slate-500">{l.kind}</span> {l.item.code} —{" "}
                  <b>{l.pct !== null ? `${Number(l.pct)}%` : `${Number(l.qtyPerPart)} ${l.item.uom}/part`}</b>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {boms.length === 0 && <p className="text-sm text-slate-500">No BOMs yet.</p>}
      </div>
    </div>
  );
}
