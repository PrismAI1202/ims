import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { approveScrap, pendingScrap } from "@/server/services/scrap";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("scrap.approve");
  const kind = String(formData.get("kind")) === "REGRIND" ? "REGRIND" : "WASTE";
  await runAction("/qc/scrap", kind === "REGRIND" ? "Approved. The parts' weight was added to regrind stock." : "Approved as waste.", async () => {
    await approveScrap({
      bookingId: String(formData.get("bookingId")), parts: Number(formData.get("parts")), kind,
      regrindLocationCode: String(formData.get("bin") || "") || undefined, note: String(formData.get("note") || "") || undefined, userId: user.id,
    });
  });
}

export default async function ScrapPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("scrap.approve");
  const { error, ok } = await searchParams;
  const [pending, bins, history] = await Promise.all([
    pendingScrap(),
    db.location.findMany({ where: { type: "STORAGE" }, orderBy: { code: "asc" } }),
    db.scrapDisposition.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { booking: { include: { bom: { include: { fgItem: true } } } } } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Scrap Approval</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Rejected parts from production need a QA decision. <b>Regrind</b> crushes them back into usable regrind stock (not allowed for parts with inserts).
        <b> Waste</b> records them as scrapped.
      </p>
      <Flash error={error} ok={ok} />
      {pending.length === 0 && <p className="text-slate-500">No rejected parts waiting for a decision.</p>}
      {pending.map((p) => (
        <form key={p.bookingId} action={decide} className="max-w-4xl space-y-3 rounded-lg border bg-white p-4">
          <input type="hidden" name="bookingId" value={p.bookingId} />
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <div><span className="font-semibold">{p.bookingNumber}</span> · {p.part} · {p.machine} · {p.producedAt.toISOString().slice(0, 10)}</div>
            <div className="text-slate-600">{p.remaining.toLocaleString()} of {p.rejectParts.toLocaleString()} rejected parts to decide · {p.partWeightG} g each</div>
          </div>
          {p.hasInserts && <p className="text-xs text-amber-800">These parts contain inserts, so they can only be scrapped as waste.</p>}
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm">Parts<input name="parts" type="number" min="1" max={p.remaining} step="1" defaultValue={p.remaining} required className={inputCls} /></label>
            <label className="text-sm">Regrind bin
              <select name="bin" className={inputCls}><option value="">First storage bin</option>{bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}</select>
            </label>
            <label className="text-sm md:col-span-2">Note<input name="note" className={inputCls} /></label>
          </div>
          <div className="flex gap-2">
            <button name="kind" value="REGRIND" disabled={p.hasInserts} className={`${btnCls} disabled:opacity-40`}>Crush into regrind</button>
            <button name="kind" value="WASTE" className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white">Scrap as waste</button>
          </div>
        </form>
      ))}

      <h2 className="text-lg font-semibold">Recent decisions</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">When</th><th className="p-2">Booking</th><th className="p-2">Part</th><th className="p-2 text-right">Parts</th><th className="p-2 text-right">Weight kg</th><th className="p-2">Decision</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t">
                <td className="p-2">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td className="p-2">{h.booking.bookingNumber}</td><td className="p-2">{h.booking.bom.fgItem.code}</td>
                <td className="p-2 text-right">{h.parts.toLocaleString()}</td><td className="p-2 text-right">{Number(h.weightKg)}</td><td className="p-2">{h.kind === "REGRIND" ? "Regrind" : "Waste"}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
