import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createDispatch } from "@/server/services/dispatch";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;
const LINES = 4;

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("dispatch.manage");
  let id = "";
  await runAction(() => `/dispatch/${id}`, "Pick list created. Scan the boxes to load.", async () => {
    const lines = Array.from({ length: LINES }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), qty: Number(formData.get(`qty_${i}`) || 0),
    })).filter((l) => l.itemId);
    const d = await createDispatch({
      customerId: String(formData.get("customerId")), vehicleNumber: String(formData.get("vehicleNumber") || ""),
      driverName: String(formData.get("driverName") || "") || undefined, lines, userId: user.id,
    });
    id = d.id;
  }, "/dispatch");
}

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("dispatch.manage");
  const { error, ok } = await searchParams;
  const [customers, fgItems, dispatches] = await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    db.dispatch.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { customer: true, lines: { include: { item: true } } } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dispatch</h1>
      <Flash error={error} ok={ok} />
      <form action={create} className="max-w-4xl space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-medium">New pick list</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Customer
            <select name="customerId" required className={inputCls}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="text-sm">Vehicle no.<input name="vehicleNumber" required className={inputCls} /></label>
          <label className="text-sm">Driver<input name="driverName" className={inputCls} /></label>
        </div>
        {Array.from({ length: LINES }, (_, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-4">
            <select name={`item_${i}`} className={`${inputCls} md:col-span-3`} aria-label={`Part ${i + 1}`}>
              <option value="">— part {i + 1} —</option>
              {fgItems.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
            </select>
            <input name={`qty_${i}`} type="number" min="1" step="1" placeholder="Qty" className={inputCls} aria-label={`Quantity ${i + 1}`} />
          </div>
        ))}
        <button className={btnCls}>Create &amp; start loading</button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">DC</th><th className="p-2">Customer</th><th className="p-2">Vehicle</th><th className="p-2">Pick list</th><th className="p-2">Status</th>
          </tr></thead>
          <tbody>
            {dispatches.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2 font-medium"><Link className="underline" href={`/dispatch/${d.id}`}>{d.dcNumber}</Link></td>
                <td className="p-2">{d.customer.name}</td><td className="p-2">{d.vehicleNumber}</td>
                <td className="p-2">{d.lines.map((l) => `${l.item.code} × ${l.qty.toLocaleString()}`).join(", ")}</td><td className="p-2">{d.status}</td>
              </tr>
            ))}
            {dispatches.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No dispatches yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
