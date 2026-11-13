import { db } from "@/server/db";
import { DownloadLink } from "@/components/download-link";
import { returnableBalances } from "@/server/services/dispatch";
import { btnCls, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, DataTable, Eyebrow, Mono } from "@/components/ui";
import { recordCrates } from "../actions";

export async function CratesTab({ q }: { q?: string }) {
  const [balances, customers, items, recent, bins] = await Promise.all([
    returnableBalances(),
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { category: "RETURNABLE", active: true }, orderBy: { code: "asc" } }),
    db.returnableLedger.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { customer: true, item: true, dispatch: true } }),
    db.location.findMany({ where: { type: "STORAGE", active: true }, orderBy: { code: "asc" } }),
  ]);

  return (
    <CreateProvider>
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-ink-2">
          Crates, trolleys and pallets that travel with dispatches. Balance = issued − returned.
          Crates sent on a dispatch are added automatically; record returns here, or add an opening balance for crates already at a customer.
        </p>
        <CreateButton label="Record movement" />
      </div>
      <CreatePanel>
        <Card className="space-y-3">
          <Eyebrow>RECORD A MOVEMENT</Eyebrow>
          <form action={recordCrates} className="grid gap-3 md:grid-cols-6">
            <label className="text-[13px]">Customer
              <select name="customerId" required className={inputCls}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className="text-[13px]">Container
              <select name="itemId" required className={inputCls}>{items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</select>
            </label>
            <label className="text-[13px]">Type
              <select name="move" className={inputCls}><option value="RETURNED">Returned by customer</option><option value="ISSUED">Opening balance / issued</option></select>
            </label>
            <label className="text-[13px]">Quantity<input name="qty" type="number" min="1" step="1" required className={inputCls} /></label>
            <label className="text-[13px]">Note<input name="note" className={inputCls} /></label>
            <label className="text-[13px]">Bin (returns of crates we own)
              <select name="binCode" className={inputCls}><option value="">First storage bin</option>{bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}</select>
            </label>
            <div className="md:col-span-6"><button className={`${btnCls} w-full md:w-auto`}>Record</button></div>
          </form>
        </Card>
      </CreatePanel>
      <p className="flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
        <DownloadLink href={"/api/v1/export/returnables?format=xlsx"}>Download Excel</DownloadLink>
        <DownloadLink href={"/api/v1/export/returnables?format=csv"}>Download CSV</DownloadLink>
        <span className="font-normal text-ink-3">To get a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
      </p>

      <SearchBar q={q} placeholder="Search customer or container" keep={{ tab: "crates" }} clearHref="/fg?tab=crates" />
      <Eyebrow>CUSTOMER BALANCES</Eyebrow>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {balances.filter((b) => matches(q, b.customerName, b.itemCode, b.itemName)).map((b) => (
          <article key={`${b.customerId}:${b.itemId}`} className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex flex-col"><span className="font-semibold">{b.customerName}</span><span className="text-xs text-ink-3">{b.itemCode} · {b.itemName}</span></span>
              <span className="flex flex-col items-end"><strong className={`font-mono text-lg font-medium ${b.balance > 0 ? "text-warn-ink" : ""}`}>{b.balance}</strong><span className="text-[11px] text-ink-3">with customer</span></span>
            </div>
            <div aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px] bg-ok" style={{ width: `${b.issued ? Math.min(100, (b.returned / b.issued) * 100) : 0}%` }} /></div>
            <div className="flex gap-4 text-xs text-ink-2"><span>Issued <Mono>{b.issued}</Mono></span><span>Returned <Mono>{b.returned}</Mono></span></div>
          </article>
        ))}
        {balances.length === 0 && <Card><p className="text-sm text-ink-3">No container movements yet.</p></Card>}
      </div>


      <Eyebrow>RECENT MOVEMENTS</Eyebrow>
      <DataTable>
        <thead><tr><th>When</th><th>Customer</th><th>Container</th><th>Move</th><th className="text-right!">Qty</th><th>Ref</th></tr></thead>
        <tbody>
          {recent.filter((r) => matches(q, r.customer.name, r.item.code, r.move, r.dispatch?.dcNumber, r.note)).map((r) => (
            <tr key={r.id}>
              <td><Mono className="text-xs">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Mono></td><td>{r.customer.name}</td><td>{r.item.code}</td>
              <td><Badge tone={r.move === "RETURNED" ? "ok" : "warn"}>{r.move}</Badge></td><td className="text-right"><Mono>{r.qty}</Mono></td><td>{r.dispatch?.dcNumber ?? r.note ?? "—"}</td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td className="text-ink-3" colSpan={6}>Nothing yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
    </CreateProvider>
  );
}
