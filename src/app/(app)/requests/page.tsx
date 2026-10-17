import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createMaterialRequest } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("request.create");
  await runAction("/requests", "Material request sent to store.", async () => {
    await createMaterialRequest({
      machineId: String(formData.get("machineId") || "") || undefined,
      lines: [{ itemId: String(formData.get("itemId")), qty: Number(formData.get("qty")) }],
      userId: user.id,
    });
  });
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("request.create");
  const { error, ok } = await searchParams;
  const [items, machines, requests] = await Promise.all([
    db.item.findMany({ where: { active: true, category: { notIn: ["FG", "RETURNABLE"] } }, orderBy: { code: "asc" } }),
    db.machine.findMany({ orderBy: { code: "asc" } }),
    db.materialRequest.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { lines: { include: { item: true } } } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Material Requests</h1>
      <Flash error={error} ok={ok} />
      <form action={create} className="grid max-w-3xl gap-3 rounded-lg border bg-white p-4 md:grid-cols-4">
        <label className="text-sm md:col-span-2">Item
          <select name="itemId" required className={inputCls}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Qty<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
        <label className="text-sm">Machine
          <select name="machineId" className={inputCls}>
            <option value="">—</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
          </select>
        </label>
        <div className="md:col-span-4"><button className={btnCls}>Raise request</button></div>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Request</th><th className="p-2">Lines (issued / requested)</th><th className="p-2">Status</th></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 font-medium">{r.requestNumber}</td>
                <td className="p-2">{r.lines.map((l) => `${l.item.code}: ${Number(l.issuedQty)}/${Number(l.qty)} ${l.item.uom}`).join(", ")}</td>
                <td className="p-2">{r.status}</td>
              </tr>
            ))}
            {requests.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={3}>No requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
