import { Form } from "@/components/form";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { db } from "@/server/db";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { can, canView } from "@/server/auth/permissions";
import { createPurchaseOrder } from "@/server/services/inventory";
import { cancelPurchaseOrder, closePurchaseOrderShort } from "@/server/services/purchase";
import { createDispatch } from "@/server/services/dispatch";
import { DomainError } from "@/server/services/inventory";
import { importPurchaseOrders, parsePoRows } from "@/server/services/po-import";
import { importDemand } from "@/server/services/demand";
import { MAX_UPLOAD_BYTES, parseDemandRows, readSpreadsheet } from "@/server/services/demand-import";
import { dateField, readLines } from "@/server/line-form";
import {
  filterOrders, listOrders, orderParties, paginate,
  type OrderFilters, type OrderKind, type OrderRow, type OrderStateFilter,
} from "@/server/services/orders";
import { btnCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { href } from "@/lib/url";
import { DownloadLink } from "@/components/download-link";
import { NewPickListForm, NewPoForm, type LineOption, type Suggestion } from "@/components/order-lines";
import { Badge, Card, Chips, Eyebrow, Mono, PageHeader, ProgressBar } from "@/components/ui";

export const instant = false;

// A form posts the list URL it came from so cancelling a PO or closing it short returns to the same filtered view.
const safeBack = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "");
  return s.startsWith("/orders") ? s : "/orders";
};

async function createPo(formData: FormData) {
  "use server";
  const user = await requirePermission("po.manage");
  return runAction("/orders?kind=po", "Purchase order created and approved.", async () => {
    const expected = dateField(formData.get("expected"));
    const lines = readLines(formData).map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, expectedDate: expected }));
    await createPurchaseOrder({
      supplierId: String(formData.get("supplierId")),
      segment: formData.get("segment") === "AUTOMOTIVE" ? "AUTOMOTIVE" : "NON_AUTOMOTIVE",
      externalRef: String(formData.get("externalRef") || "") || undefined,
      lines, userId: user.id,
    });
  }, "/orders?new=po");
}

async function cancelPo(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  return runAction(safeBack(formData.get("back")), "Purchase order cancelled.", async () => { await cancelPurchaseOrder(String(formData.get("id"))); });
}

async function closePoShort(formData: FormData) {
  "use server";
  await requirePermission("po.manage");
  return runAction(safeBack(formData.get("back")), "Purchase order closed. The balance is no longer expected.", async () => { await closePurchaseOrderShort(String(formData.get("id"))); });
}

async function createPickList(formData: FormData) {
  "use server";
  const user = await requirePermission("dispatch.manage");
  let id = "";
  return runAction(() => `/dispatch/${id}`, "Pick list created. Scan the boxes to load.", async () => {
    const d = await createDispatch({
      customerId: String(formData.get("customerId")),
      lines: readLines(formData).map((l) => ({ itemId: l.itemId, qty: l.qty })), userId: user.id,
    });
    id = d.id;
  }, "/orders?new=dispatch");
}

// Importing: orders that are raised in another tool, or tracked by hand, come in from a file. A file with any bad row is
// rejected as a whole, so nothing half-loads.
async function readUpload(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose a .csv or .xlsx file first.", ["file"]);
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("File is larger than 5 MB.");
  try {
    return { name: file.name, rows: await readSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name) };
  } catch (e) {
    throw new DomainError(e instanceof Error ? e.message : "Could not read the file.");
  }
}

async function importPoFile(formData: FormData) {
  "use server";
  const user = await requirePermission("po.manage");
  let msg = "";
  return runAction("/orders?kind=po", () => msg, async () => {
    const { rows } = await readUpload(formData);
    const parsed = parsePoRows(rows);
    const r = await importPurchaseOrders({ groups: parsed.groups, rowErrors: parsed.errors, userId: user.id });
    const lines = r.created.reduce((a, c) => a + c.lines, 0);
    msg = `Imported ${r.created.length} purchase order${r.created.length === 1 ? "" : "s"} (${lines} line${lines === 1 ? "" : "s"}).`
      + (r.skipped.length ? ` Skipped ${r.skipped.length} already loaded: ${r.skipped.slice(0, 5).join(", ")}${r.skipped.length > 5 ? "…" : ""}.` : "");
  }, "/orders?new=import");
}

async function importCustomerFile(formData: FormData) {
  "use server";
  const user = await requirePermission("mrp.plan");
  let msg = "";
  return runAction("/orders?kind=demand", () => msg, async () => {
    const { name, rows } = await readUpload(formData);
    const parsed = parseDemandRows(rows);
    const r = await importDemand({ fileName: name, rows: parsed.ok, rowErrors: parsed.errors, replaceForecast: formData.get("replaceForecast") === "on", userId: user.id });
    msg = `Imported ${r.imported} customer order line${r.imported === 1 ? "" : "s"}${r.replaced ? `, replacing ${r.replaced} older forecast line${r.replaced === 1 ? "" : "s"}` : ""}.`;
  }, "/orders?new=import");
}

type Search = {
  dir?: string; kind?: string; state?: string; party?: string; seg?: string; from?: string; to?: string; q?: string; sort?: string; page?: string;
  new?: string; item?: string; qty?: string; error?: string; ok?: string;
};

const DIRS = { buy: "BUY", sell: "SELL" } as const;
const KINDS: OrderKind[] = ["po", "dispatch", "demand"];
const STATES: OrderStateFilter[] = ["active", "overdue", "closed"];
const KIND_LABEL: Record<OrderKind, string> = { po: "Supplier POs", dispatch: "Dispatches", demand: "Customer orders" };
const TYPE_LABEL = { PO: "Supplier PO", DISPATCH: "Dispatch", DEMAND: "Customer order" } as const;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const iso = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

const rowCls = "grid items-center gap-x-4 gap-y-1.5 p-3.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]";
/** The row's content: a link to the order when the person can open it, plain text when they can only look. */
function Body({ href: to, children }: { href: string | null; children: React.ReactNode }) {
  return to ? <Link href={to} className={`${rowCls} hover:bg-canvas`}>{children}</Link> : <div className={rowCls}>{children}</div>;
}

function Row({ o, back, canPo, linkable }: { o: OrderRow; back: string; canPo: boolean; linkable: boolean }) {
  const done = o.lines.every((l) => l.done !== undefined) ? o.lines.reduce((a, l) => a + (l.done ?? 0), 0) : undefined;
  const total = o.lines.reduce((a, l) => a + l.total, 0);
  const first = o.lines[0];
  const actions = canPo && o.type === "PO" ? o.actions : [];
  return (
    <article className="overflow-hidden rounded-[14px] bg-white">
      <Body href={linkable ? o.href : null}>
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            {o.direction === "BUY" ? <ArrowDownLeft size={15} className="flex-none text-ink-3" aria-label="Incoming" /> : <ArrowUpRight size={15} className="flex-none text-ink-3" aria-label="Outgoing" />}
            <Mono className="truncate text-[14px] font-semibold">{o.number}</Mono>
          </span>
          <span className="text-xs text-ink-3">{TYPE_LABEL[o.type]}{o.type === "PO" && o.segment === "AUTOMOTIVE" ? " · Automotive" : ""}{o.ref && <> · Ref <Mono>{o.ref}</Mono></>}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">{o.party}</span>
          <span className="text-xs text-ink-3">{o.direction === "SELL" && o.type === "DEMAND" ? "Due" : "Created"} {day(o.date)}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          {first && (
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate"><strong>{first.label}</strong>{o.lines.length > 1 && <span className="text-ink-3"> +{o.lines.length - 1} more</span>}</span>
              <Mono className="flex-none text-xs">{done !== undefined && <>{done.toLocaleString()} / </>}{total.toLocaleString()} {first.uom}</Mono>
            </span>
          )}
          {done !== undefined && <ProgressBar value={done} max={Math.max(total, 1)} color={done >= total ? "#1E7A46" : "#1D4ED8"} />}
        </span>
        <span className="flex md:justify-end"><Badge tone={o.tone}>{o.status}</Badge></span>
      </Body>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-4 border-t border-line px-3.5">
          {actions.includes("edit") && <Link className="flex min-h-10 items-center text-[13px] font-semibold text-accent" href={`/purchase/${o.id}`}>Edit</Link>}
          {actions.includes("cancel") && (
            <Form action={cancelPo}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} /><button className="min-h-10 cursor-pointer text-[13px] font-semibold text-danger">Cancel</button></Form>
          )}
          {actions.includes("closeShort") && (
            <Form action={closePoShort}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} /><button className="min-h-10 cursor-pointer text-[13px] font-semibold text-ink-2">Close short</button></Form>
          )}
        </div>
      )}
    </article>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireView("orders");
  const sp = await searchParams;
  const canPo = can(user, "po.manage");
  const canDispatch = can(user, "dispatch.manage");

  // Filters. Status defaults to "active" so the list opens on what still needs doing; "all" brings back finished ones.
  const state: OrderStateFilter | undefined = sp.state === "all" ? undefined : STATES.find((s) => s === sp.state) ?? "active";
  const f: OrderFilters = {
    dir: sp.dir === "buy" || sp.dir === "sell" ? DIRS[sp.dir] : undefined,
    kind: KINDS.find((k) => k === sp.kind),
    state,
    party: sp.party || undefined,
    segment: sp.seg === "AUTOMOTIVE" || sp.seg === "NON_AUTOMOTIVE" ? sp.seg : undefined,
    from: iso(sp.from), to: iso(sp.to),
    q: sp.q?.trim() || undefined,
    sort: sp.sort === "old" ? "old" : "new",
  };
  const params = {
    dir: sp.dir === "buy" || sp.dir === "sell" ? sp.dir : undefined, kind: f.kind,
    state: sp.state === "all" ? "all" : state === "overdue" || state === "closed" ? state : undefined, // "active" is the default, so it stays out of the URL
    party: f.party, seg: f.segment, from: f.from, to: f.to, q: f.q, sort: f.sort === "old" ? "old" : undefined,
  };
  const u = (over: Record<string, string | undefined>) => href("/orders", { ...params, ...over, page: undefined });

  const all = await listOrders();
  const parties = orderParties(all);
  const filtered = filterOrders(all, f);
  const page = paginate(filtered, Number(sp.page));
  const back = href("/orders", { ...params, page: page.page > 1 ? String(page.page) : undefined });

  // Counts on the chips follow every other filter, so each chip says what it would show.
  const noState = filterOrders(all, { ...f, state: undefined });
  const nActive = noState.filter((o) => o.state !== "closed").length;
  const nOverdue = noState.filter((o) => o.state === "overdue").length;
  const nClosed = noState.filter((o) => o.state === "closed").length;
  const noDir = filterOrders(all, { ...f, dir: undefined });
  const extra = [f.kind, f.party, f.segment, f.from, f.to, f.sort === "old" ? "old" : undefined].filter(Boolean).length;
  const filtersOn = extra + (f.dir ? 1 : 0) + (f.q ? 1 : 0) + (sp.state && sp.state !== "active" ? 1 : 0);

  // Everything the create forms need, loaded only for people who can use them.
  const canCustomerImport = can(user, "mrp.plan");
  const today = new Date(new Date().toDateString());
  const poData = canPo ? await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { active: true, category: { notIn: ["FG", "REGRIND"] } }, orderBy: { code: "asc" } }),
    db.priceMaster.findMany({ where: { supplier: { active: true } } }),
  ]) : null;
  const poItems: LineOption[] = poData ? poData[1].map((it) => ({
    id: it.id, code: it.code, name: it.name, uom: it.uom,
    prices: Object.fromEntries(poData[2].filter((p) => p.itemId === it.id).map((p) => [p.supplierId, Number(p.price)])),
  })) : [];
  const dcData = canDispatch ? await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    db.fgBox.findMany({ where: { status: "IN_STOCK", dispatchId: null, lot: { pdiStatus: { notIn: ["PENDING", "HOLD"] } } }, select: { customerId: true, qty: true, lot: { select: { itemId: true } } } }),
    db.demandLine.findMany({ where: { type: { in: ["FIRM", "SPOT"] }, dueDate: { gte: today, lte: new Date(today.getTime() + 14 * 86_400_000) } }, orderBy: { dueDate: "asc" }, take: 200 }),
  ]) : null;
  const dcParts: LineOption[] = dcData ? dcData[1].map((it) => ({ id: it.id, code: it.code, name: it.name, uom: it.uom })) : [];
  const ready: Record<string, Record<string, number>> = {};
  for (const b of dcData?.[2] ?? []) { const m = (ready[b.customerId] ??= {}); m[b.lot.itemId] = (m[b.lot.itemId] ?? 0) + b.qty; }
  // What each customer wants soon, one chip per part (quantities added up, earliest due date), so a pick list starts from the order.
  const wants = new Map<string, Suggestion>();
  for (const d of dcData?.[3] ?? []) {
    const k = `${d.customerId}:${d.fgItemId}`;
    const w = wants.get(k);
    if (w) w.qty += d.qty; else wants.set(k, { customerId: d.customerId, itemId: d.fgItemId, qty: d.qty, due: day(d.dueDate) });
  }
  const suggestions = [...wants.values()];
  // Opened from Home's "Raise PO": start the form with that item and the quantity that brings it back to max.
  const pre = poData && sp.item ? poItems.find((it) => it.code === sp.item) : undefined;
  const preSupplier = pre ? (await db.priceMaster.findFirst({ where: { itemId: pre.id, supplier: { active: true } } }))?.supplierId : undefined;
  const preQty = Number(sp.qty) > 0 ? String(Number(sp.qty)) : undefined;
  const openPanel = pre || sp.new === "po" ? (canPo ? "po" : false) : sp.new === "dispatch" ? (canDispatch ? "dispatch" : false) : sp.new === "import" ? (canPo || canCustomerImport ? "import" : false) : false;

  return (
    <CreateProvider defaultOpen={openPanel}>
      <div className="space-y-4">
        <PageHeader eyebrow="OVERVIEW" title="Orders" subtitle={`${nActive} active · ${nOverdue} overdue · ${all.length} in total`}>
          {(canPo || canDispatch || canCustomerImport) && (
            <div className="flex flex-wrap gap-2">
              {canPo && <CreateButton id="po" label="New PO" />}
              {canDispatch && <CreateButton id="dispatch" label="New pick list" />}
              {(canPo || canCustomerImport) && <CreateButton id="import" label="Import from file" />}
            </div>
          )}
        </PageHeader>
        <Flash error={sp.error} ok={sp.ok} />

        {poData && (
          <CreatePanel id="po">
            <Card className="space-y-3">
              <Eyebrow>RAISE PURCHASE ORDER</Eyebrow>
              <NewPoForm action={createPo} suppliers={poData[0].map((x) => ({ id: x.id, name: x.name }))} items={poItems}
                pre={{ supplierId: preSupplier, itemId: pre?.id, qty: pre ? preQty : undefined }} />
            </Card>
          </CreatePanel>
        )}
        {dcData && (
          <CreatePanel id="dispatch">
            <Card className="space-y-3">
              <Eyebrow>NEW PICK LIST</Eyebrow>
              <NewPickListForm action={createPickList} customers={dcData[0].map((c) => ({ id: c.id, name: c.name }))} parts={dcParts} ready={ready} suggestions={suggestions} />
            </Card>
          </CreatePanel>
        )}
        {(canPo || canCustomerImport) && (
          <CreatePanel id="import">
            <Card className="space-y-5">
              <div>
                <Eyebrow>IMPORT ORDERS FROM A FILE</Eyebrow>
                <p className="mt-1 max-w-3xl text-sm text-ink-2">
                  For orders raised in another tool or tracked in a spreadsheet. Upload a .csv or .xlsx (up to 5 MB). A file with any bad row is rejected as a whole, so nothing half-loads,
                  and every problem is listed with its row number.
                </p>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                {canPo && (
                  <Form action={importPoFile} className="space-y-3 rounded-xl border border-border bg-canvas p-3.5">
                    <h3 className="font-display text-[15px] font-bold">Supplier POs <span className="text-xs font-normal text-ink-3">(incoming)</span></h3>
                    <label className="block text-[13px] font-semibold">File
                      <input name="file" type="file" accept=".csv,.xlsx" required className={`${inputCls} bg-white py-2.5 file:mr-3`} />
                    </label>
                    <p className="text-xs text-ink-3">
                      Columns: <b>po_ref</b>, <b>supplier_code</b>, <b>item_code</b>, <b>qty</b>, price, expected_date, segment. One row per PO line; rows with the same supplier and po_ref become one PO.
                      Blank prices use the price master. A PO already loaded (same supplier and reference) is skipped, so re-uploading is safe.{" "}
                      <DownloadLink href="/api/v1/po-template">Download a template</DownloadLink>
                    </p>
                    <button className={`${btnCls} w-full md:w-auto`}>Upload &amp; import POs</button>
                  </Form>
                )}
                {canCustomerImport && (
                  <Form action={importCustomerFile} className="space-y-3 rounded-xl border border-border bg-canvas p-3.5">
                    <h3 className="font-display text-[15px] font-bold">Customer orders <span className="text-xs font-normal text-ink-3">(outgoing)</span></h3>
                    <label className="block text-[13px] font-semibold">File
                      <input name="file" type="file" accept=".csv,.xlsx" required className={`${inputCls} bg-white py-2.5 file:mr-3`} />
                    </label>
                    <label className="flex items-start gap-2 text-[13px]">
                      <input name="replaceForecast" type="checkbox" defaultChecked className="mt-0.5 size-5 accent-[#c2410c]" />
                      New forecast replaces the old forecast for the same customer and part (firm and spot orders are kept)
                    </label>
                    <p className="text-xs text-ink-3">
                      Columns: <b>customer_code</b>, <b>part_code</b>, <b>due_date</b>, <b>qty</b>, type (FORECAST, FIRM or SPOT; blank means FIRM). Dates are read day-first.{" "}
                      <DownloadLink href="/api/v1/demand-template">Download a template</DownloadLink>
                    </p>
                    <button className={`${btnCls} w-full md:w-auto`}>Upload &amp; import orders</button>
                  </Form>
                )}
              </div>
            </Card>
          </CreatePanel>
        )}

        {/* Filters: search, direction and status are always in view; the rest open under "More filters". */}
        <section aria-label="Filters" className="space-y-2.5">
          <SearchBar q={f.q} placeholder="Search order no., party or part…" keep={{ ...params, q: undefined }} clearHref={u({ q: undefined })} />
          <div className="space-y-2">
            <Chips chips={[
              { href: u({ dir: undefined }), label: "All orders", n: noDir.length, active: !f.dir },
              { href: u({ dir: "buy" }), label: "Incoming (buy)", n: noDir.filter((o) => o.direction === "BUY").length, active: f.dir === "BUY" },
              { href: u({ dir: "sell" }), label: "Outgoing (sell)", n: noDir.filter((o) => o.direction === "SELL").length, active: f.dir === "SELL" },
            ]} />
            <Chips chips={[
              { href: u({ state: undefined }), label: "Active", n: nActive, active: state === "active" },
              { href: u({ state: "overdue" }), label: "Overdue", n: nOverdue, active: state === "overdue" },
              { href: u({ state: "closed" }), label: "Closed", n: nClosed, active: state === "closed" },
              { href: u({ state: "all" }), label: "Everything", n: noState.length, active: !state },
            ]} />
          </div>
          <details className="group rounded-[14px] bg-white" open={extra > 0}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><SlidersHorizontal size={16} aria-hidden /> More filters{extra > 0 && <Badge tone="info">{extra}</Badge>}</span>
              <ChevronRight size={16} className="text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <form method="get" action="/orders" className="grid gap-3 border-t border-line p-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {params.dir && <input type="hidden" name="dir" value={params.dir} />}
              {params.state && <input type="hidden" name="state" value={params.state} />}
              {f.q && <input type="hidden" name="q" value={f.q} />}
              <label className="text-[13px]">Type
                <select name="kind" defaultValue={f.kind ?? ""} className={inputCls}>
                  <option value="">All types</option>
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="text-[13px]">Supplier / customer
                <select name="party" defaultValue={f.party ?? ""} className={inputCls}>
                  <option value="">Anyone</option>
                  {(["BUY", "SELL"] as const).filter((d) => !f.dir || f.dir === d).map((d) => (
                    <optgroup key={d} label={d === "BUY" ? "Suppliers" : "Customers"}>
                      {parties.filter((p) => p.direction === d).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="text-[13px]">Segment
                <select name="seg" defaultValue={f.segment ?? ""} className={inputCls}>
                  <option value="">Both</option><option value="AUTOMOTIVE">Automotive</option><option value="NON_AUTOMOTIVE">Non-automotive</option>
                </select>
              </label>
              <label className="text-[13px]">Sort
                <select name="sort" defaultValue={f.sort} className={inputCls}><option value="new">Newest first</option><option value="old">Oldest first</option></select>
              </label>
              <label className="text-[13px]">From date<input type="date" name="from" defaultValue={f.from ?? ""} className={inputCls} /></label>
              <label className="text-[13px]">To date<input type="date" name="to" defaultValue={f.to ?? ""} className={inputCls} /></label>
              <div className="flex items-end gap-2 sm:col-span-2">
                <button className={btnCls}>Apply</button>
                <Link href="/orders" className={btnSecondaryCls}>Clear all</Link>
              </div>
            </form>
          </details>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
          <span>{page.total === 0 ? "No orders" : `Showing ${page.from}–${page.to} of ${page.total.toLocaleString()}`}{filtersOn > 0 && " (filtered)"}</span>
          {filtersOn > 0 && <Link href="/orders" className="font-semibold text-accent">Clear filters</Link>}
        </div>

        <div className="space-y-2">
          {page.rows.map((o) => (
            <Row key={o.key} o={o} back={back} canPo={canPo}
              linkable={o.type === "PO" ? canPo : o.type === "DISPATCH" ? canDispatch : canView(user, "demand")} />
          ))}
          {page.total === 0 && (
            <Card className="space-y-1">
              <p className="text-sm text-ink-3">{filtersOn > 0 ? "No orders match these filters." : "No orders yet."}</p>
              {filtersOn > 0 && <Link href="/orders" className="text-sm font-semibold text-accent">Clear filters</Link>}
            </Card>
          )}
        </div>

        {page.pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2">
            {page.page > 1
              ? <Link href={href("/orders", { ...params, page: page.page - 1 > 1 ? String(page.page - 1) : undefined })} className={`${btnSecondaryCls} gap-1`}><ChevronLeft size={16} aria-hidden /> Previous</Link>
              : <span />}
            <span className="text-sm text-ink-2">Page {page.page} of {page.pages}</span>
            {page.page < page.pages
              ? <Link href={href("/orders", { ...params, page: String(page.page + 1) })} className={`${btnSecondaryCls} gap-1`}>Next <ChevronRight size={16} aria-hidden /></Link>
              : <span />}
          </nav>
        )}
      </div>
    </CreateProvider>
  );
}
