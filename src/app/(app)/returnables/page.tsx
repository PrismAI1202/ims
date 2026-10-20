import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { recordReturnable, returnableBalances } from "@/server/services/dispatch";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function record(formData: FormData) {
  "use server";
  const user = await requirePermission("dispatch.manage");
  const move = String(formData.get("move")) === "ISSUED" ? "ISSUED" : "RETURNED";
  await runAction("/returnables", move === "RETURNED" ? "Return recorded." : "Opening balance / issue recorded.", async () => {
    await recordReturnable({
      customerId: String(formData.get("customerId")), itemId: String(formData.get("itemId")), move,
      qty: Number(formData.get("qty")), note: String(formData.get("note") || "") || undefined, userId: user.id,
    });
  });
}

export default async function ReturnablesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("dispatch.manage");
  const { error, ok } = await searchParams;
  const [balances, customers, items, recent] = await Promise.all([
    returnableBalances(),
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { category: "RETURNABLE", active: true }, orderBy: { code: "asc" } }),
    db.returnableLedger.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { customer: true, item: true, dispatch: true } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Returnable Packaging Ledger</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Crates, trolleys and pallets owned by us (or the customer) that travel with dispatches. Balance = issued − returned.
        Crates sent on a dispatch are added automatically; record returns here, or add an opening balance for crates already at a customer.
      </p>
      <Flash error={error} ok={ok} />

      <form action={record} className="grid max-w-4xl gap-3 rounded-lg border bg-white p-4 md:grid-cols-5">
        <label className="text-sm">Customer
          <select name="customerId" required className={inputCls}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="text-sm">Container
          <select name="itemId" required className={inputCls}>{items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select>
        </label>
        <label className="text-sm">Type
          <select name="move" className={inputCls}><option value="RETURNED">Returned by customer</option><option value="ISSUED">Opening balance / issued</option></select>
        </label>
        <label className="text-sm">Quantity<input name="qty" type="number" min="1" step="1" required className={inputCls} /></label>
        <label className="text-sm">Note<input name="note" className={inputCls} /></label>
        <div className="md:col-span-5"><button className={btnCls}>Record</button></div>
      </form>

      <h2 className="text-lg font-semibold">Customer balances</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">Customer</th><th className="p-2">Container</th><th className="p-2 text-right">Issued</th><th className="p-2 text-right">Returned</th><th className="p-2 text-right">Outstanding</th>
          </tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={`${b.customerId}:${b.itemId}`} className="border-t">
                <td className="p-2 font-medium">{b.customerName}</td><td className="p-2">{b.itemCode} <span className="text-slate-500">{b.itemName}</span></td>
                <td className="p-2 text-right">{b.issued}</td><td className="p-2 text-right">{b.returned}</td>
                <td className={`p-2 text-right font-semibold ${b.balance > 0 ? "text-amber-700" : ""}`}>{b.balance}</td>
              </tr>
            ))}
            {balances.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No container movements yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold">Recent movements</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">When</th><th className="p-2">Customer</th><th className="p-2">Container</th><th className="p-2">Move</th><th className="p-2 text-right">Qty</th><th className="p-2">Ref</th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td className="p-2">{r.customer.name}</td><td className="p-2">{r.item.code}</td>
                <td className="p-2">{r.move}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2">{r.dispatch?.dcNumber ?? r.note ?? "—"}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
