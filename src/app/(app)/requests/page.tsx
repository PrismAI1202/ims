import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createMaterialRequest } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { NewPanel } from "@/components/new-panel";
import { Badge, Card, DataTable, Mono, PageHeader, StoresTabs } from "@/components/ui";

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
    <div className="space-y-4">
      <PageHeader eyebrow="STORES" title="Requisitions from the shop floor">
        <StoresTabs active="requests" />
      </PageHeader>
      <Flash error={error} ok={ok} />
      <NewPanel label="New requisition"><Card>
        <form action={create} className="grid gap-3 md:grid-cols-4">
          <label className="text-[13px] md:col-span-2">Item
            <select name="itemId" required className={inputCls}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
            </select>
          </label>
          <label className="text-[13px]">Qty<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
          <label className="text-[13px]">Machine
            <select name="machineId" className={inputCls}>
              <option value="">—</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
            </select>
          </label>
          <div className="md:col-span-4"><button className={`${btnCls} w-full md:w-auto`}>Raise request</button></div>
        </form>
      </Card></NewPanel>

      <DataTable>
        <thead><tr><th>Request</th><th>Lines (issued / requested)</th><th>Status</th></tr></thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold"><Mono>{r.requestNumber}</Mono></td>
              <td><Mono className="text-xs">{r.lines.map((l) => `${l.item.code}: ${Number(l.issuedQty)}/${Number(l.qty)} ${l.item.uom}`).join(", ")}</Mono></td>
              <td><Badge tone={r.status === "OPEN" ? "warn" : r.status === "PARTIAL" ? "info" : "ok"}>{r.status}</Badge></td>
            </tr>
          ))}
          {requests.length === 0 && <tr><td className="text-ink-3" colSpan={3}>No requests yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
  );
}
