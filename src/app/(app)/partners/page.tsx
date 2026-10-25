import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { Badge, Card, Chips, Mono, PageHeader, SegmentedTabs } from "@/components/ui";

export const instant = false;

type Row = {
  id: string; name: string; code: string; sub: string; tag: string; tagTone: "info" | "warn" | "neutral";
  facts: [string, string][]; orders: { id: string; what: string; meta: string; status: string; open: boolean }[];
};

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string; id?: string }> }) {
  await requirePermission("stock.view");
  const sp = await searchParams;
  const sup = sp.tab === "suppliers";

  const rows: Row[] = sup
    ? (await db.supplier.findMany({ orderBy: { code: "asc" }, include: { pos: { orderBy: { createdAt: "desc" }, include: { lines: { include: { item: true } } } }, prices: { include: { item: true } } } }))
        .map((s) => ({
          id: s.id, name: s.name, code: s.code, sub: `Lead time ${s.leadTimeDays} d${s.active ? "" : " · inactive"}`, tag: "Supplier", tagTone: "neutral" as const,
          facts: [["Supplies", s.prices.map((p) => p.item.code).join(", ") || "—"], ["Lead time", `${s.leadTimeDays} days`], ["Purchase orders", String(s.pos.length)], ["Status", s.active ? "Active" : "Inactive"]],
          orders: s.pos.map((p) => ({
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
            id: c.id, name: c.name, code: c.code, sub: `${c.labelFormat === "OEM" ? "OEM QR label" : "Generic label"}${c.gstin ? ` · ${c.gstin}` : ""}`,
            tag: c.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto", tagTone: c.segment === "AUTOMOTIVE" ? "info" as const : "warn" as const,
            facts: [["Segment", c.segment === "AUTOMOTIVE" ? "Automotive (IATF rules)" : "Non-automotive"], ["Label", c.labelFormat === "OEM" ? "OEM QR format" : "Internal label"], ["GSTIN", c.gstin ?? "—"], ["Address", c.address ?? "—"], ["Returnables out", String(Math.max(out, 0))]],
            orders: [
              ...c.demandLines.map((d) => ({ id: `${d.type} · ${d.fgItem.code}`, what: d.fgItem.name, meta: `${d.qty.toLocaleString()} pcs · due ${day(d.dueDate)}`, status: d.dueDate >= today ? "Open" : "Past due", open: d.dueDate >= today })),
              ...c.dispatches.map((x) => ({ id: x.dcNumber, what: x.lines.map((l) => l.item.name).join(", ") || "Dispatch", meta: `${x.lines.reduce((a, l) => a + l.qty, 0).toLocaleString()} pcs · ${day(x.createdAt)}`, status: x.status, open: x.status === "LOADING" })),
            ],
          };
        });

  const openN = (r: Row) => r.orders.filter((o) => o.open).length;
  const bucket = (r: Row) => (openN(r) > 0 ? 1 : r.orders.length > 0 ? 2 : 3);
  const filter = Number(sp.filter) || 0;
  const q = (over: Record<string, string>) => `/partners?${new URLSearchParams({ tab: sup ? "suppliers" : "customers", ...over })}`;
  const shown = rows.filter((r) => filter === 0 || bucket(r) === filter);
  const sel = sp.id ? rows.find((r) => r.id === sp.id) : undefined;
  const oneLabel = sup ? "supplier" : "customer";

  if (sel) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sel.code} title={sel.name} subtitle={sel.sub}>
          <Link href={q({})} className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> {sup ? "Suppliers" : "Customers"}</Link>
        </PageHeader>
        <Card><dl className="grid gap-2 text-sm">{sel.facts.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}</dl></Card>
        <div className="flex items-baseline justify-between"><h2 className="font-display text-[15px] font-bold text-ink-3">Orders</h2><span className="text-xs text-ink-3">{sel.orders.length} total · {openN(sel)} open</span></div>
        {sel.orders.length === 0 && (
          <Card className="space-y-1"><p className="text-sm text-ink-3">No orders yet from this {oneLabel}.</p>
            <Link href={sup ? "/purchase" : "/demand"} className="text-sm font-semibold text-accent">{sup ? "Raise first PO" : "Import first demand"}</Link></Card>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {sel.orders.map((o, i) => (
            <div key={`${o.id}-${i}`} className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3">
              <span className="flex min-w-0 flex-1 flex-col"><Mono className="text-[13px] font-semibold">{o.id}</Mono><span className="truncate text-sm">{o.what}</span><span className="text-xs text-ink-3">{o.meta}</span></span>
              <Badge tone={o.open ? "info" : "neutral"}>{o.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const count = (b: number) => rows.filter((r) => bucket(r) === b).length;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="Customers & suppliers">
        <SegmentedTabs tabs={[{ href: "/partners?tab=customers", label: "Customers", active: !sup }, { href: "/partners?tab=suppliers", label: "Suppliers", active: sup }]} />
      </PageHeader>
      <Chips chips={[
        { href: q({}), label: "All", n: rows.length, active: filter === 0 },
        { href: q({ filter: "1" }), label: "Open orders", n: count(1), active: filter === 1 },
        { href: q({ filter: "2" }), label: "Past orders only", n: count(2), active: filter === 2 },
        { href: q({ filter: "3" }), label: "No orders", n: count(3), active: filter === 3 },
      ]} />
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => (
          <Link key={r.id} href={q({ id: r.id, ...(filter ? { filter: String(filter) } : {}) })} className="flex flex-col gap-2.5 rounded-[14px] bg-white p-3.5">
            <span className="flex items-start justify-between gap-2">
              <span className="flex flex-col"><span className="font-semibold">{r.name}</span><span className="text-xs text-ink-3"><Mono>{r.code}</Mono> · {r.sub}</span></span>
              <Badge tone={r.tagTone}>{r.tag}</Badge>
            </span>
            <span className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
              <span className="flex flex-col"><strong className={`font-mono text-[15px] font-medium ${openN(r) ? "text-accent" : "text-ink-3"}`}>{openN(r)}</strong>Open orders</span>
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{r.orders.length}</strong>All orders</span>
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{r.orders[0] ? r.orders[0].meta.split("·").pop()!.trim() : "None yet"}</strong>Latest</span>
            </span>
          </Link>
        ))}
        {shown.length === 0 && <Card><p className="text-sm text-ink-3">No {oneLabel}s match this filter.</p></Card>}
      </div>
    </div>
  );
}
