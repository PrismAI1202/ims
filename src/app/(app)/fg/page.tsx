import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { packBoxes, unboxedQty } from "@/server/services/fg";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function pack(formData: FormData) {
  "use server";
  const user = await requirePermission("fg.pack");
  const [lotNumber, binCode] = String(formData.get("source")).split("|");
  let first = "";
  await runAction("/fg", () => `Boxes created. ${first ? `Print labels: ${first}` : ""}`.trim(), async () => {
    const boxes = await packBoxes({
      lotNumber, binCode, customerId: String(formData.get("customerId")),
      qtyPerBox: Number(formData.get("qtyPerBox")), boxCount: Number(formData.get("boxCount")), userId: user.id,
    });
    first = `${boxes[0].boxCode}${boxes.length > 1 ? ` – ${boxes[boxes.length - 1].boxCode}` : ""}`;
  });
}

export default async function FgPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("fg.pack");
  const { error, ok } = await searchParams;
  const [balances, customers, boxes] = await Promise.all([
    db.stockBalance.findMany({
      where: { qty: { gt: 0 }, lot: { item: { category: "FG" } } },
      include: { lot: { include: { item: true } }, location: true }, orderBy: { lot: { receivedAt: "asc" } },
    }),
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.fgBox.findMany({
      orderBy: { createdAt: "desc" }, take: 40, include: { lot: { include: { item: true } }, customer: true },
    }),
  ]);
  const sources = (await Promise.all(balances.map(async (b) => ({
    key: `${b.lot.lotNumber}|${b.location.code}`, lot: b.lot.lotNumber, part: b.lot.item.code, bin: b.location.code,
    free: await unboxedQty(db, b.lotId, b.locationId),
  })))).filter((s) => s.free > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Finished Goods &amp; Box Labels</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Pack finished-goods lots into labelled boxes for a customer. The label follows the customer&apos;s format (OEM labels carry part, batch, shift, machine, quantity and date).
        Boxes reserve stock; it leaves the bin when the box is scanned onto a completed dispatch.
      </p>
      <Flash error={error} ok={ok} />
      {sources.length === 0 ? (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">No unboxed finished goods. Book production first.</p>
      ) : (
        <form action={pack} className="grid max-w-4xl gap-3 rounded-lg border bg-white p-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">Lot / bin
            <select name="source" required className={inputCls}>
              {sources.map((s) => <option key={s.key} value={s.key}>{s.lot} · {s.part} · {s.bin} · {s.free.toLocaleString()} unboxed</option>)}
            </select>
          </label>
          <label className="text-sm md:col-span-2">Customer
            <select name="customerId" required className={inputCls}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.labelFormat})</option>)}
            </select>
          </label>
          <label className="text-sm">Parts per box<input name="qtyPerBox" type="number" min="1" step="1" required className={inputCls} /></label>
          <label className="text-sm">Number of boxes<input name="boxCount" type="number" min="1" max="200" step="1" defaultValue={1} required className={inputCls} /></label>
          <div className="flex items-end md:col-span-2"><button className={btnCls}>Create boxes</button></div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">Box</th><th className="p-2">Part</th><th className="p-2">Customer</th><th className="p-2 text-right">Qty</th>
            <th className="p-2">Batch</th><th className="p-2">Status</th><th className="p-2">Label</th>
          </tr></thead>
          <tbody>
            {boxes.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="p-2 font-medium">{b.boxCode}</td><td className="p-2">{b.lot.item.code}</td><td className="p-2">{b.customer.name}</td>
                <td className="p-2 text-right">{b.qty.toLocaleString()}</td><td className="p-2">{b.batchCode ?? "—"}</td><td className="p-2">{b.status}</td>
                <td className="p-2"><Link className="underline" target="_blank" href={`/fg/labels?boxes=${b.boxCode}`}>Print</Link></td>
              </tr>
            ))}
            {boxes.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={7}>No boxes yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {boxes.filter((b) => b.status === "IN_STOCK").length > 1 && (
        <Link className="text-sm underline" target="_blank"
          href={`/fg/labels?boxes=${boxes.filter((b) => b.status === "IN_STOCK").map((b) => b.boxCode).join(",")}`}>
          Print all labels for boxes in stock
        </Link>
      )}
    </div>
  );
}
