import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { recordQc } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("qc.inspect");
  const decision = String(formData.get("decision")) as "APPROVED" | "REJECTED" | "DEVIATED";
  await runAction("/qc", `Lot ${decision.toLowerCase()}.`, async () => {
    await recordQc({
      lotId: String(formData.get("lotId")),
      decision,
      mfi: num(formData.get("mfi")), moisturePct: num(formData.get("moisture")),
      density: num(formData.get("density")), tensile: num(formData.get("tensile")),
      remarks: String(formData.get("remarks") || "") || undefined,
      putawayLocationCode: String(formData.get("bin") || "") || undefined,
      userId: user.id,
    });
  });
}

export default async function QcPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("qc.inspect");
  const { error, ok } = await searchParams;
  const [pending, bins, recent] = await Promise.all([
    db.lot.findMany({
      where: { qcStatus: "PENDING_QC" }, orderBy: { receivedAt: "asc" },
      include: { item: true, grnLine: { include: { grn: { include: { po: true } } } } },
    }),
    db.location.findMany({ where: { type: "STORAGE" }, orderBy: { code: "asc" } }),
    db.lot.findMany({
      where: { qcStatus: { not: "PENDING_QC" } }, orderBy: { receivedAt: "desc" }, take: 10, include: { item: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">QC Queue</h1>
      <Flash error={error} ok={ok} />
      {pending.length === 0 && <p className="text-slate-500">No lots waiting for QC.</p>}
      {pending.map((l) => (
        <form key={l.id} action={decide} className="max-w-4xl space-y-3 rounded-lg border bg-white p-4">
          <input type="hidden" name="lotId" value={l.id} />
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <div><span className="font-semibold">{l.lotNumber}</span> · {l.item.code} {l.item.name}</div>
            <div className="text-slate-600">
              {Number(l.receivedQty)} {l.item.uom} · heat/lot {l.supplierLotNo} · {l.grnLine?.grn.po.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto"}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm">MFI (g/10min)<input name="mfi" type="number" step="any" className={inputCls} /></label>
            <label className="text-sm">Moisture %<input name="moisture" type="number" step="any" className={inputCls} /></label>
            <label className="text-sm">Density (g/cm³)<input name="density" type="number" step="any" className={inputCls} /></label>
            <label className="text-sm">Tensile (MPa)<input name="tensile" type="number" step="any" className={inputCls} /></label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">Remarks (required for deviation)<input name="remarks" className={inputCls} /></label>
            <label className="text-sm">Put-away bin (on approval)
              <select name="bin" className={inputCls}>
                <option value="">Leave in staging</option>
                {bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button name="decision" value="APPROVED" className={btnCls}>Approve</button>
            <button name="decision" value="DEVIATED" className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white">Accept with deviation</button>
            <button name="decision" value="REJECTED" className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white">Reject</button>
          </div>
        </form>
      ))}

      <h2 className="text-lg font-semibold">Recently decided</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Lot</th><th className="p-2">Item</th><th className="p-2">Status</th><th className="p-2">Tag</th></tr></thead>
          <tbody>
            {recent.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2 font-medium">{l.lotNumber}</td><td className="p-2">{l.item.code}</td><td className="p-2">{l.qcStatus}</td>
                <td className="p-2">{l.qcStatus !== "REJECTED" && <Link className="underline" href={`/qc/tag/${l.id}`} target="_blank">Print QR tag</Link>}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={4}>Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
