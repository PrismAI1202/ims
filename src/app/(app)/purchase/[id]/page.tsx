import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { updatePurchaseOrder } from "@/server/services/purchase";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Badge, Card, PageHeader } from "@/components/ui";

export const instant = false;
const ROWS = 6;

async function save(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  const id = String(formData.get("id"));
  await runAction("/purchase", "Purchase order updated.", async () => {
    const lines = Array.from({ length: ROWS }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), qty: Number(formData.get(`qty_${i}`) || 0),
      price: Number(formData.get(`price_${i}`) || 0), date: String(formData.get(`date_${i}`) || ""),
    })).filter((l) => l.itemId).map((l) => ({
      itemId: l.itemId, qty: l.qty, price: l.price, expectedDate: l.date ? new Date(`${l.date}T00:00:00.000Z`) : undefined,
    }));
    await updatePurchaseOrder(id, lines);
  }, `/purchase/${id}`);
}

export default async function EditPo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requirePermission("po.manage");
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, lines: { include: { item: true } } } });
  if (!po) notFound();
  const items = await db.item.findMany({ where: { active: true, category: { notIn: ["FG", "REGRIND"] } }, orderBy: { code: "asc" } });
  const locked = po.status !== "APPROVED" || po.lines.some((l) => Number(l.receivedQty) > 0);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`BUY & RECEIVE · ${po.supplier.name.toUpperCase()}`} title={po.poNumber} right={<Badge tone="info">{po.status}</Badge>}>
        <Link href="/purchase" className="text-sm font-semibold">← Supplier POs</Link>
      </PageHeader>
      <Flash error={error} />
      {locked && <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">This order can no longer be edited (goods have been received, or it is {po.status.toLowerCase()}).</p>}
      <Card>
        <form action={save} className="space-y-2">
          <input type="hidden" name="id" value={po.id} />
          <div className="hidden gap-2 text-xs font-semibold text-ink-3 md:grid md:grid-cols-6"><span className="md:col-span-3">Item</span><span>Qty</span><span>Price</span><span>Expected</span></div>
          {Array.from({ length: ROWS }, (_, i) => {
            const l = po.lines[i];
            return (
              <div key={i} className="grid gap-2 md:grid-cols-6">
                <select name={`item_${i}`} defaultValue={l?.itemId ?? ""} disabled={locked} className={`${inputCls} md:col-span-3`} aria-label={`Item ${i + 1}`}>
                  <option value="">— none —</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
                </select>
                <input name={`qty_${i}`} type="number" step="any" min="0" defaultValue={l ? Number(l.qty) : undefined} disabled={locked} className={inputCls} aria-label={`Quantity ${i + 1}`} />
                <input name={`price_${i}`} type="number" step="any" min="0" defaultValue={l ? Number(l.price) : undefined} disabled={locked} className={inputCls} aria-label={`Price ${i + 1}`} />
                <input name={`date_${i}`} type="date" defaultValue={l?.expectedDate?.toISOString().slice(0, 10)} disabled={locked} className={inputCls} aria-label={`Expected date ${i + 1}`} />
              </div>
            );
          })}
          <button className={`${btnCls} w-full disabled:opacity-50 md:w-auto`} disabled={locked}>Save changes</button>
        </form>
      </Card>
    </div>
  );
}
