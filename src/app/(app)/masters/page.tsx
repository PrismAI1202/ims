import { ScanSearch } from "@/components/scan-search";
import { Form } from "@/components/form";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { btnCls, btnDangerCls, btnSecondaryCls, Flash } from "@/components/flash";
import { CatalogueRows } from "@/components/catalogue-rows";
import { SidePanel } from "@/components/side-panel";
import { TypeTag } from "@/components/mrp-table";
import { href, matches } from "@/lib/url";
import { itemType, TYPE_GROUPS } from "@/lib/item-types";
import { Badge, Card, Eyebrow, Mono, PageHeader } from "@/components/ui";
import { addItem, saveItem, toggleActive } from "./actions";
import { ItemFields } from "./item-fields";

export const instant = false;

type Search = { q?: string; type?: string; status?: string; sup?: string; item?: string; new?: string; error?: string; ok?: string };

const BOUGHT = (category: string) => category !== "FG" && category !== "REGRIND";
// Customer-owned returnables (stock not tracked) are never bought, so they have no supplier to list.
const BUYS = (i: { category: string; stockTracked: boolean }) => BOUGHT(i.category) && i.stockTracked;
const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const rowCls = "grid items-center gap-x-4 gap-y-1.5 p-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_auto]";

export default async function MastersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireView("masters");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const group = TYPE_GROUPS.some((g) => g.key === sp.type) ? String(sp.type) : undefined;
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const noSupplier = sp.sup === "none";

  const [items, suppliers] = await Promise.all([
    db.item.findMany({ orderBy: { code: "asc" }, include: { prices: { include: { supplier: true }, orderBy: { price: "asc" } } } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  // Counts on each chip follow the other filters, so a chip says what it would show.
  const base = items.filter((i) => matches(q, i.code, i.name, i.category));
  const byStatus = (list: typeof items) => list.filter((i) => status === "all" || (status === "active") === i.active);
  const matchesGroup = (i: (typeof items)[number]) => !group || itemType(i.category).group === group;
  const lacking = (i: (typeof items)[number]) => i.active && BUYS(i) && i.prices.length === 0;
  const shown = byStatus(base).filter((i) => matchesGroup(i) && (!noSupplier || lacking(i)));
  const params = { q, type: group, status: status === "active" ? undefined : status, sup: noSupplier ? "none" : undefined };
  const u = (over: Record<string, string | undefined>) => href("/masters", { ...params, ...over });
  const closeHref = href("/masters", params);
  const groupCount = (g: string) => byStatus(base).filter((i) => itemType(i.category).group === g).length;
  const nLacking = base.filter(lacking).length;

  const open = sp.item ? items.find((i) => i.id === sp.item) : undefined;
  const supplierOptions = suppliers.map((s) => ({ id: s.id, label: s.name, hint: `Lead time ${s.leadTimeDays} day${s.leadTimeDays === 1 ? "" : "s"}` }));

  const seg = (list: { href: string; label: string; n?: number; active: boolean }[]) => (
    <nav className="inline-flex shrink-0 rounded-xl border border-border bg-white p-0.5">
      {list.map((c) => (
        <Link key={c.label} href={c.href} scroll={false} aria-current={c.active ? "true" : undefined}
          className={`flex min-h-9 items-center whitespace-nowrap rounded-[10px] px-3 text-[13px] font-semibold ${c.active ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"}`}>
          {c.label}{c.n !== undefined && <span className="ml-1.5 font-mono text-[11px] opacity-70">{c.n}</span>}
        </Link>
      ))}
    </nav>
  );

  return (
    // Laptop: one screen, only the list scrolls. Phone: the page scrolls with the filter bar pinned.
    <div className="flex flex-col gap-3 md:h-[calc(100dvh-4rem)] md:min-h-96">
      <PageHeader eyebrow="SET UP" title="Admin · Masters" subtitle={`${items.filter((i) => i.active).length} active items · open one to edit it, manage its suppliers or deactivate it`}>
        <Link href={href("/masters", { ...params, new: "1" })} scroll={false} className="flex min-h-10 w-fit items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover"><Plus size={16} aria-hidden /> New item</Link>
      </PageHeader>
      {!open && sp.new !== "1" && <Flash error={sp.error} ok={sp.ok} />}

      <section aria-label="Filters" className="sticky top-0 z-20 -mx-4 flex flex-none flex-wrap items-center gap-2 bg-canvas px-4 py-2 md:static md:mx-0 md:bg-transparent md:p-0">
        <form method="get" action="/masters" role="search" className="flex min-w-0 flex-1 basis-56 gap-1.5">
          {Object.entries({ ...params, q: undefined }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search items</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input type="search" name="q" defaultValue={q} placeholder="Search code, name or category…" enterKeyHint="search" autoComplete="off" className="min-h-11 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm" />
          </label>
          <ScanSearch title="Scan an item" keep={{ ...params, q: undefined }} />
          <button className="min-h-11 cursor-pointer rounded-xl bg-ink px-3 text-sm font-semibold text-white"><span className="hidden sm:inline">Search</span><Search size={16} aria-hidden className="sm:hidden" /></button>
          {q && <Link href={u({ q: undefined })} className="flex min-h-11 items-center px-1 text-sm font-semibold text-accent">Clear</Link>}
        </form>
        <div className="-mx-1 flex w-full gap-2 overflow-x-auto px-1 [scrollbar-width:none] md:w-auto md:max-w-full">
          {seg([
            { href: u({ type: undefined }), label: "All", n: byStatus(base).length, active: !group },
            ...TYPE_GROUPS.filter((g) => groupCount(g.key) > 0).map((g) => ({ href: u({ type: g.key }), label: g.key, n: groupCount(g.key), active: group === g.key })),
          ])}
          {seg([
            { href: u({ status: undefined }), label: "Active", active: status === "active" },
            { href: u({ status: "inactive" }), label: "Inactive", active: status === "inactive" },
            { href: u({ status: "all" }), label: "All", active: status === "all" },
          ])}
          {nLacking > 0 && seg([{ href: u({ sup: noSupplier ? undefined : "none" }), label: "No supplier", n: nLacking, active: noSupplier }])}
        </div>
      </section>

      <div className="flex flex-none items-center justify-between gap-2 text-xs text-ink-3">
        <span>{shown.length === 0 ? "No items" : `${shown.length.toLocaleString()} item${shown.length === 1 ? "" : "s"}`}{(q || group || noSupplier || status !== "active") && " (filtered)"}</span>
        {(q || group || noSupplier || status !== "active") && <Link href="/masters" className="font-semibold text-accent">Clear filters</Link>}
      </div>

      {/* The list is the only part that scrolls; the header row stays pinned to its top. */}
      <div role="region" aria-label="Items" tabIndex={0} className="min-h-0 overflow-y-auto overscroll-contain rounded-[14px] bg-white [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-accent md:flex-1">
        <div className={`sticky top-0 z-10 hidden bg-canvas px-0 text-xs font-semibold text-ink-3 md:grid ${rowCls}`} aria-hidden>
          <span>Item</span><span>Unit</span><span>Stock levels</span><span>Suppliers</span><span className="text-right">Status</span>
        </div>
        <ul className="divide-y divide-line">
          {shown.map((i) => {
            const t = itemType(i.category);
            const bought = BUYS(i);
            return (
              <li key={i.id} className={i.active ? "" : "bg-canvas/70 text-ink-3"}>
                <Link href={href("/masters", { ...params, item: i.id })} scroll={false} className={`${rowCls} hover:bg-canvas`} style={{ boxShadow: `inset 4px 0 0 ${t.color}` }}>
                  <span className="flex min-w-0 items-start gap-2 pl-2">
                    <TypeTag category={i.category} />
                    <span className="min-w-0"><span className="block truncate font-semibold">{i.code}</span><span className="block truncate text-xs text-ink-3">{i.name}</span></span>
                  </span>
                  <span className="text-xs text-ink-2">{i.uom}<span className="block text-ink-3">{t.name}</span></span>
                  <span className="font-mono text-xs text-ink-2">{bought || i.category === "FG" ? <>{Number(i.minStock)} / {Number(i.reorderPoint)} / {Number(i.maxStock)}<span className="block font-sans text-ink-3">min / ROP / max</span></> : "—"}</span>
                  <span className="min-w-0 text-xs">
                    {!bought ? <span className="text-ink-3">{i.category === "FG" ? "Made here" : i.category === "REGRIND" ? "In-house" : "Customer-owned"}</span>
                      : i.prices.length === 0 ? <span className="rounded bg-warn-bg px-1.5 py-0.5 font-semibold text-warn-ink">No supplier yet</span>
                      : <>
                          <span className="block truncate"><strong>{i.prices.length}</strong> supplier{i.prices.length === 1 ? "" : "s"} · from <b>{money(Number(i.prices[0].price))}</b></span>
                          <span className="block truncate text-ink-3">{i.prices.map((p) => p.supplier.name).join(", ")}</span>
                        </>}
                  </span>
                  <span className="flex items-center gap-1.5 md:justify-end">
                    {i.requiresCoa && <span title="COA required at GRN" className="rounded bg-info-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-info-ink">COA</span>}
                    <Badge tone={i.active ? "ok" : "neutral"}>{i.active ? "Active" : "Inactive"}</Badge>
                  </span>
                </Link>
              </li>
            );
          })}
          {shown.length === 0 && <li className="p-4 text-sm text-ink-3">{items.length === 0 ? "No items yet." : "No items match these filters."}</li>}
        </ul>
      </div>

      {/* Adding an item, and opening one, each get a panel of their own over the list. */}
      {sp.new === "1" && (
        <SidePanel title="New item" subtitle="A part, material, insert or packaging item. A bought one can have several suppliers" closeHref={closeHref}>
          <Flash error={sp.error} />
          <Form action={addItem} className="space-y-4">
            <input type="hidden" name="back" value={closeHref} />
            <Card className="space-y-3"><Eyebrow>ITEM</Eyebrow><ItemFields /></Card>
            <Card className="space-y-3">
              <div>
                <Eyebrow>WHO SUPPLIES IT</Eyebrow>
                <p className="mt-1 max-w-2xl text-sm text-ink-2">Add every supplier you can buy it from, with each one&apos;s price. MRP suggests the cheapest and the buyer can pick another. Not for finished goods or regrind, which are made here.</p>
              </div>
              <CatalogueRows kind="supplier" options={supplierOptions} initial={[]} emptyNote="No supplier yet. The item is tracked in Stores but has to be ordered by hand until one is added." />
            </Card>
            <button className={`${btnCls} w-full md:w-auto`}>Create item</button>
          </Form>
        </SidePanel>
      )}
      {open && (
        <SidePanel title={open.code} subtitle={`${open.name} · ${itemType(open.category).name}`} closeHref={closeHref}>
          <Flash error={sp.error} />
          <Form action={saveItem} className="space-y-4" key={open.id}>
            <input type="hidden" name="id" value={open.id} />
            <input type="hidden" name="back" value={closeHref} />
            <Card className="space-y-3">
              <Eyebrow>DETAILS</Eyebrow>
              <ItemFields d={{
                code: open.code, name: open.name, category: open.category, uom: open.uom, polymerGrade: open.polymerGrade,
                minStock: Number(open.minStock), reorderPoint: Number(open.reorderPoint), maxStock: Number(open.maxStock),
                safetyStock: Number(open.safetyStock), shelfLifeDays: open.shelfLifeDays, requiresCoa: open.requiresCoa,
                maxRegrindPct: open.maxRegrindPct === null ? null : Number(open.maxRegrindPct),
                stockTracked: open.stockTracked, hsnCode: open.hsnCode, unitPrice: open.unitPrice === null ? null : Number(open.unitPrice),
              }} />
            </Card>
            {BOUGHT(open.category) && (
              <Card className="space-y-3">
                <input type="hidden" name="suppliers" value="1" />
                <div>
                  <Eyebrow>SUPPLIERS &amp; PRICES</Eyebrow>
                  <p className="mt-1 max-w-2xl text-sm text-ink-2">Everyone you can buy this from. MRP suggests the cheapest and &ldquo;Raise PO&rdquo; starts from the supplier you pick. The same list is on each supplier, under the products it supplies.</p>
                </div>
                <CatalogueRows kind="supplier" unit={open.uom} options={supplierOptions} initial={open.prices.map((p) => ({ id: p.supplierId, price: String(Number(p.price)) }))}
                  emptyNote="No supplier yet: MRP can't suggest a PO for this item. The item is still tracked in Stores." />
              </Card>
            )}
            <button className={`${btnCls} w-full md:w-auto`}>Save changes</button>
          </Form>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold">{open.active ? "Deactivate this item" : "This item is inactive"}</h3>
              <p className="max-w-xl text-xs text-ink-3">{open.active ? "It disappears from pickers and plans; its stock, lots and history are kept." : "Activate it to use it in orders, BOMs and plans again."}</p>
            </div>
            <Form action={toggleActive}>
              <input type="hidden" name="id" value={open.id} /><input type="hidden" name="back" value={closeHref} /><input type="hidden" name="active" value={String(!open.active)} />
              <button className={open.active ? btnDangerCls : btnSecondaryCls}>{open.active ? "Deactivate" : "Activate"}</button>
            </Form>
          </Card>
          <p className="text-xs text-ink-3">On hand and open orders for <Mono>{open.code}</Mono> are in Stores and Orders.</p>
        </SidePanel>
      )}
    </div>
  );
}
