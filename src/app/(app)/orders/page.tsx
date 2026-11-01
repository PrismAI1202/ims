import Link from "next/link";
import { requirePermission } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listOrders, type OrderRow } from "@/server/services/orders";
import { SearchBar } from "@/components/search-bar";
import { href, matches } from "@/lib/url";
import { Badge, Card, Chips, Mono, PageHeader, ProgressBar } from "@/components/ui";

export const instant = false;

const DIRS = ["BUY", "SELL"] as const;
const STATES = ["open", "overdue", "closed"] as const;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function OrderCard({ o }: { o: OrderRow }) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col"><Mono className="text-[15px] font-semibold">{o.number}</Mono><span className="truncate text-[13px] text-ink-2">{o.party}</span></span>
        <span className="flex flex-none flex-col items-end gap-1"><Badge tone={o.tone}>{o.status}</Badge><Badge tone={o.direction === "BUY" ? "neutral" : "info"}>{o.direction === "BUY" ? "Buy" : "Sell"} · {o.kind}</Badge></span>
      </span>
      {o.lines.map((l, i) => (
        <span key={`${l.label}-${i}`} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="truncate"><strong>{l.label}</strong> <span className="text-ink-3">{l.sub}</span></span>
            <Mono className="flex-none text-xs">{l.done !== undefined && <>{l.done.toLocaleString()} / </>}{l.total.toLocaleString()} {l.uom}</Mono>
          </span>
          {l.done !== undefined && <ProgressBar value={l.done} max={l.total} color={l.done >= l.total ? "#1E7A46" : "#1D4ED8"} />}
        </span>
      ))}
      <span className="text-[11px] text-ink-3">{o.direction === "SELL" && o.kind !== "Dispatch" ? "Due" : "Created"} {day(o.date)}</span>
    </>
  );
  const cls = "flex flex-col gap-2.5 rounded-[14px] bg-white p-3.5";
  return o.href ? <Link href={o.href} className={cls}>{body}</Link> : <article className={cls}>{body}</article>;
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; dir?: string; state?: string }> }) {
  const user = await requirePermission("stock.view");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const dir = DIRS.find((d) => d === sp.dir);
  const state = STATES.find((s) => s === sp.state);

  const all = await listOrders();
  const inDir = all.filter((o) => !dir || o.direction === dir);
  const shown = inDir
    .filter((o) => !state || o.state === state)
    .filter((o) => matches(q, o.number, o.party, o.kind, o.status, ...o.lines.flatMap((l) => [l.label, l.sub])));
  const count = (s: (typeof STATES)[number]) => inDir.filter((o) => o.state === s).length;
  const nOpen = all.filter((o) => o.state !== "closed").length;

  const link = (over: { dir?: string; state?: string }) => href("/orders", { q, dir: "dir" in over ? over.dir : dir, state: "state" in over ? over.state : state });
  const quick = [
    can(user.role, "po.manage") && { href: "/purchase", label: "Supplier POs" },
    can(user.role, "mrp.plan") && { href: "/demand", label: "Customer demand" },
    can(user.role, "dispatch.manage") && { href: "/dispatch", label: "Dispatch" },
    { href: "/trace", label: "Trace a box or lot" },
  ].filter((x): x is { href: string; label: string } => !!x);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="BUY & SELL" title="Orders" subtitle={`${nOpen} open or overdue · ${all.length} in total`} />
      <SearchBar q={q} placeholder="Search order no., party, item or status" keep={{ dir, state }} clearHref={link({})} />
      <Chips chips={[
        { href: link({ dir: undefined }), label: "All", n: all.length, active: !dir },
        { href: link({ dir: "BUY" }), label: "Buy", n: all.filter((o) => o.direction === "BUY").length, active: dir === "BUY" },
        { href: link({ dir: "SELL" }), label: "Sell", n: all.filter((o) => o.direction === "SELL").length, active: dir === "SELL" },
      ]} />
      <Chips chips={[
        { href: link({ state: undefined }), label: "Any status", n: inDir.length, active: !state },
        ...STATES.map((s) => ({ href: link({ state: s }), label: s[0].toUpperCase() + s.slice(1), n: count(s), active: state === s })),
      ]} />
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((o) => <OrderCard key={o.key} o={o} />)}
        {shown.length === 0 && <Card><p className="text-sm text-ink-3">{q ? `No orders match “${q}”.` : "No orders in this view."}</p></Card>}
      </div>
      <div className="flex flex-wrap gap-x-4 border-t border-border pt-3">
        {quick.map((x) => <Link key={x.href} href={x.href} className="flex min-h-9 items-center text-[13px] font-semibold text-accent">{x.label}</Link>)}
      </div>
    </div>
  );
}
