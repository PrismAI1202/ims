import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { packBoxes, unboxedQty } from "@/server/services/fg";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { NewPanel } from "@/components/new-panel";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

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
    <div className="space-y-4">
      <PageHeader eyebrow="STORE & SHOP FLOOR" title="FG & box labels" subtitle="Pack finished goods into labelled boxes for a customer" />
      <p className="max-w-3xl text-sm text-ink-2">
        The label follows the customer&apos;s format (OEM labels carry part, batch, shift, machine, quantity and date).
        Boxes reserve stock; it leaves the bin when the box is scanned onto a completed dispatch.
      </p>
      <Flash error={error} ok={ok} />
      {sources.length === 0 ? (
        <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">No unboxed finished goods. Book production first.</p>
      ) : (
        <NewPanel label="Create boxes"><Card>
          <form action={pack} className="grid gap-3 md:grid-cols-4">
            <label className="text-[13px] md:col-span-2">Lot / bin
              <select name="source" required className={inputCls}>
                {sources.map((s) => <option key={s.key} value={s.key}>{s.lot} · {s.part} · {s.bin} · {s.free.toLocaleString()} unboxed</option>)}
              </select>
            </label>
            <label className="text-[13px] md:col-span-2">Customer
              <select name="customerId" required className={inputCls}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.labelFormat})</option>)}
              </select>
            </label>
            <label className="text-[13px]">Parts per box<input name="qtyPerBox" type="number" min="1" step="1" required className={inputCls} /></label>
            <label className="text-[13px]">Number of boxes<input name="boxCount" type="number" min="1" max="200" step="1" defaultValue={1} required className={inputCls} /></label>
            <div className="flex items-end md:col-span-2"><button className={`${btnCls} w-full md:w-auto`}>Create boxes</button></div>
          </form>
        </Card></NewPanel>
      )}

      <Eyebrow>BOXES</Eyebrow>
      <DataTable>
        <thead><tr>
          <th>Box</th><th>Part</th><th>Customer</th><th className="text-right!">Qty</th><th>Batch</th><th>Status</th><th>Label</th>
        </tr></thead>
        <tbody>
          {boxes.map((b) => (
            <tr key={b.id}>
              <td><Mono className="text-xs font-semibold">{b.boxCode}</Mono></td><td>{b.lot.item.code}</td><td>{b.customer.name}</td>
              <td className="text-right"><Mono>{b.qty.toLocaleString()}</Mono></td><td><Mono className="text-xs">{b.batchCode ?? "—"}</Mono></td>
              <td><Badge tone={b.status === "IN_STOCK" ? "info" : "ok"}>{b.status}</Badge></td>
              <td><Link className="font-semibold text-accent" target="_blank" href={`/fg/labels?boxes=${b.boxCode}`}>Print</Link></td>
            </tr>
          ))}
          {boxes.length === 0 && <tr><td className="text-ink-3" colSpan={7}>No boxes yet.</td></tr>}
        </tbody>
      </DataTable>
      {boxes.filter((b) => b.status === "IN_STOCK").length > 1 && (
        <Link className="inline-block text-sm font-semibold text-accent" target="_blank"
          href={`/fg/labels?boxes=${boxes.filter((b) => b.status === "IN_STOCK").map((b) => b.boxCode).join(",")}`}>
          Print all labels for boxes in stock
        </Link>
      )}
    </div>
  );
}
