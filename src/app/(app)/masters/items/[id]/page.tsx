import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { btnCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { Card, Eyebrow, Mono, PageHeader } from "@/components/ui";
import { addSupplierPrice, dropSupplierPrice, saveItem } from "../../actions";
import { ItemFields } from "../../item-fields";

export const instant = false;

export default async function EditItem({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireView("masters");
  const [{ id }, { error, ok }] = await Promise.all([params, searchParams]);
  const item = await db.item.findUnique({ where: { id } });
  if (!item) notFound();
  const bought = item.category !== "FG" && item.category !== "REGRIND";
  const [prices, suppliers] = bought ? await Promise.all([
    db.priceMaster.findMany({ where: { itemId: id }, include: { supplier: true }, orderBy: { price: "asc" } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]) : [[], []];

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="ADMIN · MASTERS" title={`Edit ${item.code}`} subtitle={item.name}>
        <Link href="/masters?tab=items" className="text-sm font-semibold">← Items</Link>
      </PageHeader>
      <Flash error={error} ok={ok} />
      <Card>
        <form action={saveItem} className="space-y-4">
          <input type="hidden" name="id" value={item.id} />
          <ItemFields d={{
            code: item.code, name: item.name, category: item.category, uom: item.uom, polymerGrade: item.polymerGrade,
            minStock: Number(item.minStock), reorderPoint: Number(item.reorderPoint), maxStock: Number(item.maxStock),
            safetyStock: Number(item.safetyStock), shelfLifeDays: item.shelfLifeDays, requiresCoa: item.requiresCoa,
            maxRegrindPct: item.maxRegrindPct === null ? null : Number(item.maxRegrindPct),
            stockTracked: item.stockTracked, hsnCode: item.hsnCode, unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
          }} />
          <button className={`${btnCls} w-full md:w-auto`}>Save changes</button>
        </form>
      </Card>

      {bought && (
        <Card className="space-y-3">
          <div>
            <Eyebrow>SUPPLIERS &amp; PRICES</Eyebrow>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">Who you buy this from, and at what price. MRP suggests POs to the cheapest supplier listed here, and &ldquo;Raise PO&rdquo; starts from it. With none, the item is still tracked in Stores but has to be ordered by hand.</p>
          </div>
          {prices.length === 0 && <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">No supplier yet: MRP can&apos;t suggest a PO for this item.</p>}
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {prices.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="flex flex-col"><span className="text-sm font-semibold">{p.supplier.name}{i === 0 && prices.length > 1 && <span className="ml-2 text-xs font-normal text-ok-ink">cheapest</span>}</span><span className="text-xs text-ink-3">Lead time {p.supplier.leadTimeDays} days{p.supplier.active ? "" : " · inactive"}</span></span>
                <span className="flex items-center gap-3">
                  <Mono className="text-sm">₹{Number(p.price).toLocaleString("en-IN")} / {item.uom}</Mono>
                  <form action={dropSupplierPrice}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="supplierId" value={p.supplierId} /><button className="min-h-9 cursor-pointer text-xs font-semibold text-danger">Remove</button></form>
                </span>
              </li>
            ))}
          </ul>
          <form action={addSupplierPrice} className="grid items-end gap-3 rounded-xl border-2 border-dashed border-border p-3 sm:grid-cols-[1fr_9rem_auto]">
            <input type="hidden" name="itemId" value={item.id} />
            <label className="text-[13px]">Add or change a supplier
              <select name="supplierId" required className={inputCls}><option value="">— choose —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label className="text-[13px]">Price (₹ / {item.uom})<input name="price" type="number" min="0" step="any" required className={inputCls} /></label>
            <button className={btnSecondaryCls}>Save price</button>
          </form>
        </Card>
      )}
    </div>
  );
}
