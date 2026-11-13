import { Form } from "@/components/form";
import Link from "next/link";
import { db } from "@/server/db";
import { unboxedQty } from "@/server/services/fg";
import { btnCls, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { href, matches } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Chips, DataTable, Eyebrow, Mono } from "@/components/ui";
import { pack } from "../actions";

export async function PackTab({ q, status }: { q?: string; status?: string }) {
  const view = status === "IN_STOCK" || status === "DISPATCHED" ? status : "ALL";
  const [balances, customers, boxes] = await Promise.all([
    db.stockBalance.findMany({
      where: { qty: { gt: 0 }, lot: { item: { category: "FG" } } },
      include: { lot: { include: { item: true } }, location: true }, orderBy: { lot: { receivedAt: "asc" } },
    }),
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.fgBox.findMany({
      orderBy: { createdAt: "desc" }, take: 200, include: { lot: { include: { item: true } }, customer: true },
    }),
  ]);
  const sources = (await Promise.all(balances.map(async (b) => ({
    key: `${b.lot.lotNumber}|${b.location.code}`, lot: b.lot.lotNumber, part: b.lot.item.code, bin: b.location.code,
    free: await unboxedQty(db, b.lotId, b.locationId),
  })))).filter((s) => s.free > 0);

  return (
    <CreateProvider>
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-ink-2">
          The label follows the customer&apos;s format (OEM labels carry part, batch, shift, machine, quantity and date).
          Boxes reserve stock; it leaves the bin when the box is scanned onto a completed dispatch.
        </p>
        {sources.length > 0 && <CreateButton label="Create boxes" />}
      </div>
      {sources.length === 0 ? (
        <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">No unboxed finished goods. Book production first.</p>
      ) : (
        <CreatePanel><Card>
          <Form action={pack} className="grid gap-3 md:grid-cols-4">
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
          </Form>
        </Card></CreatePanel>
      )}

      <Eyebrow>BOXES</Eyebrow>
      <SearchBar q={q} scan={{ title: "Scan a box label" }} placeholder="Search box, part, customer or batch" keep={{ tab: "pack", status: view === "ALL" ? undefined : view }} clearHref={href("/fg", { tab: "pack", status: view === "ALL" ? undefined : view })} />
      <Chips chips={(["ALL", "IN_STOCK", "DISPATCHED"] as const).map((k) => ({ href: href("/fg", { tab: "pack", q, status: k === "ALL" ? undefined : k }), label: k === "ALL" ? "All" : k === "IN_STOCK" ? "In stock" : "Dispatched", active: view === k }))} />
      <DataTable>
        <thead><tr>
          <th>Box</th><th>Part</th><th>Customer</th><th className="text-right!">Qty</th><th>Batch</th><th>Status</th><th>Label</th>
        </tr></thead>
        <tbody>
          {boxes.filter((b) => (view === "ALL" || b.status === view) && matches(q, b.boxCode, b.lot.item.code, b.customer.name, b.batchCode)).map((b) => (
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
    </CreateProvider>
  );
}
