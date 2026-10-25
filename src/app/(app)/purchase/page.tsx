import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createPurchaseOrder } from "@/server/services/inventory";
import { cancelPurchaseOrder, closePurchaseOrderShort } from "@/server/services/purchase";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { href } from "@/lib/url";
import type { PoStatus } from "@prisma/client";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Chips, Eyebrow, Mono, PageHeader, ProgressBar } from "@/components/ui";

export const instant = false;
const PO_LINES = 4;

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order created and approved.", async () => {
    const lines = Array.from({ length: PO_LINES }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), qty: Number(formData.get(`qty_${i}`) || 0),
    })).filter((l) => l.itemId);
    await createPurchaseOrder({
      supplierId: String(formData.get("supplierId")),
      segment: formData.get("segment") === "AUTOMOTIVE" ? "AUTOMOTIVE" : "NON_AUTOMOTIVE",
      lines, userId: user.id,
    });
  });
}

async function cancel(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order cancelled.", async () => { await cancelPurchaseOrder(String(formData.get("id"))); });
}

async function closeShort(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  await runAction("/purchase", "Purchase order closed. The balance is no longer expected.", async () => { await closePurchaseOrderShort(String(formData.get("id"))); });
}

const isOpenPo = (st: string) => st === "APPROVED" || st === "PARTIAL";

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string; status?: string }> }) {
  await requirePermission("po.manage");
  const { error, ok, q: rawQ, status } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const view = status === "closed" || status === "all" ? status : "open";
  const OPEN: PoStatus[] = ["APPROVED", "PARTIAL"];
  const DONE: PoStatus[] = ["CLOSED", "CANCELLED"];
  const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const [suppliers, items, pos, nOpen, nDone] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { active: true, category: { notIn: ["FG", "REGRIND"] } }, orderBy: { code: "asc" } }),
    db.purchaseOrder.findMany({
      where: {
        ...(view === "open" ? { status: { in: OPEN } } : view === "closed" ? { status: { in: DONE } } : {}),
        ...(q ? { OR: [{ poNumber: ci(q) }, { supplier: { name: ci(q) } }, { lines: { some: { item: { OR: [{ code: ci(q) }, { name: ci(q) }] } } } }] } : {}),
      },
      orderBy: { createdAt: "desc" }, take: 60,
      include: { supplier: true, lines: { include: { item: true } } },
    }),
    db.purchaseOrder.count({ where: { status: { in: OPEN } } }),
    db.purchaseOrder.count({ where: { status: { in: DONE } } }),
  ]);

  const tone = (st: string) => (st === "CLOSED" ? "ok" : st === "CANCELLED" ? "danger" : st === "PARTIAL" ? "warn" : "info") as "ok" | "danger" | "warn" | "info";
  return (
    <CreateProvider>
    <div className="space-y-4">
      <PageHeader right={<CreateButton label="New PO" />} eyebrow="BUY & RECEIVE" title="Supplier POs" subtitle={`${nOpen} open · ${nDone} closed`} />
      <Flash error={error} ok={ok} />
      <CreatePanel>
        <Card className="space-y-3">
          <Eyebrow>RAISE PURCHASE ORDER</Eyebrow>
          <form action={create} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[13px]">Supplier
                <select name="supplierId" required className={inputCls}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
              <label className="text-[13px]">Segment
                <select name="segment" className={inputCls}><option value="NON_AUTOMOTIVE">Non-automotive</option><option value="AUTOMOTIVE">Automotive (COA required at GRN)</option></select>
              </label>
            </div>
            {Array.from({ length: PO_LINES }, (_, i) => (
              <div key={i} className="grid gap-2 md:grid-cols-4">
                <select name={`item_${i}`} className={`${inputCls} md:col-span-3`} aria-label={`Item ${i + 1}`}>
                  <option value="">— item {i + 1} —</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
                </select>
                <input name={`qty_${i}`} type="number" step="any" min="0" placeholder="Qty" className={inputCls} aria-label={`Quantity ${i + 1}`} />
              </div>
            ))}
            <p className="text-xs text-ink-3">Prices come from the price master; you can edit them after creating.</p>
            <button className={`${btnCls} w-full md:w-auto`}>Create &amp; approve PO</button>
          </form>
        </Card>
      </CreatePanel>

      <SearchBar q={q} placeholder="Search PO no., supplier or item" keep={{ status: view === "open" ? undefined : view }} clearHref={href("/purchase", { status: view === "open" ? undefined : view })} />
      <Chips chips={[
        { href: href("/purchase", { q }), label: "Open", n: nOpen, active: view === "open" },
        { href: href("/purchase", { q, status: "closed" }), label: "Closed", n: nDone, active: view === "closed" },
        { href: href("/purchase", { q, status: "all" }), label: "All", n: nOpen + nDone, active: view === "all" },
      ]} />
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {[...pos].sort((a, b) => Number(isOpenPo(b.status)) - Number(isOpenPo(a.status))).map((p) => {
          const untouched = p.lines.every((l) => Number(l.receivedQty) === 0);
          return (
            <article key={p.id} className="flex flex-col gap-2.5 rounded-[14px] bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col"><Mono className="text-[15px] font-semibold">{p.poNumber}</Mono><span className="text-[13px] text-ink-2">{p.supplier.name}</span></span>
                <span className="flex flex-col items-end gap-1"><Badge tone={tone(p.status)}>{p.status}</Badge><Badge tone={p.segment === "AUTOMOTIVE" ? "info" : "neutral"}>{p.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto"}</Badge></span>
              </div>
              {p.lines.map((l) => (
                <div key={l.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]"><span className="truncate"><strong>{l.item.code}</strong> <span className="text-ink-3">{l.item.name}</span></span>
                    <Mono className="flex-none text-xs">{Number(l.receivedQty).toLocaleString()} / {Number(l.qty).toLocaleString()} {l.item.uom}</Mono></div>
                  <ProgressBar value={Number(l.receivedQty)} max={Number(l.qty)} color={Number(l.receivedQty) >= Number(l.qty) ? "#1E7A46" : "#1D4ED8"} />
                  <div className="text-[11px] text-ink-3">@ ₹{Number(l.price)}</div>
                </div>
              ))}
              <div className="flex flex-wrap gap-3 pt-0.5">
                {untouched && p.status === "APPROVED" && <Link className="flex min-h-9 items-center text-[13px] font-semibold text-accent" href={`/purchase/${p.id}`}>Edit</Link>}
                {untouched && p.status === "APPROVED" && (
                  <form action={cancel}><input type="hidden" name="id" value={p.id} /><button className="min-h-9 cursor-pointer text-[13px] font-semibold text-danger">Cancel</button></form>
                )}
                {p.status === "PARTIAL" && (
                  <form action={closeShort}><input type="hidden" name="id" value={p.id} /><button className="min-h-9 cursor-pointer text-[13px] font-semibold text-ink-2">Close short</button></form>
                )}
              </div>
            </article>
          );
        })}
        {pos.length === 0 && <Card><p className="text-sm text-ink-3">{q ? `No purchase orders match “${q}”.` : "No purchase orders in this view."}</p></Card>}
      </div>
    </div>
    </CreateProvider>
  );
}
