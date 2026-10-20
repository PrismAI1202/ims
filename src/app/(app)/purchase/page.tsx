import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createPurchaseOrder } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

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
    <div className="space-y-4">
      <PageHeader eyebrow="PURCHASE" title="Supplier POs" />
      <Flash error={error} ok={ok} />
      <Card className="space-y-3">
        <Eyebrow>RAISE PURCHASE ORDER</Eyebrow>
        <form action={create} className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <label className="text-[13px]">Supplier
            <select name="supplierId" required className={inputCls}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-[13px]">Segment
            <select name="segment" className={inputCls}>
              <option value="NON_AUTOMOTIVE">Non-automotive</option>
              <option value="AUTOMOTIVE">Automotive</option>
            </select>
          </label>
          <label className="text-[13px] md:col-span-2">Item
            <select name="itemId" required className={inputCls}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
            </select>
          </label>
          <label className="text-[13px]">Qty
            <input name="qty" type="number" step="any" min="0" required className={inputCls} />
          </label>
          <div className="md:col-span-5"><button className={`${btnCls} w-full md:w-auto`}>Create &amp; approve PO</button></div>
        </form>
      </Card>

      <Eyebrow>SUPPLIER POs</Eyebrow>
      <DataTable>
        <thead><tr>
          <th>PO</th><th>Supplier</th><th>Segment</th><th>Lines</th><th>Status</th>
        </tr></thead>
        <tbody>
          {pos.map((p) => (
            <tr key={p.id}>
              <td className="font-semibold"><Mono>{p.poNumber}</Mono></td>
              <td>{p.supplier.name}</td>
              <td><Badge tone={p.segment === "AUTOMOTIVE" ? "info" : "neutral"}>{p.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto"}</Badge></td>
              <td><Mono className="text-xs">{p.lines.map((l) => `${l.item.code}: ${Number(l.receivedQty)}/${Number(l.qty)} ${l.item.uom}`).join(", ")}</Mono></td>
              <td><Badge tone={p.status === "APPROVED" || p.status === "PARTIAL" ? "info" : "neutral"}>{p.status}</Badge></td>
            </tr>
          ))}
          {pos.length === 0 && <tr><td className="text-ink-3" colSpan={5}>No purchase orders yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
  );
}
