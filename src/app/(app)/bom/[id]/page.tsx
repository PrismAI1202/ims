import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listGroups } from "@/server/services/equivalents";
import { bomVariance } from "@/server/services/production";
import { DownloadLink } from "@/components/download-link";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { BLEND_COLORS, Badge, Chip, Mono, PageHeader, StackedBar } from "@/components/ui";

export const instant = false;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string | undefined, fallback: Date) => {
  const d = s ? new Date(`${s}T00:00:00.000Z`) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
};

/** A titled block with its own colour, so blend, variance and grades read as separate things. Its cards sit on a tinted body. */
function Block({ color, title, note, children, aside }: { color: string; title: string; note?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" style={{ borderTop: `4px solid ${color}` }}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pb-3 pt-3.5">
        <div>
          <h2 className="font-display text-base font-bold" style={{ color }}>{title}</h2>
          {note && <p className="mt-0.5 max-w-2xl text-[13px] text-ink-2">{note}</p>}
        </div>
        {aside}
      </header>
      <div className="space-y-3 border-t border-line bg-canvas p-3.5">{children}</div>
    </section>
  );
}

/**
 * One BOM in depth. Anyone who can open BOMs sees the blend and the alternate grades of its materials; planned versus actual use
 * is for roles with the variance permission, and editing for roles that can edit BOMs.
 */
export default async function BomDetail({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; error?: string; ok?: string }> }) {
  const user = await requireView("bom");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const bom = await db.bom.findUnique({ where: { id }, include: { fgItem: true, mould: true, lines: { include: { item: true } } } });
  if (!bom) notFound();

  const canEdit = can(user, "bom.manage"), canVariance = can(user, "reports.view");
  const today = new Date();
  const from = parse(sp.from, new Date(today.getTime() - 30 * 86_400_000));
  const toDay = parse(sp.to, today);
  const bad = from >= new Date(toDay.getTime() + 86_400_000);
  const [variance, groups] = await Promise.all([
    canVariance && !bad ? bomVariance(id, from, new Date(toDay.getTime() + 86_400_000)) : null,
    listGroups(),
  ]);

  const itemIds = new Set(bom.lines.map((l) => l.itemId));
  const mine = groups.filter((g) => itemIds.has(g.itemId));
  const lacking = bom.lines.filter((l) => !mine.some((g) => g.itemId === l.itemId) && ["RESIN", "MASTERBATCH", "BOP", "PACKAGING"].includes(l.kind));
  const pctOf = (kind: string) => bom.lines.filter((l) => l.kind === kind).reduce((a, l) => a + Number(l.pct ?? 0), 0);
  const virgin = pctOf("RESIN"), regrind = pctOf("REGRIND"), mb = pctOf("MASTERBATCH");
  const maxOf = variance ? Math.max(1, ...variance.rows.map((r) => Math.max(r.forPart, r.plantExpected, r.issued))) : 1;

  const rejectPct = variance && variance.totals.goodParts + variance.totals.rejectParts > 0
    ? (variance.totals.rejectParts / (variance.totals.goodParts + variance.totals.rejectParts)) * 100 : null;
  const limit = Math.min(...bom.lines.filter((l) => l.kind === "RESIN" && l.item.maxRegrindPct !== null).map((l) => Number(l.item.maxRegrindPct)), 100);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="BOM" title={bom.fgItem.name} subtitle={`${bom.fgItem.code} · ${bom.mould.code} · ${bom.mould.cavities} cav · ${Number(bom.partWeightG)} g/part`}
        right={canEdit ? <Link href={`/bom?edit=${bom.id}`} className="flex min-h-10 items-center rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">Edit BOM</Link> : undefined}>
        <Link href="/bom" className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> All BOMs</Link>
      </PageHeader>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Right on a desktop, first on a phone: the part at a glance. */}
        <aside className="order-first space-y-3 lg:sticky lg:top-4 lg:order-last">
          <div className="space-y-3 rounded-2xl border border-line bg-white p-4" style={{ borderTop: `4px solid ${BLEND_COLORS.masterbatch}` }}>
            <h2 className="font-display text-base font-bold">Blend</h2>
            <StackedBar parts={[
              { pct: virgin, color: BLEND_COLORS.virgin, label: `${virgin}%` }, { pct: regrind, color: BLEND_COLORS.regrind, label: `${regrind}%` }, { pct: mb, color: BLEND_COLORS.masterbatch, label: `${mb}%` },
            ]} />
            <ul className="grid gap-1.5 text-[13px]">
              {bom.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <Chip>{l.kind === "RESIN" ? "RM" : l.kind === "MASTERBATCH" ? "MB" : l.kind === "REGRIND" ? "RG" : l.kind === "BOP" ? "BOP" : "PKG"}</Chip>
                  <span className="min-w-0 flex-1 truncate" title={`${l.item.name} (${l.item.code})`}>{l.item.name}</span>
                  <Mono className="text-xs">{l.pct !== null ? `${Number(l.pct)}%` : `${Number(l.qtyPerPart)} ${l.item.uom}/part`}</Mono>
                </li>
              ))}
            </ul>
            {limit < 100 && <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-ink-3"><span>Max regrind</span><Badge tone={regrind > limit ? "danger" : "neutral"}>{limit}%</Badge></div>}
          </div>

          {variance && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {([
                ["Bookings", variance.totals.bookings.toLocaleString()], ["Shots", variance.totals.shots.toLocaleString()],
                ["Good parts", variance.totals.goodParts.toLocaleString()], ["Rejects", variance.totals.rejectParts.toLocaleString()],
                ["Reject rate", rejectPct === null ? "—" : `${rejectPct.toFixed(1)}%`], ["Materials", String(bom.lines.length)],
              ] as const).map(([label, value]) => (
                <div key={label} className="bg-white px-3.5 py-2.5"><dd className="font-display text-lg font-extrabold">{value}</dd><dt className="text-[11px] text-ink-3">{label}</dt></div>
              ))}
            </dl>
          )}
          {variance && <p className="px-1 text-[11px] text-ink-3">Booking figures cover {iso(from)} to {iso(toDay)}.</p>}
        </aside>

        <div className="min-w-0 space-y-5">
          {canVariance && (
            <Block color="#1D4ED8" title="Planned versus actual"
              note="For this part is what the BOM says its bookings should have used. Issued is what stores handed to the floor in the same dates, less returns. Issues are counted per material, so where other parts share a material the variance covers all of them.">
              <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3">
                <label className="text-[13px]">From<input name="from" type="date" defaultValue={iso(from)} className={inputCls} /></label>
                <label className="text-[13px]">To<input name="to" type="date" defaultValue={iso(toDay)} className={inputCls} /></label>
                <button className={btnCls}>Show</button>
                {!bad && (
                  <span className="ml-auto flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
                    <DownloadLink href={`/api/v1/export/variance?format=xlsx&from=${iso(from)}&to=${iso(toDay)}`}>Excel (all parts)</DownloadLink>
                    <DownloadLink href={`/api/v1/export/variance?format=csv&from=${iso(from)}&to=${iso(toDay)}`}>CSV (all parts)</DownloadLink>
                  </span>
                )}
              </form>
              {bad && <Flash error="The start date must be before the end date." />}
              {variance && (
                <div className="grid gap-2.5 md:grid-cols-2">
                  {variance.rows.map((r) => {
                    const tone = r.variance > 0 ? "text-danger" : r.variance < 0 ? "text-warn-ink" : "";
                    const bar = (v: number, color: string) => <span aria-hidden className="h-2 rounded bg-canvas"><span className="block h-2 rounded" style={{ width: `${(v / maxOf) * 100}%`, background: color }} /></span>;
                    return (
                      <article key={r.itemId} className="flex flex-col gap-2 rounded-xl bg-white p-3.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="flex flex-col"><strong>{r.code}</strong><span className="text-xs text-ink-3">{r.name}</span></span>
                          <span className={`text-right font-mono text-sm ${tone}`}>{r.variance > 0 ? "+" : ""}{r.variance.toLocaleString()} {r.uom}<br /><span className="text-[11px]">{r.variancePct === null ? "—" : `${r.variancePct > 0 ? "+" : ""}${r.variancePct}%`}</span></span>
                        </div>
                        <div className="space-y-1.5 text-[11px] text-ink-3">
                          <div className="grid grid-cols-[4.5rem_1fr_6rem] items-center gap-2"><span>For this part</span>{bar(r.forPart, "#1D4ED8")}<Mono className="text-right text-ink-2">{r.forPart.toLocaleString()} {r.uom}</Mono></div>
                          {r.shared && <div className="grid grid-cols-[4.5rem_1fr_6rem] items-center gap-2"><span>All parts</span>{bar(r.plantExpected, "#8FAEF0")}<Mono className="text-right text-ink-2">{r.plantExpected.toLocaleString()} {r.uom}</Mono></div>}
                          <div className="grid grid-cols-[4.5rem_1fr_6rem] items-center gap-2"><span>Issued</span>{bar(r.issued, "#E98A3E")}<Mono className="text-right text-ink-2">{r.issued.toLocaleString()} {r.uom}</Mono></div>
                        </div>
                        {r.shared && <p className="text-[11px] text-ink-3">Shared with other parts: the variance above covers all of them.</p>}
                      </article>
                    );
                  })}
                </div>
              )}
              {variance && variance.totals.bookings === 0 && <p className="rounded-xl bg-white p-3 text-sm text-ink-3">This part was not booked in these dates.</p>}
            </Block>
          )}

          <Block color="#C2410C" title="Equivalent groups"
            note="Approved alternate grades for the materials in this BOM. If the main source fails, the next approved grade can be used."
            aside={<Link href="/bom/groups" className="text-[13px] font-semibold text-accent">All groups →</Link>}>
            {mine.length === 0 && <p className="rounded-xl bg-white p-3 text-sm text-ink-3">None of this BOM&apos;s materials is in an equivalent group yet.</p>}
            <div className="grid gap-2.5 md:grid-cols-2">
              {mine.map((g) => {
                const pending = g.grades.filter((x) => x.status === "PENDING_QA").length;
                return (
                  <Link key={g.id} href={`/bom/groups?id=${g.id}`} className="flex flex-col gap-2 rounded-xl bg-white p-3.5 transition-shadow hover:shadow-md">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex flex-col"><strong>{g.name}</strong><span className="text-xs text-ink-3">{g.code} · {g.itemCode}</span></span>
                      <Mono className="text-xs">{g.onHand.toLocaleString()} {g.uom}</Mono>
                    </div>
                    <ul className="grid gap-1 text-[13px]">
                      {g.grades.map((x) => (
                        <li key={x.id} className="flex items-center gap-2">
                          <Badge tone={x.status === "APPROVED" ? "ok" : x.status === "PENDING_QA" ? "warn" : "danger"}>{x.status === "APPROVED" ? `#${x.rank}` : x.status === "PENDING_QA" ? "Pending QA" : "Rejected"}</Badge>
                          <span className="min-w-0 flex-1 truncate">{x.gradeName} <span className="text-ink-3">· {x.supplierName}</span></span>
                          <Mono className="text-xs">{x.stock.toLocaleString()}</Mono>
                        </li>
                      ))}
                    </ul>
                    {g.warning && <p className="rounded-lg bg-warn-bg px-2.5 py-1.5 text-xs text-warn-ink">{g.warning}</p>}
                    {pending > 0 && can(user, "qc.inspect") && <p className="text-xs font-semibold text-accent">{pending} grade{pending === 1 ? "" : "s"} waiting for your approval →</p>}
                  </Link>
                );
              })}
            </div>
            {lacking.length > 0 && (
              <p className="text-xs text-ink-3">No group yet for {lacking.map((l) => l.item.code).join(", ")}.{can(user, "equivalents.manage") && " Create one from All groups."}</p>
            )}
          </Block>
        </div>
      </div>
    </div>
  );
}
