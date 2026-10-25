import Link from "next/link";
import { ScanLine } from "lucide-react";
import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { transferStock } from "@/server/services/inventory";
import { stockByItem } from "@/server/services/stock";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { NewPanel } from "@/components/new-panel";
import {
  Badge, Card, Chip, Chips, headerBtnCls, LegendDot, MinMaxBar, Mono, PageHeader, StoresTabs,
} from "@/components/ui";

export const instant = false;

async function transfer(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.transfer");
  const back = String(formData.get("back") || "/stock");
  await runAction(back, "Stock moved.", async () => {
    await transferStock({
      lotNumber: String(formData.get("lotNumber")).trim(),
      fromCode: String(formData.get("fromCode")).trim(),
      toCode: String(formData.get("toCode")).trim(),
      qty: Number(formData.get("qty")),
      userId: user.id,
    });
  });
}

const STATUS = {
  RED: { label: "Below min", color: "#B42318", fg: "text-danger" },
  YELLOW: { label: "Near ROP", color: "#E0A526", fg: "text-warn-ink" },
  GREEN: { label: "Optimal", color: "#1E7A46", fg: "text-ok" },
} as const;
type Status = keyof typeof STATUS;

const CATS: { key: string; label: string; match: (c: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "rm", label: "RM", match: (c) => c === "RM_RESIN" },
  { key: "mb", label: "MB", match: (c) => c === "RM_MASTERBATCH" },
  { key: "bop", label: "BOP", match: (c) => c === "BOP" },
  { key: "pkg", label: "PKG", match: (c) => c === "PACKAGING" || c === "RETURNABLE" },
  { key: "fg", label: "FG", match: (c) => c === "FG" },
];
const CAT_CHIP: Record<string, string> = {
  RM_RESIN: "RM", RM_MASTERBATCH: "MB", BOP: "BOP", PACKAGING: "PKG", RETURNABLE: "PKG", REGRIND: "RG", FG: "FG",
};

type BinState = "full" | "part" | "empty" | "hold";
const BIN_STYLE: Record<BinState, string> = {
  full: "bg-[#1D4ED8] text-white border-transparent",
  part: "bg-[#8FAEF0] text-ink border-transparent",
  empty: "bg-white text-ink-3 border-[#C9C5BC]",
  hold: "bg-[#E98A3E] text-ink border-transparent",
};

type Search = { error?: string; ok?: string; view?: string; status?: string; cat?: string; bin?: string; item?: string; q?: string };

export default async function StockPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("stock.view");
  const sp = await searchParams;
  const view = sp.view === "bins" ? "bins" : "stock";
  const canMove = can(user.role, "stock.transfer");

  const [rows, balances, locations] = await Promise.all([
    stockByItem(),
    db.stockBalance.findMany({
      where: { qty: { gt: 0 } },
      include: { lot: { include: { item: true } }, location: true },
      orderBy: [{ location: { code: "asc" } }, { lot: { receivedAt: "asc" } }],
    }),
    db.location.findMany({ orderBy: { code: "asc" } }),
  ]);

  const where = new Map<string, Set<string>>();
  for (const b of balances) {
    const set = where.get(b.lot.itemId) ?? new Set<string>();
    set.add(b.location.code);
    where.set(b.lot.itemId, set);
  }

  const header = (
    <PageHeader
      eyebrow={`STORES · ${user.role.replace("_", " ")}`}
      title="Stores"
      right={canMove ? <Link href="/scan" className={headerBtnCls}><ScanLine size={16} aria-hidden /> Scan</Link> : undefined}
    >
      <StoresTabs active={view} />
    </PageHeader>
  );

  if (view === "bins") {
    const byLoc = new Map<string, typeof balances>();
    for (const b of balances) byLoc.set(b.locationId, [...(byLoc.get(b.locationId) ?? []), b]);
    const stateOf = (locId: string): BinState => {
      const bs = byLoc.get(locId) ?? [];
      if (bs.length === 0) return "empty";
      if (bs.some((b) => b.lot.qcStatus === "PENDING_QC")) return "hold";
      return bs.some((b) => Number(b.qty) < Number(b.lot.receivedQty)) ? "part" : "full";
    };
    const racks = [...new Set(locations.map((l) => l.rack))];
    const highlight = new Set(sp.item ? (rows.find((r) => r.code === sp.item) ? [...(where.get(rows.find((r) => r.code === sp.item)!.itemId) ?? [])] : []) : []);
    const selected = sp.bin ? locations.find((l) => l.code === sp.bin) : undefined;
    const selBalances = selected ? byLoc.get(selected.id) ?? [] : [];
    const emptyTargets = locations.filter((l) => l.type === "STORAGE" && stateOf(l.id) === "empty");
    const here = `/stock?view=bins&bin=${selected?.code ?? ""}`;

    return (
      <div className="space-y-4">
        {header}
        <Flash error={sp.error} ok={sp.ok} />
        {canMove && (
          <NewPanel label="Move stock">
          <Card>
            <h2 className="mb-2 font-display text-sm font-bold">Move part of a lot</h2>
            <form action={transfer} className="grid gap-3 md:grid-cols-5">
              <label className="text-[13px]">Lot no.<input name="lotNumber" required placeholder="scan lot" className={inputCls} /></label>
              <label className="text-[13px]">From bin<input name="fromCode" required placeholder="scan bin" defaultValue={selected?.code} className={inputCls} /></label>
              <label className="text-[13px]">To bin<input name="toCode" required placeholder="scan bin" className={inputCls} /></label>
              <label className="text-[13px]">Qty<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
              <div className="flex items-end"><button className={`${btnCls} w-full`}>Transfer</button></div>
              <input type="hidden" name="back" value="/stock?view=bins" />
            </form>
          </Card>
          </NewPanel>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-ink-2">
          <LegendDot color="#1D4ED8" label="Full" />
          <LegendDot color="#8FAEF0" label="Part" />
          <LegendDot color="#FFFFFF" label="Empty" border />
          <LegendDot color="#E98A3E" label="QC hold" />
        </div>
        {sp.item && <p className="text-sm text-ink-2">Showing bins that hold <Mono className="font-semibold">{sp.item}</Mono> (outlined). <Link href="/stock?view=bins" className="font-semibold text-accent">Clear</Link></p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {racks.map((rack) => (
            <Card key={rack} className="space-y-2">
              <h2 className="font-display text-sm font-bold">{rack === "STG" ? "Staging (awaiting QC)" : `Rack ${rack}`}</h2>
              <div className="grid grid-cols-4 gap-1.5">
                {locations.filter((l) => l.rack === rack).map((l) => {
                  const st = stateOf(l.id);
                  const on = l.code === sp.bin;
                  const hi = highlight.has(l.code);
                  return (
                    <Link
                      key={l.id}
                      href={`/stock?view=bins&bin=${l.code}${sp.item ? `&item=${sp.item}` : ""}`}
                      scroll={false}
                      aria-label={`${l.code}, ${st === "hold" ? "QC hold" : st}`}
                      aria-pressed={on}
                      className={`flex h-11 items-center justify-center rounded-lg border font-mono text-[11px] ${BIN_STYLE[st]} ${on ? "outline-[3px] outline-offset-2 outline-ink" : ""} ${hi ? "ring-[3px] ring-accent ring-offset-1" : ""}`}
                    >
                      {l.code}
                    </Link>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

        {selected && (
          <section className="space-y-3 rounded-[14px] bg-shell p-4 text-on-shell">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[15px]">{selected.code}</span>
              <span className="text-xs text-on-shell-2">{selected.type === "STAGING" ? "Staging area" : `Rack ${selected.rack} · shelf ${selected.shelf} · bin ${selected.bin}`}</span>
            </div>
            {selBalances.length === 0 ? (
              <p className="text-sm">Empty bin. Move stock here from another bin.</p>
            ) : (
              selBalances.map((b) => (
                <div key={b.id} className="space-y-2 rounded-[10px] bg-shell-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span><Mono className="text-[13px]">{b.lot.lotNumber}</Mono> · {b.lot.item.code}</span>
                    <span><Mono>{Number(b.qty).toLocaleString()}</Mono> {b.lot.item.uom}</span>
                  </div>
                  <div className="text-xs text-on-shell-2">
                    {b.lot.item.name} · received {b.lot.receivedAt.toISOString().slice(0, 10)} · {b.lot.qcStatus.replace("_", " ")}
                  </div>
                  {canMove && emptyTargets.length > 0 && (
                    <form action={transfer} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="lotNumber" value={b.lot.lotNumber} />
                      <input type="hidden" name="fromCode" value={selected.code} />
                      <input type="hidden" name="qty" value={Number(b.qty)} />
                      <input type="hidden" name="back" value={here} />
                      <label className="text-xs text-on-shell-2">Move all to an empty bin
                        <select name="toCode" className="ml-2 min-h-10 rounded-lg border border-shell-line bg-shell px-2 font-mono text-xs text-white">
                          {emptyTargets.map((t) => <option key={t.id} value={t.code}>{t.code}</option>)}
                        </select>
                      </label>
                      <button className="min-h-10 cursor-pointer rounded-lg bg-accent px-4 text-sm font-semibold text-white">Move</button>
                    </form>
                  )}
                </div>
              ))
            )}
          </section>
        )}

      </div>
    );
  }

  // Stock view
  const st: Status | "ALL" = sp.status === "RED" || sp.status === "YELLOW" || sp.status === "GREEN" ? sp.status : "ALL";
  const catKey = CATS.find((c) => c.key === sp.cat)?.key ?? "all";
  const cat = CATS.find((c) => c.key === catKey)!;
  const search = sp.q?.trim() || undefined;
  const q = (over: Partial<{ status: string; cat: string }>) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    const s2 = over.status ?? (st === "ALL" ? "" : st);
    const c2 = over.cat ?? (catKey === "all" ? "" : catKey);
    if (s2) p.set("status", s2);
    if (c2) p.set("cat", c2);
    const qs = p.toString();
    return `/stock${qs ? `?${qs}` : ""}`;
  };
  const inCat = rows.filter((r) => cat.match(r.category) && matches(search, r.code, r.name, r.category));
  const count = (s: Status) => inCat.filter((r) => r.status === s).length;
  const shown = inCat.filter((r) => st === "ALL" || r.status === st);

  return (
    <div className="space-y-4">
      {header}
      <Flash error={sp.error} ok={sp.ok} />
      <SearchBar q={search} placeholder="Search item code or name" keep={{ status: st === "ALL" ? undefined : st, cat: catKey === "all" ? undefined : catKey }} clearHref={q({})} />
      <Chips
        chips={[
          { href: q({ status: "" }), label: "All", n: inCat.length, active: st === "ALL" },
          ...(["RED", "YELLOW", "GREEN"] as const).map((s) => ({ href: q({ status: s }), label: STATUS[s].label, n: count(s), active: st === s })),
        ]}
      />
      <Chips chips={CATS.map((c) => ({ href: q({ cat: c.key === "all" ? "" : c.key }), label: c.label, active: c.key === catKey }))} />
      <p className="text-xs text-ink-3">{shown.length} item{shown.length === 1 ? "" : "s"} · green bar = on hand, black tick = minimum</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => {
          const bins = [...(where.get(r.itemId) ?? [])].sort();
          const s = STATUS[r.status as Status];
          return (
            <article key={r.itemId} className="space-y-2 rounded-[14px] bg-white p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Chip>{CAT_CHIP[r.category] ?? r.category}</Chip>
                  <span className="truncate font-semibold">{r.name}</span>
                </span>
                <Mono className="flex-none text-sm">{r.onHand.toLocaleString()} {r.uom}</Mono>
              </div>
              <MinMaxBar value={r.onHand} min={r.minStock} max={r.maxStock} color={s.color} />
              <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
                <span>Min {r.minStock.toLocaleString()} · ROP {r.reorderPoint.toLocaleString()} · Max {r.maxStock.toLocaleString()} {r.uom}</span>
                <span className={`font-bold ${s.fg}`}>{s.label}</span>
              </div>
              <div className="flex flex-col gap-0.5 text-xs text-ink-2">
                <span>Stored in <Mono>{bins.length ? bins.join(", ") : "—"}</Mono></span>
                {r.pendingQc > 0 && <span>Awaiting QC <Mono>{r.pendingQc.toLocaleString()}</Mono> {r.uom}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {bins.length > 0 && (
                  <Link href={`/stock?view=bins&item=${r.code}`} className="flex min-h-9 items-center rounded-[10px] border border-border bg-[#f4f3ef] px-3 text-[13px] font-semibold">
                    Show on bin map
                  </Link>
                )}
                {r.status !== "GREEN" && r.category !== "FG" && can(user.role, "po.manage") && (
                  <Link href="/purchase" className={`flex min-h-9 items-center rounded-[10px] px-3 text-[13px] font-semibold ${r.status === "RED" ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn-ink"}`}>
                    {r.status === "RED" ? "Raise PO" : "Reorder"}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
        {shown.length === 0 && <Card><Badge tone="ok">All clear</Badge><p className="mt-2 text-sm text-ink-3">No items match this filter.</p></Card>}
      </div>
    </div>
  );
}
