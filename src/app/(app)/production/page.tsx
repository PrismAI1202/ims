import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { bookProduction } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { WeightInput } from "@/components/weight-input";

export const instant = false;

const LOT_ROWS = 4;
const optNum = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

async function book(formData: FormData) {
  "use server";
  const user = await requirePermission("production.book");
  let regrindSkipped = false;
  const message = () =>
    regrindSkipped
      ? "Production booked. No regrind item exists for this resin grade, so the runners were logged but not added to stock."
      : "Production booked.";
  await runAction("/production", message, async () => {
    const r = await bookProduction({
      bomId: String(formData.get("bomId")), machineId: String(formData.get("machineId")),
      shift: String(formData.get("shift")) as "A" | "B" | "C",
      shots: Number(formData.get("shots")), goodParts: Number(formData.get("goodParts")),
      rejectParts: Number(formData.get("rejectParts") || 0),
      runnerKgActual: optNum(formData.get("runnerKg")),
      regrindLocationCode: String(formData.get("regrindBin") || "") || undefined,
      note: String(formData.get("note") || "") || undefined, userId: user.id,
      // Lots that went into the machine: the link that makes a finished box traceable back to the supplier.
      materialLots: Array.from({ length: LOT_ROWS }, (_, i) => ({
        lotNumber: String(formData.get(`lot_${i}`) || "").trim(), qty: Number(formData.get(`lotqty_${i}`) || 0),
      })).filter((l) => l.lotNumber),
      requireMaterialLots: true,
    });
    regrindSkipped = r.regrindSkipped;
  });
}

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("production.book");
  const { error, ok } = await searchParams;
  const [boms, machines, bins, recent] = await Promise.all([
    db.bom.findMany({ include: { fgItem: true, mould: true }, orderBy: { fgItem: { code: "asc" } } }),
    db.machine.findMany({ orderBy: { code: "asc" } }),
    db.location.findMany({ where: { type: "STORAGE" }, orderBy: { code: "asc" } }),
    db.productionBooking.findMany({
      orderBy: { producedAt: "desc" }, take: 15,
      include: { bom: { include: { fgItem: true } }, machine: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Production Booking</h1>
      <Flash error={error} ok={ok} />
      {boms.length === 0 ? (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">No BOMs defined yet. Ask an admin to add one under Moulding BOM.</p>
      ) : (
        <form action={book} className="grid max-w-4xl gap-3 rounded-lg border bg-white p-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">Part / BOM
            <select name="bomId" required className={inputCls}>
              {boms.map((b) => <option key={b.id} value={b.id}>{b.fgItem.code} · {b.mould.code} ({b.mould.cavities} cav)</option>)}
            </select>
          </label>
          <label className="text-sm">Machine
            <select name="machineId" required className={inputCls}>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select>
          </label>
          <label className="text-sm">Shift
            <select name="shift" className={inputCls}><option>A</option><option>B</option><option>C</option></select>
          </label>
          <label className="text-sm">Shots (counter)<input name="shots" type="number" min="1" step="1" required className={inputCls} /></label>
          <label className="text-sm">Good parts<input name="goodParts" type="number" min="0" step="1" required className={inputCls} /></label>
          <label className="text-sm">Rejected parts<input name="rejectParts" type="number" min="0" step="1" defaultValue={0} className={inputCls} /></label>
          <label className="text-sm">Runner/sprue weighed (kg)
            <WeightInput name="runnerKg" placeholder="auto from mould" className={inputCls} />
          </label>
          <label className="text-sm">Regrind bin
            <select name="regrindBin" className={inputCls}><option value="">First storage bin</option>{bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}</select>
          </label>
          <div className="space-y-2 md:col-span-4">
            <div className="text-sm font-medium">Material lots used <span className="font-normal text-slate-500">(scan the lot tag of every resin and masterbatch fed to the machine; add regrind lots if used)</span></div>
            {Array.from({ length: LOT_ROWS }, (_, i) => (
              <div key={i} className="grid gap-2 md:grid-cols-4">
                <input name={`lot_${i}`} placeholder="Lot tag, e.g. LOT-261014-0001" autoComplete="off" className={`${inputCls} md:col-span-3`} aria-label={`Material lot ${i + 1}`} />
                <input name={`lotqty_${i}`} type="number" min="0" step="any" placeholder="Quantity used" className={inputCls} aria-label={`Quantity used ${i + 1}`} />
              </div>
            ))}
          </div>
          <label className="text-sm md:col-span-3">Note<input name="note" className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Book production</button></div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="p-2">Booking</th><th className="p-2">When</th><th className="p-2">Part</th><th className="p-2">Machine / shift</th>
            <th className="p-2 text-right">Shots</th><th className="p-2 text-right">Good</th><th className="p-2 text-right">Rejects</th>
            <th className="p-2 text-right">Reject %</th><th className="p-2 text-right">Runner kg</th>
          </tr></thead>
          <tbody>
            {recent.map((b) => {
              const total = b.goodParts + b.rejectParts;
              return (
                <tr key={b.id} className="border-t">
                  <td className="p-2 font-medium">{b.bookingNumber}</td>
                  <td className="p-2">{b.producedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="p-2">{b.bom.fgItem.code}</td><td className="p-2">{b.machine.code} / {b.shift}</td>
                  <td className="p-2 text-right">{b.shots.toLocaleString()}</td><td className="p-2 text-right">{b.goodParts.toLocaleString()}</td>
                  <td className="p-2 text-right">{b.rejectParts.toLocaleString()}</td>
                  <td className="p-2 text-right">{total ? ((b.rejectParts / total) * 100).toFixed(1) : "0.0"}%</td>
                  <td className="p-2 text-right">{Number(b.runnerKg)}</td>
                </tr>
              );
            })}
            {recent.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={9}>No production booked yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
