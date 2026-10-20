import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createPurchaseOrder } from "@/server/services/inventory";
import { cancelPurchaseOrder, closePurchaseOrderShort } from "@/server/services/purchase";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;
const PO_LINES = 4;

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order created and approved.", async () => {
    const lines = Array.from({ length: PO_LINES }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), qty: Number(formData.get(`qty_${i}`) || 0),
    })).filter((l) => l.itemId);
    await createPurchaseOrder({
      supplierId: String(formData.get("supplierId")),
      segment: formData.get("segment") === "AUTOMOTIVE" ? "AUTOMOTIVE" : "NON_AUTOMOTIVE",
      lines, userId: user.id,
    });
  });
}

async function cancel(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order cancelled.", async () => { await cancelPurchaseOrder(String(formData.get("id"))); });
}

async function closeShort(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order closed. The balance is no longer expected.", async () => { await closePurchaseOrderShort(String(formData.get("id"))); });
}

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("po.manage");
  const { error, ok } = await searchParams;
  const [suppliers, items, pos] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { active: true, category: { notIn: ["FG", "REGRIND"] } }, orderBy: { code: "asc" } }),
    db.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" }, take: 30,
      include: { supplier: true, lines: { include: { item: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Purchase Orders</h1>
      <Flash error={error} ok={ok} />
      <form action={create} className="max-w-3xl space-y-3 rounded-lg border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Supplier
            <select name="supplierId" required className={inputCls}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="text-sm">Segment
            <select name="segment" className={inputCls}><option value="NON_AUTOMOTIVE">Non-automotive</option><option value="AUTOMOTIVE">Automotive (COA required at GRN)</option></select>
          </label>
        </div>
        {Array.from({ length: PO_LINES }, (_, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-4">
            <select name={`item_${i}`} className={`${inputCls} md:col-span-3`} aria-label={`Item ${i + 1}`}>
              <option value="">— item {i + 1} —</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
            </select>
            <input name={`qty_${i}`} type="number" step="any" min="0" placeholder="Qty" className={inputCls} aria-label={`Quantity ${i + 1}`} />
          </div>
        ))}
        <p className="text-xs text-slate-500">Prices come from the price master; you can edit them after creating.</p>
        <button className={btnCls}>Create &amp; approve PO</button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">PO</th><th className="p-2">Supplier</th><th className="p-2">Segment</th><th className="p-2">Lines (received / ordered)</th><th className="p-2">Status</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {pos.map((p) => {
              const untouched = p.lines.every((l) => Number(l.receivedQty) === 0);
              return (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-2 font-medium">{p.poNumber}</td>
                  <td className="p-2">{p.supplier.name}</td>
                  <td className="p-2">{p.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto"}</td>
                  <td className="p-2">{p.lines.map((l) => <div key={l.id}>{l.item.code}: {Number(l.receivedQty)}/{Number(l.qty)} {l.item.uom} @ {Number(l.price)}</div>)}</td>
                  <td className="p-2">{p.status}</td>
                  <td className="p-2">
                    <div className="flex gap-3">
                      {untouched && p.status === "APPROVED" && <Link className="text-xs underline" href={`/purchase/${p.id}`}>Edit</Link>}
                      {untouched && p.status === "APPROVED" && (
                        <form action={cancel}><input type="hidden" name="id" value={p.id} /><button className="text-xs text-red-700 underline">Cancel</button></form>
                      )}
                      {p.status === "PARTIAL" && (
                        <form action={closeShort}><input type="hidden" name="id" value={p.id} /><button className="text-xs underline">Close short</button></form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {pos.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>No purchase orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
