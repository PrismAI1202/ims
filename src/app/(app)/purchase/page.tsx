import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createPurchaseOrder } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order created and approved.", async () => {
    await createPurchaseOrder({
      supplierId: String(formData.get("supplierId")),
      segment: formData.get("segment") === "AUTOMOTIVE" ? "AUTOMOTIVE" : "NON_AUTOMOTIVE",
      lines: [{ itemId: String(formData.get("itemId")), qty: Number(formData.get("qty")) }],
      userId: user.id,
    });
  });
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
      <form action={create} className="grid max-w-3xl grid-cols-1 gap-3 rounded-lg border bg-white p-4 md:grid-cols-5">
        <label className="text-sm">Supplier
          <select name="supplierId" required className={inputCls}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Segment
          <select name="segment" className={inputCls}>
            <option value="NON_AUTOMOTIVE">Non-automotive</option>
            <option value="AUTOMOTIVE">Automotive</option>
          </select>
        </label>
        <label className="text-sm md:col-span-2">Item
          <select name="itemId" required className={inputCls}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Qty
          <input name="qty" type="number" step="any" min="0" required className={inputCls} />
        </label>
        <div className="md:col-span-5"><button className={btnCls}>Create &amp; approve PO</button></div>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">PO</th><th className="p-2">Supplier</th><th className="p-2">Segment</th>
            <th className="p-2">Lines</th><th className="p-2">Status</th>
          </tr></thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2 font-medium">{p.poNumber}</td>
                <td className="p-2">{p.supplier.name}</td>
                <td className="p-2">{p.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto"}</td>
                <td className="p-2">{p.lines.map((l) => `${l.item.code}: ${Number(l.receivedQty)}/${Number(l.qty)} ${l.item.uom}`).join(", ")}</td>
                <td className="p-2">{p.status}</td>
              </tr>
            ))}
            {pos.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No purchase orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
