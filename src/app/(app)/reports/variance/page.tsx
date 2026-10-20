import { requirePermission } from "@/server/auth/guard";
import { varianceReport } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">BOM vs Actual Variance</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        <b>Expected</b> is what the BOM says the booked production should have used. <b>Issued</b> is what the store handed to the floor in the same dates.
        A large positive variance suggests over-use, scrap or material still sitting at the machines; a negative one means booked output was made from material issued earlier.
      </p>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">From<input name="from" type="date" defaultValue={iso(from)} className={inputCls} /></label>
        <label className="text-sm">To<input name="to" type="date" defaultValue={iso(toDay)} className={inputCls} /></label>
        <button className={btnCls}>Show</button>
      </form>
      {bad && <Flash error="The start date must be before the end date." />}
      {report && (
        <>
          <div className="grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Bookings", report.totals.bookings], ["Good parts", report.totals.goodParts.toLocaleString()],
              ["Rejects", report.totals.rejectParts.toLocaleString()], ["Shots", report.totals.shots.toLocaleString()],
              ["Runner kg", report.totals.runnerKg],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border bg-white p-3">
                <div className="text-xl font-semibold">{value}</div><div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left"><tr>
                <th className="p-2">Item</th><th className="p-2 text-right">Expected</th><th className="p-2 text-right">Issued</th>
                <th className="p-2 text-right">Variance</th><th className="p-2 text-right">Variance %</th>
              </tr></thead>
              <tbody>
                {report.rows.map((r) => {
                  const tone = r.variance > 0 ? "text-red-700" : r.variance < 0 ? "text-amber-700" : "";
                  return (
                    <tr key={r.itemId} className="border-t">
                      <td className="p-2"><div className="font-medium">{r.code}</div><div className="text-slate-500">{r.name}</div></td>
                      <td className="p-2 text-right">{r.expected.toLocaleString()} {r.uom}</td>
                      <td className="p-2 text-right">{r.issued.toLocaleString()} {r.uom}</td>
                      <td className={`p-2 text-right font-medium ${tone}`}>{r.variance > 0 ? "+" : ""}{r.variance.toLocaleString()} {r.uom}</td>
                      <td className={`p-2 text-right ${tone}`}>{r.variancePct === null ? "—" : `${r.variancePct > 0 ? "+" : ""}${r.variancePct}%`}</td>
                    </tr>
                  );
                })}
                {report.rows.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No production or issues in these dates.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
