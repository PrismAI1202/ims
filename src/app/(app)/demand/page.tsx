import { ScanSearch } from "@/components/scan-search";
import { Form } from "@/components/form";
import { db } from "@/server/db";
import { DownloadLink } from "@/components/download-link";
import { requireView, requirePermission, runAction } from "@/server/auth/guard";
import { importDemand, orderFormOptions, undoImport } from "@/server/services/demand";
import { MAX_UPLOAD_BYTES, parseDemandRows, readSpreadsheet } from "@/server/services/demand-import";
import { DomainError } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { href, matches } from "@/lib/url";
import { SidePanel } from "@/components/side-panel";
import { DemandTimeline, type TimelineLine } from "@/components/demand-timeline";
import { NewCustomerOrderForm } from "@/components/order-lines";
import { addCustomerOrder, removeCustomerOrderLine } from "../orders/customer-order-actions";
import { standingOf, STANDING } from "@/lib/demand-standing";
import { canView } from "@/server/auth/permissions";
import { Plus, Search, Upload } from "lucide-react";
import Link from "next/link";
import { Badge, Card, Mono, PageHeader } from "@/components/ui";

export const instant = false;

async function upload(formData: FormData) {
  "use server";
  const user = await requirePermission("mrp.plan");
  let msg = "";
  return runAction("/demand", () => msg, async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose a .csv or .xlsx file first.", ["file"]);
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
  return runAction("/demand", () => `Removed ${n} line${n === 1 ? "" : "s"} from that upload.`, async () => {
    n = await undoImport(String(formData.get("importId")));
  });
}

type Search = { error?: string; ok?: string; q?: string; type?: string; status?: string; view?: string; new?: string };

const TYPES = ["FIRM", "SPOT", "FORECAST"] as const;
const STATUSES = [["", "All"], ["ship", "To ship"], ["overdue", "Overdue"], ["shipped", "Shipped"]] as const;
const TYPE_TONE = { FIRM: "info", FORECAST: "neutral", SPOT: "warn" } as const;

export default async function DemandPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireView("demand");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const kind = TYPES.find((t) => t === sp.type);
  const status = STATUSES.find(([k]) => k && k === sp.status)?.[0];
  const view = sp.view === "list" ? "list" : "timeline";
  const today = new Date().toISOString().slice(0, 10);

  const orderForm = sp.new === "order" ? await orderFormOptions() : null;
  const [all, imports] = await Promise.all([
    db.demandLine.findMany({ orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], take: 1000, include: { customer: true, fgItem: true } }),
    sp.new === "uploads" ? db.demandImport.findMany({ orderBy: { createdAt: "desc" }, take: 12 }) : Promise.resolve([]),
  ]);
  const rows = all.map((l): TimelineLine => ({
    id: l.id, customer: l.customer.name, customerId: l.customerId, segment: l.customer.segment, part: l.fgItem.code, partName: l.fgItem.name,
    due: l.dueDate.toISOString().slice(0, 10), qty: l.qty, shipped: l.shippedQty, type: l.type, ref: l.customerRef,
  }));
  const standing = (l: TimelineLine) => standingOf(l, today);
  const shown = rows.filter((l) => {
    if (kind && l.type !== kind) return false;
    if (!matches(q, l.customer, l.part, l.partName, l.type, l.ref)) return false;
    const st = standing(l);
    return !status || (status === "ship" ? st === "open" || st === "part" || st === "overdue" : st === status);
  });

  const params = { q, type: kind, status, view: view === "list" ? "list" : undefined };
  const u = (over: Record<string, string | undefined>) => href("/demand", { ...params, ...over });
  const closeHref = href("/demand", params);
  const toShip = (t: string) => rows.filter((l) => l.type === t).reduce((a, l) => a + (t === "FORECAST" ? l.qty : Math.max(l.qty - l.shipped, 0)), 0);
  const overdue = rows.filter((l) => standing(l) === "overdue").length;
  const canUpload = true; // the page itself needs the planning permission (requireView)

  const seg = (list: { href: string; label: string; active: boolean }[]) => (
    <nav className="inline-flex shrink-0 rounded-xl border border-border bg-white p-0.5">
      {list.map((c) => (
        <Link key={c.label} href={c.href} scroll={false} aria-current={c.active ? "true" : undefined}
          className={`flex min-h-9 items-center whitespace-nowrap rounded-[10px] px-3 text-[13px] font-semibold ${c.active ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"}`}>{c.label}</Link>
      ))}
    </nav>
  );
  const btnLink = "flex min-h-10 flex-none items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-semibold";

  return (
    // Laptop: one screen, only the timeline or list scrolls. Phone: the page scrolls with the filter bar pinned.
    <div className="flex flex-col gap-3 md:h-[calc(100dvh-4rem)] md:min-h-96">
      <PageHeader eyebrow="SET UP" title="Customer demand" subtitle={`${rows.length} line${rows.length === 1 ? "" : "s"}${overdue ? ` · ${overdue} overdue` : ""} · feeds the MRP plan`}>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none]">
          <Link href={href("/demand", { ...params, new: "order" })} scroll={false} className={`${btnLink} bg-accent text-white hover:bg-accent-hover`}><Plus size={16} aria-hidden /> New customer order</Link>
          {canUpload && <Link href={href("/demand", { ...params, new: "upload" })} scroll={false} className={`${btnLink} bg-shell-2 text-on-shell`}><Upload size={16} aria-hidden /> Upload schedule</Link>}
          <Link href={href("/demand", { ...params, new: "uploads" })} scroll={false} className={`${btnLink} bg-shell-2 text-on-shell`}>Recent uploads</Link>
        </div>
      </PageHeader>
      {!sp.new && <Flash error={sp.error} ok={sp.ok} />}

      <section aria-label="Filters" className="sticky top-0 z-30 -mx-4 flex flex-none flex-wrap items-center gap-2 bg-canvas px-4 py-2 md:static md:mx-0 md:bg-transparent md:p-0">
        <form method="get" action="/demand" role="search" className="order-1 flex min-w-0 flex-1 basis-40 gap-1.5 md:basis-56">
          {Object.entries({ ...params, q: undefined }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search customer or part</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input type="search" name="q" defaultValue={q} placeholder="Search customer or part…" enterKeyHint="search" autoComplete="off" className="min-h-11 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm" />
          </label>
          <ScanSearch title="Scan a part" keep={{ ...params, q: undefined }} />
          <button className="min-h-11 cursor-pointer rounded-xl bg-ink px-3 text-sm font-semibold text-white"><span className="hidden sm:inline">Search</span><Search size={16} aria-hidden className="sm:hidden" /></button>
          {q && <Link href={u({ q: undefined })} className="flex min-h-11 items-center px-1 text-sm font-semibold text-accent">Clear</Link>}
        </form>
        <div className="order-2 -mx-1 flex w-full gap-2 overflow-x-auto px-1 [scrollbar-width:none] md:w-auto md:max-w-full">
          {seg([{ href: u({ type: undefined }), label: "All types", active: !kind }, ...TYPES.map((t) => ({ href: u({ type: t }), label: t[0] + t.slice(1).toLowerCase(), active: kind === t }))])}
          {seg(STATUSES.map(([k, label]) => ({ href: u({ status: k || undefined }), label, active: (status ?? "") === k })))}
          {seg([{ href: u({ view: undefined }), label: "Timeline", active: view === "timeline" }, { href: u({ view: "list" }), label: "List", active: view === "list" }])}
        </div>
      </section>

      <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-3">
        <span>
          Showing {shown.length} of {rows.length} · to ship: <b className="text-ink-2">{toShip("FIRM").toLocaleString()}</b> firm, <b className="text-ink-2">{toShip("SPOT").toLocaleString()}</b> spot · <b className="text-ink-2">{toShip("FORECAST").toLocaleString()}</b> forecast
        </span>
        <span className="flex gap-3 font-semibold text-accent print:hidden"><DownloadLink href="/api/v1/export/demand?format=xlsx">Excel</DownloadLink><DownloadLink href="/api/v1/export/demand?format=csv">CSV</DownloadLink></span>
      </div>

      {view === "timeline" ? (
        <DemandTimeline lines={shown} today={today} canOpenOrders={canView(user, "orders")} canOpenMrp={canView(user, "mrp")} removeAction={removeCustomerOrderLine} backHref={closeHref} />
      ) : (
        <div role="region" aria-label="Demand lines" tabIndex={0} className="min-h-0 overflow-auto overscroll-contain rounded-[14px] bg-white focus-visible:outline-2 focus-visible:outline-accent md:flex-1">
          <table className="w-full text-sm [&_td]:border-t [&_td]:border-line [&_td]:p-3 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-canvas [&_th]:p-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ink-3">
            <thead><tr><th>Due</th><th>Customer</th><th>Customer PO</th><th>Part</th><th className="text-right!">Qty</th><th className="text-right!">Shipped</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((l) => {
                const st = standing(l);
                return (
                  <tr key={l.id}>
                    <td><Mono className="text-xs">{l.due}</Mono></td><td>{l.customer}</td><td><Mono className="text-xs">{l.ref ?? "—"}</Mono></td><td><Mono className="font-semibold">{l.part}</Mono></td>
                    <td className="text-right"><Mono>{l.qty.toLocaleString()}</Mono></td>
                    <td className="text-right"><Mono>{l.type === "FORECAST" ? "—" : l.shipped.toLocaleString()}</Mono></td>
                    <td><Badge tone={TYPE_TONE[l.type]}>{l.type}</Badge></td>
                    <td>{st === "forecast" ? <span className="text-xs text-ink-3">Forecast</span>
                      : <Badge tone={st === "shipped" ? "ok" : st === "overdue" ? "danger" : st === "part" ? "info" : "neutral"}>{st === "overdue" && l.shipped > 0 ? "Part shipped · overdue" : STANDING[st].label}</Badge>}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td className="text-ink-3" colSpan={8}>{rows.length === 0 ? "No demand yet. Add a customer order or upload a schedule." : "No demand matches these filters."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sp.new === "order" && orderForm && (
        <SidePanel title="New customer order" subtitle="The customer's PO: a line for each part, each with its own due date" closeHref={closeHref}>
          <Flash error={sp.error} />
          <Card className="space-y-3">
            <NewCustomerOrderForm action={addCustomerOrder} customers={orderForm.customers} parts={orderForm.parts} today={today} back={closeHref} />
          </Card>
        </SidePanel>
      )}
      {sp.new === "upload" && (
        <SidePanel title="Upload a schedule" subtitle="Rolling forecasts, firm weekly schedules and spot orders" closeHref={closeHref}>
          <Flash error={sp.error} />
          <Card className="space-y-4">
            <Form action={upload} className="space-y-3">
              <label className="block text-[13px] font-semibold">Schedule file (.csv or .xlsx, up to 5 MB)
                <input name="file" type="file" accept=".csv,.xlsx" required className={`${inputCls} py-2.5 file:mr-3`} />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input name="replaceForecast" type="checkbox" defaultChecked className="mt-0.5 size-5 accent-[#c2410c]" />
                New forecast replaces the old forecast for the same customer and part (firm and spot orders are kept)
              </label>
              <button className={`${btnCls} w-full md:w-auto`}>Upload &amp; import</button>
            </Form>
            <div className="space-y-1.5 rounded-xl bg-canvas p-3.5 text-xs text-ink-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-[13px] text-ink">The file</b><DownloadLink href="/api/v1/demand-template"><span className="font-semibold text-accent">Download a template</span></DownloadLink></div>
              <p>Columns: <b>customer_code</b>, <b>part_code</b>, <b>due_date</b>, <b>qty</b>, <b>type</b> (FORECAST, FIRM or SPOT; blank means FIRM), and optionally <b>po_ref</b> (the customer&apos;s own PO number).</p>
              <p>Dates are read day-first (05/11/2026 is 5 November). A file with any bad row is rejected as a whole and every problem is listed with its row number, so nothing half-loads. The MRP plan uses these lines to work out what to make and buy.</p>
            </div>
          </Card>
        </SidePanel>
      )}
      {sp.new === "uploads" && (
        <SidePanel title="Recent uploads" subtitle="Remove an upload to take its lines back out" closeHref={closeHref}>
          <Flash error={sp.error} ok={sp.ok} />
          <Card className="p-0">
            <ul className="divide-y divide-line text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0"><span className="block truncate font-semibold">{i.fileName}</span><span className="text-xs text-ink-3"><Mono>{i.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Mono> · {i.rowCount} rows{i.replaced ? ` · replaced ${i.replaced}` : ""}</span></span>
                  <Form action={undo}><input type="hidden" name="importId" value={i.id} /><button className="min-h-9 cursor-pointer text-xs font-semibold text-danger">Remove this upload</button></Form>
                </li>
              ))}
              {imports.length === 0 && <li className="px-4 py-3 text-ink-3">No uploads yet.</li>}
            </ul>
          </Card>
        </SidePanel>
      )}
    </div>
  );
}
