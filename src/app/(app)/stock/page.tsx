import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { transferStock } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function transfer(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.transfer");
  await runAction("/stock", "Stock moved.", async () => {
    await transferStock({
      lotNumber: String(formData.get("lotNumber")).trim(),
      fromCode: String(formData.get("fromCode")).trim(),
      toCode: String(formData.get("toCode")).trim(),
      qty: Number(formData.get("qty")),
      userId: user.id,
    });
  });
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requirePermission("stock.view");
  const { error, ok } = await searchParams;
  const balances = await db.stockBalance.findMany({
    where: { qty: { gt: 0 } },
    include: { lot: { include: { item: true } }, location: true },
    orderBy: [{ location: { code: "asc" } }, { lot: { receivedAt: "asc" } }],
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Stock &amp; Bins</h1>
      <Flash error={error} ok={ok} />

      {can(user.role, "stock.transfer") && (
        <form action={transfer} className="grid max-w-4xl gap-3 rounded-lg border bg-white p-4 md:grid-cols-5">
          <label className="text-sm">Lot no.<input name="lotNumber" required placeholder="scan lot" className={inputCls} /></label>
          <label className="text-sm">From bin<input name="fromCode" required placeholder="scan bin" className={inputCls} /></label>
          <label className="text-sm">To bin<input name="toCode" required placeholder="scan bin" className={inputCls} /></label>
          <label className="text-sm">Qty<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
          <div className="flex items-end"><button className={btnCls}>Transfer</button></div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">Bin</th><th className="p-2">Item</th><th className="p-2">Lot</th>
            <th className="p-2">Heat / mfr lot</th><th className="p-2">QC</th><th className="p-2 text-right">Qty</th>
          </tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="p-2 font-medium">{b.location.code}{b.location.type === "STAGING" && " (staging)"}</td>
                <td className="p-2">{b.lot.item.code}</td>
                <td className="p-2">{b.lot.lotNumber}</td>
                <td className="p-2">{b.lot.supplierLotNo}</td>
                <td className="p-2">{b.lot.qcStatus}</td>
                <td className="p-2 text-right">{Number(b.qty).toLocaleString()} {b.lot.item.uom}</td>
              </tr>
            ))}
            {balances.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>No stock in any bin yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
