import { db } from "@/server/db";
import { DownloadLink } from "@/components/download-link";
import { requirePermission, runAction } from "@/server/auth/guard";
import { importDemand, undoImport } from "@/server/services/demand";
import { MAX_UPLOAD_BYTES, parseDemandRows, readSpreadsheet } from "@/server/services/demand-import";
import { DomainError } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function upload(formData: FormData) {
  "use server";
  const user = await requirePermission("mrp.plan");
  let msg = "";
  await runAction("/demand", () => msg, async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose a .csv or .xlsx file first.");
    if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("File is larger than 5 MB.");
    let rows;
    try {
      rows = await readSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    } catch (e) {
      throw new DomainError(e instanceof Error ? e.message : "Could not read the file.");
    }
    const parsed = parseDemandRows(rows);
    const r = await importDemand({
      fileName: file.name, rows: parsed.ok, rowErrors: parsed.errors, replaceForecast: formData.get("replaceForecast") === "on", userId: user.id,
    });
    msg = `Imported ${r.imported} demand line${r.imported === 1 ? "" : "s"}${r.replaced ? `, replacing ${r.replaced} older forecast line${r.replaced === 1 ? "" : "s"}` : ""}.`;
  });
}

async function undo(formData: FormData) {
  "use server";
  await requirePermission("mrp.plan");
  let n = 0;
  await runAction("/demand", () => `Removed ${n} line${n === 1 ? "" : "s"} from that upload.`, async () => {
    n = await undoImport(String(formData.get("importId")));
  });
}

export default async function DemandPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("mrp.plan");
  const { error, ok } = await searchParams;
  const [lines, imports] = await Promise.all([
    db.demandLine.findMany({ orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], take: 200, include: { customer: true, fgItem: true } }),
    db.demandImport.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.type, (totals.get(l.type) ?? 0) + l.qty);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Customer Demand</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Upload rolling forecasts, firm weekly schedules and spot orders from Excel or CSV. The MRP plan uses these to work out what to make and buy.
        Dates are read day-first (05/11/2026 is 5 November). A file with any bad row is rejected as a whole, so nothing half-loads.
      </p>
      <Flash error={error} ok={ok} />
      <p className="flex gap-4 text-sm print:hidden">
        <DownloadLink href={"/api/v1/export/demand?format=xlsx"}>Download Excel</DownloadLink>
        <DownloadLink href={"/api/v1/export/demand?format=csv"}>Download CSV</DownloadLink>
        <span className="text-slate-500">To get a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
      </p>

      <form action={upload} className="max-w-3xl space-y-3 rounded-lg border bg-white p-4">
        <label className="block text-sm font-medium">Schedule file (.csv or .xlsx, up to 5 MB)
          <input name="file" type="file" accept=".csv,.xlsx" required className={`${inputCls} file:mr-3`} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="replaceForecast" type="checkbox" defaultChecked className="h-4 w-4" />
          New forecast replaces the old forecast for the same customer and part (firm and spot orders are kept)
        </label>
        <p className="text-xs text-slate-500">Columns: customer_code, part_code, due_date, qty, type (FORECAST, FIRM or SPOT; blank means FIRM). <DownloadLink href={"/api/v1/demand-template"}>Download a template</DownloadLink>.</p>
        <button className={btnCls}>Upload &amp; import</button>
      </form>

      <div className="flex flex-wrap gap-3 text-sm">
        {["FIRM", "FORECAST", "SPOT"].map((t) => (
          <div key={t} className="rounded-lg border bg-white px-4 py-2"><div className="text-lg font-semibold">{(totals.get(t) ?? 0).toLocaleString()}</div><div className="text-xs text-slate-500">{t} parts</div></div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Due</th><th className="p-2">Customer</th><th className="p-2">Part</th><th className="p-2 text-right">Qty</th><th className="p-2">Type</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.dueDate.toISOString().slice(0, 10)}</td><td className="p-2">{l.customer.name}</td><td className="p-2">{l.fgItem.code}</td>
                <td className="p-2 text-right">{l.qty.toLocaleString()}</td><td className="p-2">{l.type}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No demand loaded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold">Recent uploads</h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">When</th><th className="p-2">File</th><th className="p-2 text-right">Rows</th><th className="p-2 text-right">Replaced</th><th className="p-2"></th></tr></thead>
          <tbody>
            {imports.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="p-2">{i.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td className="p-2">{i.fileName}</td>
                <td className="p-2 text-right">{i.rowCount}</td><td className="p-2 text-right">{i.replaced}</td>
                <td className="p-2"><form action={undo}><input type="hidden" name="importId" value={i.id} /><button className="text-xs text-red-700 underline">Remove this upload</button></form></td>
              </tr>
            ))}
            {imports.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No uploads yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
