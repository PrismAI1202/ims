import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireViewWith, requirePermission, runAction } from "@/server/auth/guard";
import { setPoExpedite, updatePurchaseOrder } from "@/server/services/purchase";
import { Form } from "@/components/form";
import { btnCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { EditPoLines, type LineOption } from "@/components/order-lines";
import { dateField, readLines } from "@/server/line-form";
import { Badge, Card, Eyebrow, Mono, PageHeader } from "@/components/ui";

export const instant = false;

async function save(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  const id = String(formData.get("id"));
  return runAction("/orders?kind=po", "Purchase order updated.", async () => {
    const po = await db.purchaseOrder.findUnique({ where: { id }, select: { supplierId: true } });
    // A blank price falls back to the supplier's price master, as it does when a PO is created.
    const master = new Map((await db.priceMaster.findMany({ where: { supplierId: po?.supplierId ?? "" } })).map((p) => [p.itemId, Number(p.price)]));
    await updatePurchaseOrder(id, readLines(formData).map((l) => ({
      itemId: l.itemId, qty: l.qty, price: l.price ?? master.get(l.itemId) ?? 0, expectedDate: dateField(l.date),
    })));
  }, `/purchase/${id}`);
}

async function expedite(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  const id = String(formData.get("id")), on = formData.get("on") === "1";
  return runAction(`/purchase/${id}`, on ? "The supplier is now marked as asked to expedite." : "The expedite request was taken back.", async () => {
    await setPoExpedite(id, on, String(formData.get("note") || ""));
  });
}

export default async function EditPo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireViewWith("orders", "po.manage");
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, lines: { include: { item: true } } } });
  if (!po) notFound();
  const [items, prices] = await Promise.all([
    db.item.findMany({ where: { active: true, category: { notIn: ["FG", "REGRIND"] } }, orderBy: { code: "asc" } }),
    db.priceMaster.findMany({ where: { supplierId: po.supplierId } }),
  ]);
  const options: LineOption[] = items.map((it) => ({ id: it.id, code: it.code, name: it.name, uom: it.uom, prices: Object.fromEntries(prices.filter((p) => p.itemId === it.id).map((p) => [po.supplierId, Number(p.price)])) }));
  const locked = po.status !== "APPROVED" || po.lines.some((l) => Number(l.receivedQty) > 0);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`BUY & RECEIVE · ${po.supplier.name.toUpperCase()}`} title={po.poNumber} right={<Badge tone="info">{po.status}</Badge>}>
        <Link href="/orders?kind=po" className="text-sm font-semibold">← Orders</Link>
      </PageHeader>
      <Flash error={error} />
      {(po.status === "APPROVED" || po.status === "PARTIAL") && (
        po.expedite ? (
          <Form action={expedite} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-ink bg-warn-bg p-3.5 text-sm">
            <input type="hidden" name="id" value={po.id} /><input type="hidden" name="on" value="0" />
            <span><strong className="text-warn-ink">Supplier asked to expedite.</strong> {po.expediteNote ?? "No note was left."} <span className="text-ink-3">Lead time {po.supplier.leadTimeDays} days.</span></span>
            <button className={btnSecondaryCls}>Take the request back</button>
          </Form>
        ) : (
          <Form action={expedite} className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3.5 text-sm">
            <input type="hidden" name="id" value={po.id} /><input type="hidden" name="on" value="1" />
            <label className="min-w-56 flex-1 text-[13px]">Need it sooner? Ask {po.supplier.name} to expedite <span className="text-ink-3">(lead time {po.supplier.leadTimeDays} days)</span>
              <input name="note" maxLength={200} placeholder="Reason for the supplier, e.g. line stops on the 30th" className={inputCls} />
            </label>
            <button className={btnCls}>Ask to expedite</button>
          </Form>
        )
      )}
      {locked && <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">This order can no longer be edited (goods have been received, or it is {po.status.toLowerCase()}).</p>}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>ORDER LINES</Eyebrow>
          {po.externalRef && <span className="text-xs text-ink-3">Your reference <Mono className="font-semibold text-ink">{po.externalRef}</Mono></span>}
        </div>
        <EditPoLines action={save} poId={po.id} supplierId={po.supplierId} locked={locked} items={options}
          initial={po.lines.map((l) => ({ itemId: l.itemId, qty: String(Number(l.qty)), price: String(Number(l.price)), date: l.expectedDate?.toISOString().slice(0, 10) ?? "" }))} />
      </Card>
    </div>
  );
}
