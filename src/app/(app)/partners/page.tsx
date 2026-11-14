import { Form } from "@/components/form";
import Link from "next/link";
import { Check, ChevronLeft, Pencil, Plus } from "lucide-react";
import { db } from "@/server/db";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { createCustomer, createSupplier, removeCustomer, removeSupplier, setActive, updateCustomer, updateSupplier } from "@/server/services/masters";
import { Drawer, dotted, field, RemoveButton } from "@/components/edit-mode";
import { btnCls } from "@/components/flash";
import { Flash } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { CatalogueRows } from "@/components/catalogue-rows";
import { itemType } from "@/lib/item-types";
import { TypeTag } from "@/components/mrp-table";
import { PartnerTimeline, type TimelineOrder } from "@/components/partner-timeline";
import { saveSupplierCatalogue } from "../masters/actions";
import { matches } from "@/lib/url";
import { Badge, Card, Chips, Mono, PageHeader, SegmentedTabs } from "@/components/ui";

export const instant = false;

type Row = {
  id: string; name: string; code: string; sub: string; tag: string; tagTone: "info" | "warn" | "neutral";
  facts: [string, string][]; orders: TimelineOrder[];
  active: boolean;
  locked: string | null; // why it can't be removed right now
  form: { leadTimeDays?: number; segment?: string; labelFormat?: string; gstin?: string; address?: string };
};

type Kind = "supplier" | "customer";
const kindOf = (f: FormData): Kind => (f.get("kind") === "supplier" ? "supplier" : "customer");
const back = (kind: Kind) => `/partners?tab=${kind === "supplier" ? "suppliers" : "customers"}&edit=1`;
const raw = (f: FormData) => Object.fromEntries(f.entries());

// Customers and suppliers used to be edited under Masters. Each action re-checks the permission itself.
async function addPartner(f: FormData) {
  "use server";
  await requirePermission("partners.manage");
  const kind = kindOf(f);
  return runAction(back(kind), kind === "supplier" ? "Supplier added." : "Customer added.", async () => {
    await (kind === "supplier" ? createSupplier(raw(f)) : createCustomer(raw(f)));
  });
}

async function savePartner(f: FormData) {
  "use server";
  await requirePermission("partners.manage");
  const kind = kindOf(f);
  const id = String(f.get("id"));
  return runAction(back(kind), kind === "supplier" ? "Supplier updated." : "Customer updated.", async () => {
    await (kind === "supplier" ? updateSupplier(id, raw(f)) : updateCustomer(id, raw(f)));
  });
}

async function removePartner(f: FormData) {
  "use server";
  await requirePermission("partners.manage");
  const kind = kindOf(f);
  const id = String(f.get("id"));
  let outcome = "";
  return runAction(back(kind), () => outcome, async () => {
    const r = await (kind === "supplier" ? removeSupplier(id) : removeCustomer(id));
    const what = kind === "supplier" ? "Supplier" : "Customer";
    outcome = r === "deleted" ? `${what} deleted.` : `${what} has order history, so it was made inactive instead. Reactivate it any time.`;
  });
}

async function reactivatePartner(f: FormData) {
  "use server";
  await requirePermission("partners.manage");
  const kind = kindOf(f);
  return runAction(back(kind), "Reactivated.", async () => { await setActive(kind, String(f.get("id")), true); });
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ v?: string; tab?: string; filter?: string; id?: string; q?: string; edit?: string; error?: string; ok?: string }> }) {
  const user = await requireView("partners");
  const sp = await searchParams;
  const canEdit = can(user, "partners.manage");
  const editing = canEdit && sp.edit === "1";
  const sup = sp.tab === "suppliers";
  const q = sp.q?.trim() || undefined;

  const rows: Row[] = sup
    ? (await db.supplier.findMany({ orderBy: { code: "asc" }, include: { pos: { orderBy: { createdAt: "desc" }, include: { lines: { include: { item: true } } } }, prices: { include: { item: true } } } }))
        .map((s) => ({
          id: s.id, name: s.name, code: s.code, sub: `Lead time ${s.leadTimeDays} d${s.active ? "" : " · inactive"}`, tag: "Supplier", tagTone: "neutral" as const,
          active: s.active, form: { leadTimeDays: s.leadTimeDays },
          locked: s.pos.some((p) => p.status === "APPROVED" || p.status === "PARTIAL") ? "Has open POs: close or cancel them first" : null,
          facts: [["Supplies", s.prices.map((p) => p.item.code).join(", ") || "—"], ["Lead time", `${s.leadTimeDays} days`], ["Purchase orders", String(s.pos.length)], ["Status", s.active ? "Active" : "Inactive"]],
          orders: s.pos.map((p) => ({
            key: p.id, href: `/purchase/${p.id}`, date: p.createdAt.toISOString(),
            until: p.lines.map((l) => l.expectedDate).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString(),
            id: p.poNumber, what: p.lines.map((l) => l.item.name).join(", "),
            meta: `${p.lines.map((l) => `${Number(l.qty).toLocaleString()} ${l.item.uom}`).join(" + ")} · ${day(p.createdAt)}`,
            status: p.status, open: p.status === "APPROVED" || p.status === "PARTIAL",
          })),
        }))
    : (await db.customer.findMany({ orderBy: { code: "asc" }, include: { dispatches: { orderBy: { createdAt: "desc" }, include: { lines: { include: { item: true } } } }, demandLines: { orderBy: { dueDate: "asc" }, include: { fgItem: true } }, returnables: true } }))
        .map((c) => {
          const today = new Date(new Date().toDateString());
          const out = c.returnables.reduce((a, r) => a + (r.move === "ISSUED" ? r.qty : -r.qty), 0);
          return {
            id: c.id, name: c.name, code: c.code, sub: `${c.labelFormat === "OEM" ? "OEM QR label" : "Generic label"}${c.gstin ? ` · ${c.gstin}` : ""}${c.active ? "" : " · inactive"}`,
            active: c.active, form: { segment: c.segment, labelFormat: c.labelFormat, gstin: c.gstin ?? "", address: c.address ?? "" },
            locked: c.dispatches.some((d) => d.status === "LOADING") ? "Has a dispatch being loaded" : null,
            tag: c.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto", tagTone: c.segment === "AUTOMOTIVE" ? "info" as const : "warn" as const,
            facts: [["Segment", c.segment === "AUTOMOTIVE" ? "Automotive (IATF rules)" : "Non-automotive"], ["Label", c.labelFormat === "OEM" ? "OEM QR format" : "Internal label"], ["GSTIN", c.gstin ?? "—"], ["Address", c.address ?? "—"], ["Returnables out", String(Math.max(out, 0))]],
            orders: [
              ...c.demandLines.map((d) => ({ key: d.id, date: d.dueDate.toISOString(), id: `${d.type} · ${d.fgItem.code}`, what: d.fgItem.name, meta: `${d.qty.toLocaleString()} pcs · due ${day(d.dueDate)}`, status: d.dueDate >= today ? "Open" : "Past due", open: d.dueDate >= today })),
              ...c.dispatches.map((x) => ({ key: x.id, href: `/dispatch/${x.id}`, date: x.createdAt.toISOString(), id: x.dcNumber, what: x.lines.map((l) => l.item.name).join(", ") || "Dispatch", meta: `${x.lines.reduce((a, l) => a + l.qty, 0).toLocaleString()} pcs · ${day(x.createdAt)}`, status: x.status, open: x.status === "LOADING" })),
            ],
          };
        });

  const openN = (r: Row) => r.orders.filter((o) => o.open).length;
  const bucket = (r: Row) => (openN(r) > 0 ? 1 : r.orders.length > 0 ? 2 : 3);
  const filter = Number(sp.filter) || 0;
  const link = (over: Record<string, string>) => `/partners?${new URLSearchParams({ tab: sup ? "suppliers" : "customers", ...(q ? { q } : {}), ...over })}`;
  const kind: Kind = sup ? "supplier" : "customer";
  const shown = rows.filter((r) => (filter === 0 || bucket(r) === filter) && matches(q, r.name, r.code, r.sub, r.tag));
  const sel = !editing && sp.id ? rows.find((r) => r.id === sp.id) : undefined;
  const oneLabel = sup ? "supplier" : "customer";

  // A supplier is specific to the products it supplies: the same price list that sits on each item, from the supplier's side.
  const canCatalogue = can(user, "masters.manage");
  const catalogue = sup && sel ? await Promise.all([
    db.priceMaster.findMany({ where: { supplierId: sel.id }, include: { item: true }, orderBy: { item: { code: "asc" } } }),
    canCatalogue ? db.item.findMany({ where: { active: true, category: { notIn: ["FG", "REGRIND"] } }, orderBy: { code: "asc" } }) : Promise.resolve([]),
  ]) : null;

  if (sel) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sel.code} title={sel.name} subtitle={sel.sub}>
          <Link href={link({})} className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> {sup ? "Suppliers" : "Customers"}</Link>
        </PageHeader>
        <Flash error={sp.error} ok={sp.ok} />
        <div className={sup ? "grid items-start gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" : ""}>
        <Card className="space-y-2">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-wide text-ink-3">Details</h2>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-1">{sel.facts.filter(([k]) => !(sup && k === "Supplies")).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line py-1 last:border-0"><dt className="text-ink-3">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}</dl>
        </Card>
        {catalogue && (
          <Card className="min-w-0 space-y-3">
            <div>
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-wide text-ink-3">Products this supplier supplies</h2>
              <p className="mt-1 text-[13px] text-ink-3">
                {canCatalogue ? "With this supplier's price for each. The PO form and MRP offer it for these." : "What it supplies, and its price for each."}
              </p>
            </div>
            {canCatalogue ? (
              <Form action={saveSupplierCatalogue} className="space-y-3">
                <input type="hidden" name="supplierId" value={sel.id} />
                <input type="hidden" name="back" value={`/partners?tab=suppliers&id=${sel.id}`} />
                <CatalogueRows compact kind="item" options={catalogue[1].map((i) => ({ id: i.id, label: `${i.code} · ${i.name}`, hint: `${itemType(i.category).name}, priced per ${i.uom}`, category: i.category, unit: i.uom }))}
                  initial={catalogue[0].map((p) => ({ id: p.itemId, price: String(Number(p.price)) }))} emptyNote="No products listed yet. Add the ones this supplier provides." />
                <button className={btnCls}>Save products</button>
              </Form>
            ) : catalogue[0].length === 0 ? <p className="text-sm text-ink-3">No products listed.</p> : (
              <ul className="divide-y divide-line text-sm">
                {catalogue[0].map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2"><span className="flex items-center gap-2"><TypeTag category={p.item.category} /><span><b>{p.item.code}</b> <span className="text-ink-3">{p.item.name}</span></span></span><Mono className="text-xs">₹{Number(p.price)} / {p.item.uom}</Mono></li>
                ))}
              </ul>
            )}
          </Card>
        )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[15px] font-bold text-ink-3">Orders <span className="ml-1 text-xs font-normal">{sel.orders.length} total · {openN(sel)} open</span></h2>
          {sel.orders.length > 0 && (
            <nav aria-label="Orders view" className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1 text-[13px] font-semibold">
              {(["list", "timeline"] as const).map((m) => (
                <Link key={m} href={link({ id: sel.id, v: m })} aria-current={(sp.v === "timeline" ? "timeline" : "list") === m} className={`flex min-h-9 items-center justify-center rounded-lg px-4 ${(sp.v === "timeline" ? "timeline" : "list") === m ? "bg-white shadow-sm" : "text-ink-3"}`}>{m === "list" ? "List" : "Timeline"}</Link>
              ))}
            </nav>
          )}
        </div>
        {sel.orders.length === 0 && (
          <Card className="space-y-1"><p className="text-sm text-ink-3">No orders yet from this {oneLabel}.</p>
            <Link href={sup ? "/orders?new=po" : "/demand"} className="text-sm font-semibold text-accent">{sup ? "Raise first PO" : "Import first demand"}</Link></Card>
        )}
        {sel.orders.length > 0 && sp.v === "timeline" ? (
          <PartnerTimeline orders={[...sel.orders].sort((x, y) => x.date.localeCompare(y.date))} today={new Date().toISOString()} />
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sel.orders.map((o) => {
              const inner = (
                <>
                  <span className="flex min-w-0 flex-1 flex-col"><Mono className="text-[13px] font-semibold">{o.id}</Mono><span className="truncate text-sm">{o.what}</span><span className="text-xs text-ink-3">{o.meta}</span></span>
                  <Badge tone={o.open ? "info" : "neutral"}>{o.status}</Badge>
                </>
              );
              const cls = "flex items-center gap-3 rounded-xl bg-white px-3.5 py-3";
              return o.href ? <Link key={o.key} href={o.href} className={`${cls} hover:ring-1 hover:ring-accent`}>{inner}</Link> : <div key={o.key} className={cls}>{inner}</div>;
            })}
          </div>
        )}
      </div>
    );
  }

  const count = (b: number) => rows.filter((r) => bucket(r) === b).length;
  const tabQs = (t: string) => `/partners?tab=${t}${editing ? "&edit=1" : ""}`;

  // The same card in both modes: a link to the partner's orders normally, a tile that opens its edit form in edit mode.
  const cardBody = (r: Row) => (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-col"><span className="font-semibold">{r.name}</span><span className="text-xs text-ink-3"><Mono>{r.code}</Mono> · {r.sub}</span></span>
        <Badge tone={r.active ? r.tagTone : "neutral"}>{r.active ? r.tag : "Inactive"}</Badge>
      </span>
      <span className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
        <span className="flex flex-col"><strong className={`font-mono text-[15px] font-medium ${openN(r) ? "text-accent" : "text-ink-3"}`}>{openN(r)}</strong>Open orders</span>
        <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{r.orders.length}</strong>All orders</span>
        <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{r.orders[0] ? r.orders[0].meta.split("·").pop()!.trim() : "None yet"}</strong>Latest</span>
      </span>
    </>
  );
  const cardCls = "flex flex-col gap-2.5 rounded-[14px] bg-white p-3.5 text-left";

  const fields = (r?: Row) => sup ? (
    <>
      <label className="text-xs">Lead time (days)<input name="leadTimeDays" type="number" min="0" max="365" defaultValue={r?.form.leadTimeDays ?? 7} className={field} /></label>
    </>
  ) : (
    <>
      <label className="text-xs">Segment
        <select name="segment" defaultValue={r?.form.segment ?? "AUTOMOTIVE"} className={field}><option value="AUTOMOTIVE">Automotive</option><option value="NON_AUTOMOTIVE">Non-automotive</option></select>
      </label>
      <label className="text-xs">Label format
        <select name="labelFormat" defaultValue={r?.form.labelFormat ?? "OEM"} className={field}><option value="OEM">OEM</option><option value="GENERIC">Generic</option></select>
      </label>
      <label className="text-xs">GSTIN<input name="gstin" defaultValue={r?.form.gstin ?? ""} placeholder="for e-way bill" className={field} /></label>
      <label className="text-xs sm:col-span-2">Address<input name="address" defaultValue={r?.form.address ?? ""} className={field} /></label>
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="Customers & suppliers"
        right={canEdit ? (
          <Link href={editing ? `/partners?tab=${sup ? "suppliers" : "customers"}` : `/partners?tab=${sup ? "suppliers" : "customers"}&edit=1`} aria-pressed={editing}
            className={`flex min-h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold ${editing ? "bg-on-shell text-ink" : "bg-shell-2 text-on-shell"}`}>
            {editing ? <><Check size={15} aria-hidden /> Done</> : <><Pencil size={15} aria-hidden /> Edit list</>}
          </Link>
        ) : undefined}>
        <SegmentedTabs tabs={[{ href: tabQs("customers"), label: "Customers", active: !sup }, { href: tabQs("suppliers"), label: "Suppliers", active: sup }]} />
      </PageHeader>
      <Flash error={sp.error} ok={sp.ok} />
      {editing && (
        <p className="rounded-xl bg-info-bg px-3.5 py-2.5 text-[13px] text-info-ink">
          Editing the list. Tap a {oneLabel} to change its details, or the dotted box to add one. The red <b>−</b> deletes a {oneLabel} that was never used, or makes one with order history inactive; it is greyed out while there are open {sup ? "POs" : "dispatches"}.
        </p>
      )}
      <SearchBar q={q} placeholder={`Search ${oneLabel}s by name or code`} keep={{ tab: sup ? "suppliers" : undefined, filter: filter ? String(filter) : undefined, edit: editing ? "1" : undefined }} clearHref={`/partners?${new URLSearchParams({ tab: sup ? "suppliers" : "customers", ...(filter ? { filter: String(filter) } : {}), ...(editing ? { edit: "1" } : {}) })}`} />
      <Chips chips={[
        { href: link({ ...(editing ? { edit: "1" } : {}) }), label: "All", n: rows.length, active: filter === 0 },
        { href: link({ filter: "1", ...(editing ? { edit: "1" } : {}) }), label: "Open orders", n: count(1), active: filter === 1 },
        { href: link({ filter: "2", ...(editing ? { edit: "1" } : {}) }), label: "Past orders only", n: count(2), active: filter === 2 },
        { href: link({ filter: "3", ...(editing ? { edit: "1" } : {}) }), label: "No orders", n: count(3), active: filter === 3 },
      ]} />
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => editing ? (
          <div key={r.id} className={`group/p relative has-[details[open]]:col-span-full ${r.active ? "" : "opacity-70"}`}>
            <Drawer label={`Edit ${r.name}`} tile={cardBody(r)} tileClass={`${cardCls} cursor-pointer ring-1 ring-transparent hover:ring-accent`}>
              <Form action={savePartner} intents={{ reactivate: reactivatePartner }} className="grid gap-3 rounded-[14px] border border-border bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="code" value={r.code} />
                <p className="text-[13px] font-semibold sm:col-span-2 lg:col-span-4">{r.name} <span className="font-normal text-ink-3">· code {r.code} can&apos;t be changed</span></p>
                <label className="text-xs sm:col-span-2">Name<input name="name" required defaultValue={r.name} className={field} /></label>
                {fields(r)}
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
                  <button className={btnCls}>Save</button>
                  {!r.active && <button name="intent" value="reactivate" formNoValidate className="min-h-12 cursor-pointer text-sm font-semibold text-accent">Reactivate</button>}
                </div>
              </Form>
            </Drawer>
            {r.active && (
              <Form action={removePartner} className="group-has-[details[open]]/p:hidden">
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={r.id} />
                <RemoveButton label={`Remove ${r.name}`} busy={!!r.locked} why={r.locked ?? ""} />
              </Form>
            )}
          </div>
        ) : (
          <Link key={r.id} href={link({ id: r.id, ...(filter ? { filter: String(filter) } : {}) })} className={`${cardCls} ${r.active ? "" : "opacity-70"}`}>
            {cardBody(r)}
          </Link>
        ))}
        {editing && (
          <Drawer label={`Add a ${oneLabel}`} className="open:col-span-full" tileClass={`flex min-h-32 flex-col items-center justify-center gap-1 rounded-[14px] ${dotted}`}
            tile={<><Plus size={26} aria-hidden /><span className="text-sm font-semibold">Add {oneLabel}</span></>}>
            <Form action={addPartner} className="grid gap-3 rounded-[14px] border-2 border-dashed border-accent bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="kind" value={kind} />
              <p className="text-[13px] font-semibold sm:col-span-2 lg:col-span-4">New {oneLabel}</p>
              <label className="text-xs">Code<input name="code" required maxLength={20} className={field} /></label>
              <label className="text-xs sm:col-span-1 lg:col-span-1">Name<input name="name" required className={field} /></label>
              {fields()}
              <div className="sm:col-span-2 lg:col-span-4"><button className={btnCls}>Create {oneLabel}</button></div>
            </Form>
          </Drawer>
        )}
        {shown.length === 0 && !editing && <Card><p className="text-sm text-ink-3">No {oneLabel}s match this filter.</p></Card>}
      </div>
    </div>
  );
}
