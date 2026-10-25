import Link from "next/link";
import { DownloadLink } from "@/components/download-link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { cancelDispatch, completeDispatch, dispatchProgress, scanBox, unscanBox } from "@/server/services/dispatch";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function scan(formData: FormData) {
  "use server";
  await requirePermission("dispatch.manage");
  const id = String(formData.get("dispatchId"));
  let msg = "";
  await runAction(`/dispatch/${id}`, () => msg, async () => {
    const r = await scanBox({ dispatchId: id, scan: String(formData.get("scan") || "") });
    msg = `Loaded ${r.boxCode} (${r.qty.toLocaleString()}). ${r.scannedForLine.toLocaleString()} of ${r.ordered.toLocaleString()} for this part.`;
  });
}

async function remove(formData: FormData) {
  "use server";
  await requirePermission("dispatch.manage");
  const id = String(formData.get("dispatchId"));
  await runAction(`/dispatch/${id}`, "Box removed from the load.", async () => {
    await unscanBox({ dispatchId: id, boxCode: String(formData.get("boxCode")) });
  });
}

async function complete(formData: FormData) {
  "use server";
  const user = await requirePermission("dispatch.manage");
  const id = String(formData.get("dispatchId"));
  const crateItemId = String(formData.get("crateItemId") || "");
  const crateQty = Number(formData.get("crateQty") || 0);
  await runAction(`/dispatch/${id}`, "Dispatched. Stock has been deducted.", async () => {
    await completeDispatch({ dispatchId: id, crates: crateItemId && crateQty > 0 ? [{ itemId: crateItemId, qty: crateQty }] : [], userId: user.id });
  });
}

async function cancel(formData: FormData) {
  "use server";
  await requirePermission("dispatch.manage");
  const id = String(formData.get("dispatchId"));
  await runAction(`/dispatch/${id}`, "Dispatch cancelled; boxes released.", async () => { await cancelDispatch(id); });
}

export default async function DispatchDetail({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("dispatch.manage");
  const [{ id }, { error, ok }] = await Promise.all([params, searchParams]);
  const d = await db.dispatch.findUnique({ where: { id }, include: { customer: true } });
  if (!d) notFound();
  const [progress, crates] = await Promise.all([
    dispatchProgress(id), db.item.findMany({ where: { category: "RETURNABLE", active: true }, orderBy: { code: "asc" } }),
  ]);
  const loading = d.status === "LOADING";

  return (
    <div className="space-y-6">
      <Link href="/dispatch" className="text-sm underline">← Dispatches</Link>
      <div>
        <h1 className="text-2xl font-semibold">{d.dcNumber} <span className="text-base font-normal text-slate-500">· {d.status}</span></h1>
        <p className="text-sm text-slate-600">{d.customer.name} · vehicle {d.vehicleNumber}{d.driverName ? ` · driver ${d.driverName}` : ""}</p>
      </div>
      <Flash error={error} ok={ok} />

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full max-w-3xl text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Part</th><th className="p-2 text-right">Pick list</th><th className="p-2 text-right">Scanned</th><th className="p-2">Progress</th></tr></thead>
          <tbody>
            {progress.lines.map((l) => (
              <tr key={l.itemId} className="border-t">
                <td className="p-2"><div className="font-medium">{l.code}</div><div className="text-slate-500">{l.name}</div></td>
                <td className="p-2 text-right">{l.ordered.toLocaleString()}</td><td className="p-2 text-right">{l.scanned.toLocaleString()}</td>
                <td className={`p-2 ${l.scanned === l.ordered ? "text-green-700" : l.scanned > l.ordered ? "text-red-700" : "text-amber-700"}`}>
                  {l.scanned === l.ordered ? "Complete" : `${(l.ordered - l.scanned).toLocaleString()} to go`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && (
        <form action={scan} className="flex max-w-xl items-end gap-3 rounded-lg border bg-white p-4">
          <input type="hidden" name="dispatchId" value={d.id} />
          <label className="flex-1 text-sm font-medium">Scan box label
            <input name="scan" autoFocus required autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${inputCls} text-base`} />
          </label>
          <button className={btnCls}>Load box</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full max-w-3xl text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Box</th><th className="p-2">Part</th><th className="p-2">Batch</th><th className="p-2 text-right">Qty</th><th className="p-2"></th></tr></thead>
          <tbody>
            {progress.boxes.map((b) => (
              <tr key={b.boxCode} className="border-t">
                <td className="p-2 font-medium">{b.boxCode}</td><td className="p-2">{b.itemCode}</td><td className="p-2">{b.batchCode ?? "—"}</td>
                <td className="p-2 text-right">{b.qty.toLocaleString()}</td>
                <td className="p-2">{loading && (
                  <form action={remove}><input type="hidden" name="dispatchId" value={d.id} /><input type="hidden" name="boxCode" value={b.boxCode} /><button className="text-xs underline">Remove</button></form>
                )}</td>
              </tr>
            ))}
            {progress.boxes.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No boxes scanned yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="max-w-3xl space-y-3">
          <form action={complete} className="space-y-3 rounded-lg border bg-white p-4">
            <input type="hidden" name="dispatchId" value={d.id} />
            <h2 className="font-medium">Complete dispatch</h2>
            <p className="text-sm text-slate-600">Stock is deducted only when you complete. Add the returnable crates going out with this load, if any.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm md:col-span-2">Crates / trolleys / pallets
                <select name="crateItemId" className={inputCls}><option value="">None</option>{crates.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
              </label>
              <label className="text-sm">Quantity<input name="crateQty" type="number" min="0" step="1" className={inputCls} /></label>
            </div>
            <button className={btnCls} disabled={!progress.complete}>{progress.complete ? "Complete & dispatch" : "Scan the full pick list first"}</button>
          </form>
          <form action={cancel}><input type="hidden" name="dispatchId" value={d.id} /><button className="text-sm text-red-700 underline">Cancel this dispatch</button></form>
        </div>
      )}

      {d.status !== "CANCELLED" && (
        <p className="flex gap-4 text-sm">
          <Link className="underline" target="_blank" href={`/dispatch/${d.id}/dc`}>Delivery challan &amp; packing list</Link>
          <DownloadLink href={`/api/v1/dispatch/${d.id}/eway`}>Download e-way bill data (JSON)</DownloadLink>
        </p>
      )}
    </div>
  );
}
