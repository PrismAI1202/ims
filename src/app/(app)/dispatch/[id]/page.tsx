import Link from "next/link";
import { DownloadLink } from "@/components/download-link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { cancelDispatch, completeDispatch, dispatchProgress, scanBox, unscanBox } from "@/server/services/dispatch";
import { btnCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader, ProgressBar } from "@/components/ui";

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

  const totalOrdered = progress.lines.reduce((a, l) => a + l.ordered, 0);
  const totalScanned = progress.lines.reduce((a, l) => a + Math.min(l.scanned, l.ordered), 0);
  const tone = d.status === "DISPATCHED" ? "ok" : d.status === "CANCELLED" ? "danger" : "warn";

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`DISPATCH · ${d.customer.name.toUpperCase()}`} title={d.dcNumber}
        subtitle={`Vehicle ${d.vehicleNumber}${d.driverName ? ` · driver ${d.driverName}` : ""}`} right={<Badge tone={tone}>{d.status}</Badge>}>
        <Link href="/dispatch" className="text-sm font-semibold">← All dispatches</Link>
      </PageHeader>
      <Flash error={error} ok={ok} />

      <Card className="space-y-2.5">
        <div className="flex items-baseline justify-between"><span className="font-display text-base font-bold">Pick-list scan</span><Mono className="text-[15px]">{totalScanned.toLocaleString()} / {totalOrdered.toLocaleString()}</Mono></div>
        <ProgressBar value={totalScanned} max={totalOrdered} color={totalScanned >= totalOrdered ? "#1E7A46" : "#1D4ED8"} />
        <div className="grid gap-2.5 pt-1 md:grid-cols-2">
          {progress.lines.map((l) => (
            <div key={l.itemId} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm"><span><strong>{l.code}</strong> <span className="text-ink-3">{l.name}</span></span>
                <span className={`text-xs font-semibold ${l.scanned === l.ordered ? "text-ok" : l.scanned > l.ordered ? "text-danger" : "text-warn-ink"}`}>
                  {l.scanned === l.ordered ? "Complete" : l.scanned > l.ordered ? "Over" : `${(l.ordered - l.scanned).toLocaleString()} to go`}</span></div>
              <ProgressBar value={Math.min(l.scanned, l.ordered)} max={l.ordered} color={l.scanned === l.ordered ? "#1E7A46" : "#1D4ED8"} />
              <div className="text-[11px] text-ink-3"><Mono>{l.scanned.toLocaleString()}</Mono> of <Mono>{l.ordered.toLocaleString()}</Mono></div>
            </div>
          ))}
        </div>
      </Card>

      {loading && (
        <Card>
          <form action={scan} className="flex items-end gap-3">
            <input type="hidden" name="dispatchId" value={d.id} />
            <label className="flex-1 text-[13px] font-semibold">Scan box label
              <input name="scan" autoFocus required autoComplete="off" autoCapitalize="characters" spellCheck={false} className={inputCls} />
            </label>
            <button className={btnCls}>Load box</button>
          </form>
        </Card>
      )}

      <Eyebrow>BOXES ON THIS LOAD · {progress.boxes.length}</Eyebrow>
      <DataTable>
        <thead><tr><th>Box</th><th>Part</th><th>Batch</th><th className="text-right!">Qty</th><th></th></tr></thead>
        <tbody>
          {progress.boxes.map((b) => (
            <tr key={b.boxCode}>
              <td className="font-semibold"><Mono className="text-xs">{b.boxCode}</Mono></td><td>{b.itemCode}</td><td><Mono className="text-xs">{b.batchCode ?? "—"}</Mono></td>
              <td className="text-right"><Mono>{b.qty.toLocaleString()}</Mono></td>
              <td>{loading && (
                <form action={remove}><input type="hidden" name="dispatchId" value={d.id} /><input type="hidden" name="boxCode" value={b.boxCode} /><button className="cursor-pointer text-xs font-semibold text-danger">Remove</button></form>
              )}</td>
            </tr>
          ))}
          {progress.boxes.length === 0 && <tr><td className="text-ink-3" colSpan={5}>No boxes scanned yet.</td></tr>}
        </tbody>
      </DataTable>

      {loading && (
        <div className="space-y-3">
          <Card>
            <form action={complete} className="space-y-3">
              <input type="hidden" name="dispatchId" value={d.id} />
              <span className="font-display text-base font-bold">Complete dispatch</span>
              <p className="text-sm text-ink-2">Stock is deducted only when you complete. Add the returnable crates going out with this load, if any.</p>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-[13px] md:col-span-2">Crates / trolleys / pallets
                  <select name="crateItemId" className={inputCls}><option value="">None</option>{crates.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
                </label>
                <label className="text-[13px]">Quantity<input name="crateQty" type="number" min="0" step="1" className={inputCls} /></label>
              </div>
              <button className={`${btnCls} w-full disabled:cursor-not-allowed disabled:opacity-50 md:w-auto`} disabled={!progress.complete}>{progress.complete ? "Complete & dispatch" : "Scan the full pick list first"}</button>
            </form>
          </Card>
          <form action={cancel}><input type="hidden" name="dispatchId" value={d.id} /><button className="min-h-10 cursor-pointer text-sm font-semibold text-danger">Cancel this dispatch</button></form>
        </div>
      )}

      {d.status !== "CANCELLED" && (
        <Card className="space-y-2">
          <Eyebrow>DOCUMENTS</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <Link className={btnSecondaryCls} target="_blank" href={`/dispatch/${d.id}/dc`}>Delivery challan &amp; packing list</Link>
            <DownloadLink href={`/api/v1/dispatch/${d.id}/eway`}>Download e-way bill data (JSON)</DownloadLink>
          </div>
        </Card>
      )}
    </div>
  );
}
