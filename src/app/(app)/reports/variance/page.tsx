import { requirePermission } from "@/server/auth/guard";
import { DownloadLink } from "@/components/download-link";
import { varianceReport } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Card, Mono, PageHeader } from "@/components/ui";

export const instant = false;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string | undefined, fallback: Date) => {
  const d = s ? new Date(`${s}T00:00:00.000Z`) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
};

export default async function VariancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const today = new Date();
  const from = parse(sp.from, new Date(today.getTime() - 30 * 86_400_000));
  const toDay = parse(sp.to, today);
  const to = new Date(toDay.getTime() + 86_400_000); // inclusive of the chosen end day
  const bad = from >= to;
  const report = bad ? null : await varianceReport(from, to);

  const maxOf = report ? Math.max(1, ...report.rows.map((r) => Math.max(r.expected, r.issued))) : 1;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="TRACE & REPORTS" title="BOM variance" subtitle="Planned versus actual material use" />
      <p className="max-w-3xl text-sm text-ink-2">
        <b>Expected</b> is what the BOM says the booked production should have used. <b>Issued</b> is what the store handed to the floor in the same dates.
        A large positive variance suggests over-use, scrap or material still sitting at the machines; a negative one means booked output was made from material issued earlier.
      </p>
      <Card>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="text-[13px]">From<input name="from" type="date" defaultValue={iso(from)} className={inputCls} /></label>
          <label className="text-[13px]">To<input name="to" type="date" defaultValue={iso(toDay)} className={inputCls} /></label>
          <button className={btnCls}>Show</button>
        </form>
      </Card>
      {bad && <Flash error="The start date must be before the end date." />}
      {!bad && (
        <p className="flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
          <DownloadLink href={`/api/v1/export/variance?format=xlsx&from=${iso(from)}&to=${iso(toDay)}`}>Download Excel</DownloadLink>
          <DownloadLink href={`/api/v1/export/variance?format=csv&from=${iso(from)}&to=${iso(toDay)}`}>Download CSV</DownloadLink>
          <span className="font-normal text-ink-3">To get a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
        </p>
      )}
      {report && (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
            {[
              ["Bookings", report.totals.bookings], ["Good parts", report.totals.goodParts.toLocaleString()],
              ["Rejects", report.totals.rejectParts.toLocaleString()], ["Shots", report.totals.shots.toLocaleString()],
              ["Runner kg", report.totals.runnerKg],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-[10px] bg-white px-3.5 py-2.5">
                <div className="font-display text-xl font-extrabold">{value}</div><div className="text-xs text-ink-3">{label}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            {report.rows.map((r) => {
              const tone = r.variance > 0 ? "text-danger" : r.variance < 0 ? "text-warn-ink" : "";
              return (
                <article key={r.itemId} className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex flex-col"><strong>{r.code}</strong><span className="text-xs text-ink-3">{r.name}</span></span>
                    <span className={`text-right font-mono text-sm ${tone}`}>{r.variance > 0 ? "+" : ""}{r.variance.toLocaleString()} {r.uom}<br /><span className="text-[11px]">{r.variancePct === null ? "—" : `${r.variancePct > 0 ? "+" : ""}${r.variancePct}%`}</span></span>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-ink-3">
                    <div className="grid grid-cols-[3.5rem_1fr_6rem] items-center gap-2"><span>Expected</span><span aria-hidden className="h-2 rounded bg-canvas"><span className="block h-2 rounded bg-[#1D4ED8]" style={{ width: `${(r.expected / maxOf) * 100}%` }} /></span><Mono className="text-right text-ink-2">{r.expected.toLocaleString()} {r.uom}</Mono></div>
                    <div className="grid grid-cols-[3.5rem_1fr_6rem] items-center gap-2"><span>Issued</span><span aria-hidden className="h-2 rounded bg-canvas"><span className="block h-2 rounded bg-[#E98A3E]" style={{ width: `${(r.issued / maxOf) * 100}%` }} /></span><Mono className="text-right text-ink-2">{r.issued.toLocaleString()} {r.uom}</Mono></div>
                  </div>
                </article>
              );
            })}
            {report.rows.length === 0 && <Card><p className="text-sm text-ink-3">No production or issues in these dates.</p></Card>}
          </div>
        </>
      )}
    </div>
  );
}
