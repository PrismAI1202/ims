import { db } from "@/server/db";
import { DownloadLink } from "@/components/download-link";
import { requirePermission, runAction } from "@/server/auth/guard";
import { importDemand, undoImport } from "@/server/services/demand";
import { MAX_UPLOAD_BYTES, parseDemandRows, readSpreadsheet } from "@/server/services/demand-import";
import { DomainError } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

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

  const TYPE_TONE = { FIRM: "info", FORECAST: "neutral", SPOT: "warn" } as const;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="Customer demand" subtitle={`${lines.length} demand line${lines.length === 1 ? "" : "s"} loaded`} />
      <p className="max-w-3xl text-sm text-ink-2">
        Upload rolling forecasts, firm weekly schedules and spot orders from Excel or CSV. The MRP plan uses these to work out what to make and buy.
        Dates are read day-first (05/11/2026 is 5 November). A file with any bad row is rejected as a whole, so nothing half-loads.
      </p>
      <Flash error={error} ok={ok} />
      <p className="flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
        <DownloadLink href={"/api/v1/export/demand?format=xlsx"}>Download Excel</DownloadLink>
        <DownloadLink href={"/api/v1/export/demand?format=csv"}>Download CSV</DownloadLink>
        <span className="font-normal text-ink-3">To get a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
      </p>

      <div className="grid grid-cols-3 gap-2">
        {["FIRM", "FORECAST", "SPOT"].map((t) => (
          <div key={t} className="rounded-[10px] bg-white px-3.5 py-2.5"><div className="font-display text-2xl font-extrabold">{(totals.get(t) ?? 0).toLocaleString()}</div><div className="text-xs text-ink-3">{t} parts</div></div>
        ))}
      </div>

      <Card>
        <form action={upload} className="space-y-3">
          <label className="block text-[13px] font-semibold">Schedule file (.csv or .xlsx, up to 5 MB)
            <input name="file" type="file" accept=".csv,.xlsx" required className={`${inputCls} py-2.5 file:mr-3`} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input name="replaceForecast" type="checkbox" defaultChecked className="mt-0.5 size-5 accent-[#c2410c]" />
            New forecast replaces the old forecast for the same customer and part (firm and spot orders are kept)
          </label>
          <p className="text-xs text-ink-3">Columns: customer_code, part_code, due_date, qty, type (FORECAST, FIRM or SPOT; blank means FIRM). <DownloadLink href={"/api/v1/demand-template"}>Download a template</DownloadLink>.</p>
          <button className={`${btnCls} w-full md:w-auto`}>Upload &amp; import</button>
        </form>
      </Card>

      <Eyebrow>DEMAND LINES</Eyebrow>
      <DataTable>
        <thead><tr><th>Due</th><th>Customer</th><th>Part</th><th className="text-right!">Qty</th><th>Type</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td><Mono className="text-xs">{l.dueDate.toISOString().slice(0, 10)}</Mono></td><td>{l.customer.name}</td><td><Mono className="font-semibold">{l.fgItem.code}</Mono></td>
              <td className="text-right"><Mono>{l.qty.toLocaleString()}</Mono></td><td><Badge tone={TYPE_TONE[l.type as keyof typeof TYPE_TONE] ?? "neutral"}>{l.type}</Badge></td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td className="text-ink-3" colSpan={5}>No demand loaded yet.</td></tr>}
        </tbody>
      </DataTable>

      <Eyebrow>RECENT UPLOADS</Eyebrow>
      <DataTable>
        <thead><tr><th>When</th><th>File</th><th className="text-right!">Rows</th><th className="text-right!">Replaced</th><th></th></tr></thead>
        <tbody>
          {imports.map((i) => (
            <tr key={i.id}>
              <td><Mono className="text-xs">{i.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Mono></td><td>{i.fileName}</td>
              <td className="text-right"><Mono>{i.rowCount}</Mono></td><td className="text-right"><Mono>{i.replaced}</Mono></td>
              <td><form action={undo}><input type="hidden" name="importId" value={i.id} /><button className="min-h-9 cursor-pointer text-xs font-semibold text-danger">Remove this upload</button></form></td>
            </tr>
          ))}
          {imports.length === 0 && <tr><td className="text-ink-3" colSpan={5}>No uploads yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
  );
}
