"use client";

import type { FormAction } from "@/lib/action-result";
import { Form } from "@/components/form";
import { useState } from "react";
import { ReasonButton } from "@/components/notice";
import { Check, Minus, Plus } from "lucide-react";
import { ScanButton } from "@/components/scan-button";
import { normalizeCode } from "@/lib/scan-parse";
import { btnCls, inputCls } from "@/components/flash";
import { ExpediteBox } from "@/components/expedite-box";
import { addDays, daysBetween, longDate } from "@/lib/lead-time";

// The line items of an order form (supplier PO, PO edit, pick list): as many rows as the order needs, each its own numbered card
// with a red minus to drop it and a dotted "+ Add line" to grow the list. Rows post as repeated fields (itemId, qty, price, date).

export interface LineOption {
  id: string; code: string; name: string; uom: string;
  prices?: Record<string, number>; // PO: price-master price by supplier id
}
export interface LineSeed { itemId?: string; qty?: string; price?: string; date?: string }
interface Row { key: number; itemId: string; qty: string; price: string; date: string }

const rowOf = (key: number, s: LineSeed = {}): Row => ({ key, itemId: s.itemId ?? "", qty: s.qty ?? "", price: s.price ?? "", date: s.date ?? "" });

export function useLines(initial: LineSeed[] = [{}]) {
  // `next` is the key for the next row; keys keep inputs attached to their own row when others are removed.
  const [{ rows }, setState] = useState(() => {
    const seeds = initial.length ? initial : [{}];
    return { next: seeds.length, rows: seeds.map((s, i) => rowOf(i, s)) };
  });
  type St = { next: number; rows: Row[] };
  const change = (f: (st: St) => St) => setState((st) => f(st));
  return {
    rows,
    add: (seed?: LineSeed) => change((st) => ({ next: st.next + 1, rows: [...st.rows, rowOf(st.next, seed)] })),
    // Adds a line, fills an empty one, or tops up the quantity when the item is already on the order.
    put: (seed: LineSeed) => change((st) => {
      const at = st.rows.findIndex((x) => x.itemId === seed.itemId);
      if (at >= 0) return { ...st, rows: st.rows.map((x, i) => (i === at ? { ...x, qty: seed.qty ?? x.qty } : x)) };
      const blank = st.rows.findIndex((x) => !x.itemId && !x.qty);
      if (blank >= 0) return { ...st, rows: st.rows.map((x, i) => (i === blank ? { ...x, itemId: seed.itemId ?? "", qty: seed.qty ?? "" } : x)) };
      return { next: st.next + 1, rows: [...st.rows, rowOf(st.next, seed)] };
    }),
    remove: (key: number) => change((st) => (st.rows.length > 1 ? { ...st, rows: st.rows.filter((x) => x.key !== key) } : st)),
    set: (key: number, patch: Partial<Omit<Row, "key">>) => change((st) => ({ ...st, rows: st.rows.map((x) => (x.key === key ? { ...x, ...patch } : x)) })),
  };
}
export type Lines = ReturnType<typeof useLines>;

// Full class names, because Tailwind only generates classes it can read in the source.
const GRID = {
  dispatch: "md:grid-cols-[2rem_minmax(0,1fr)_8rem_2rem]",
  po: "md:grid-cols-[2rem_minmax(0,1fr)_8rem_8rem_2rem]",
  poDate: "md:grid-cols-[2rem_minmax(0,1fr)_8rem_8rem_9.5rem_2rem]",
  orderDate: "md:grid-cols-[2rem_minmax(0,1fr)_8rem_9.5rem_2rem]",
} as const;

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function LinesEditor({ lines, options, mode, supplierId, ready, showDate, locked, itemLabel = "Item", dateLabel = "Expected", note }: {
  lines: Lines; options: LineOption[]; mode: "po" | "dispatch" | "order"; // order: a customer order, every line with its own due date
  dateLabel?: string; note?: (o: LineOption) => string | undefined; // a line under the part, e.g. what is in stock
  supplierId?: string; // PO: whose price master to show
  ready?: Record<string, number>; // pick list: parts released and boxed for the chosen customer
  showDate?: boolean; locked?: boolean; itemLabel?: string;
}) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const chosen = new Set(lines.rows.map((r) => r.itemId).filter(Boolean));
  const po = mode === "po";
  const order = mode === "order";
  const master = (itemId: string) => (po && supplierId ? byId.get(itemId)?.prices?.[supplierId] : undefined);
  const priceOf = (r: Row) => { const p = num(r.price); return Number.isFinite(p) ? p : master(r.itemId); };

  // Footer: how much is on the order, per unit of measure, and what a PO is worth.
  const filled = lines.rows.filter((r) => r.itemId && Number(r.qty) > 0);
  const perUom = new Map<string, number>();
  let value = 0, priced = true;
  for (const r of filled) {
    const o = byId.get(r.itemId)!;
    perUom.set(o.uom, (perUom.get(o.uom) ?? 0) + Number(r.qty));
    const p = priceOf(r);
    if (po) { if (p === undefined) priced = false; else value += p * Number(r.qty); }
  }
  const grid = order ? GRID.orderDate : !po ? GRID.dispatch : showDate ? GRID.poDate : GRID.po;

  return (
    <div className="space-y-2.5">
      <div className={`hidden items-end gap-3 px-3 text-xs font-semibold text-ink-3 md:grid ${grid}`} aria-hidden>
        <span /><span>{itemLabel}</span><span>Quantity</span>{po && <span>Price (₹)</span>}{showDate && <span>{dateLabel}</span>}<span />
      </div>

      <ol className="space-y-2.5">
        {lines.rows.map((r, i) => {
          const o = byId.get(r.itemId);
          const m = master(r.itemId);
          const p = priceOf(r);
          const q = Number(r.qty);
          const stock = !po && o && ready ? ready[o.id] ?? 0 : undefined;
          const short = stock !== undefined && q > stock;
          return (
            <li key={r.key} className="rounded-xl border border-border bg-canvas p-3">
              <div className={`grid items-start gap-x-3 gap-y-2.5 ${grid}`}>
                <div className="flex items-center justify-between md:contents">
                  <span className="flex size-7 flex-none items-center justify-center rounded-full bg-ink font-mono text-xs font-bold text-white md:mt-2.5" aria-hidden>{i + 1}</span>
                  <ReasonButton type="button" onClick={() => lines.remove(r.key)}
                    why={locked ? "This list can't be changed right now." : lines.rows.length === 1 && "An order needs at least one line."}
                    aria-label={`Remove line ${i + 1}`}
                    className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-full bg-danger text-white hover:bg-[#8f1a10] aria-disabled:bg-border aria-disabled:text-ink-3 md:order-last md:mt-1.5">
                    <Minus size={16} strokeWidth={3} aria-hidden />
                  </ReasonButton>
                </div>

                <div className="flex min-w-0 items-end gap-2">
                  <label className="block min-w-0 flex-1 text-[13px]">
                    <span className="text-xs text-ink-3 md:sr-only">{itemLabel}</span>
                    <select name="itemId" value={r.itemId} required disabled={locked} onChange={(e) => lines.set(r.key, { itemId: e.target.value })} className={`${inputCls} mt-1 md:mt-0`}>
                      <option value="">— choose —</option>
                      {options.map((x) => <option key={x.id} value={x.id} disabled={chosen.has(x.id) && x.id !== r.itemId}>{x.code} · {x.name}{chosen.has(x.id) && x.id !== r.itemId ? " (already on this order)" : ""}</option>)}
                    </select>
                  </label>
                  {!locked && (
                    <ScanButton title={`Scan the ${itemLabel.toLowerCase()}`} hint="Its code, a lot tag or a box label." label={`Scan the ${itemLabel.toLowerCase()} for line ${i + 1}`}
                      onScan={async (scanned) => {
                        const code = normalizeCode(scanned);
                        let found = options.find((x) => x.code.toUpperCase() === code);
                        if (!found) { // a lot tag or box label: ask which item it is
                          const res = await fetch(`/api/v1/locate?code=${encodeURIComponent(code)}`).catch(() => null);
                          const where = res?.ok ? await res.json() : null;
                          found = options.find((x) => x.code === where?.itemCode);
                        }
                        if (found && !chosen.has(found.id)) lines.set(r.key, { itemId: found.id });
                      }} />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:contents">
                  <label className="block text-[13px]">
                    <span className="text-xs text-ink-3 md:sr-only">Quantity</span>
                    <span className="relative mt-1 block md:mt-0">
                      <input name="qty" type="number" required min={po ? "0.001" : "1"} step={po ? "any" : "1"} inputMode="decimal" placeholder="0" value={r.qty} disabled={locked}
                        onChange={(e) => lines.set(r.key, { qty: e.target.value })} className={`${inputCls} mt-0 pr-12 ${short ? "border-warn-ink" : ""}`} />
                      {o && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3">{o.uom}</span>}
                    </span>
                  </label>
                  {po && (
                    <label className="block text-[13px]">
                      <span className="text-xs text-ink-3 md:sr-only">Price (₹)</span>
                      <input name="price" type="number" min="0" step="any" inputMode="decimal" placeholder={m !== undefined ? String(m) : "price"} value={r.price} disabled={locked}
                        onChange={(e) => lines.set(r.key, { price: e.target.value })} className={`${inputCls} mt-1 md:mt-0`} />
                    </label>
                  )}
                  {showDate && (
                    <label className="col-span-2 block text-[13px] md:col-span-1">
                      <span className="text-xs text-ink-3 md:sr-only">{dateLabel}</span>
                      <input name="date" type="date" value={r.date} disabled={locked} required={order} onChange={(e) => lines.set(r.key, { date: e.target.value })} className={`${inputCls} mt-1 md:mt-0`} />
                    </label>
                  )}
                </div>
              </div>

              {o && (
                <p className="mt-1.5 pl-0 text-xs text-ink-3 md:pl-[2.75rem]">
                  {po && <>{m !== undefined ? <>Price master {money(m)} / {o!.uom}{r.price === "" ? " (used when blank)" : ""}</> : <>No price master for this supplier: enter a price or set one later</>}{Number.isFinite(q) && q > 0 && p !== undefined && <> · line value <strong className="text-ink-2">{money(q * p)}</strong></>}</>}
                  {order && note?.(o!)}
                  {!po && !order && stock !== undefined && (
                    <span className={short ? "font-semibold text-warn-ink" : ""}>
                      {stock.toLocaleString()} {o!.uom} boxed &amp; released for this customer{short ? `: you asked for ${q.toLocaleString()}, so the load will be short` : ""}
                    </span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {!locked && (
        <button type="button" onClick={() => lines.add(order ? { date: lines.rows[lines.rows.length - 1]?.date } : undefined)}
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-ink-3 hover:border-accent hover:text-accent">
          <Plus size={18} aria-hidden /> Add line
        </button>
      )}

      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 text-[13px] text-ink-2" aria-live="polite">
        <span><strong>{filled.length}</strong> line{filled.length === 1 ? "" : "s"}{perUom.size > 0 && <> · {[...perUom].map(([u, n]) => `${n.toLocaleString()} ${u}`).join(" + ")}</>}</span>
        {po && filled.length > 0 && <span>Order value <strong>{money(value)}</strong>{!priced && <span className="text-ink-3"> (some lines have no price yet)</span>}</span>}
      </p>
    </div>
  );
}

// ───────── New supplier PO ─────────

export function NewPoForm({ action, suppliers, items, pre, today }: {
  action: FormAction;
  suppliers: { id: string; name: string; leadTimeDays: number }[]; items: LineOption[];
  pre?: { supplierId?: string; itemId?: string; qty?: string };
  today: string; // the server's date, so the first render matches on the server and in the browser
}) {
  const lines = useLines([{ itemId: pre?.itemId, qty: pre?.qty }]);

  // Who supplies what comes from the price master, so it works from either end: pick a supplier and see its products, or pick a
  // product and see who supplies it (cheapest first). Everything below reads the same `prices` on each item.
  const supplying = (itemId: string) => suppliers
    .flatMap((s) => { const price = items.find((i) => i.id === itemId)?.prices?.[s.id]; return price === undefined ? [] : [{ ...s, price }]; })
    .sort((a, b) => a.price - b.price);
  const catalogueOf = (sid: string) => items.filter((i) => i.prices?.[sid] !== undefined);

  const [supplierId, setSupplierId] = useState(pre?.supplierId ?? (pre?.itemId ? supplying(pre.itemId)[0]?.id : undefined) ?? suppliers[0]?.id ?? "");
  const [want, setWant] = useState(pre?.itemId ?? ""); // "find a supplier for…": the product the person started from
  const [onlyMine, setOnlyMine] = useState(true);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const mine = catalogueOf(supplierId);
  const wanted = want ? items.find((i) => i.id === want) : undefined;
  const sources = want ? supplying(want) : [];
  const startFrom = (itemId: string) => {
    setWant(itemId);
    if (!itemId) return;
    lines.put({ itemId });
    const best = supplying(itemId)[0];
    if (best) setSupplierId(best.id); // the cheapest supplier of that product; the person can change it below
  };
  // Lines offer this supplier's products by default; the box lets a buyer add something it isn't listed for (priced by hand).
  const chosenIds = new Set(lines.rows.map((r) => r.itemId).filter(Boolean));
  const offered = onlyMine && mine.length > 0 ? items.filter((i) => i.prices?.[supplierId] !== undefined || chosenIds.has(i.id)) : items;
  const lead = supplier?.leadTimeDays ?? 0;
  const earliest = addDays(today, lead);
  // The expected date follows the chosen supplier's lead time until the person picks a date of their own.
  const [picked, setPicked] = useState<string | null>(null);
  const expected = picked ?? earliest;
  const early = expected < earliest;
  const [expedite, setExpedite] = useState<boolean | null>(null);
  const asked = expedite ?? early;
  return (
    <Form action={action} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-[13px]">Supplier
          <select name="supplierId" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
            {wanted ? (
              <>
                <optgroup label={`Supply ${wanted.code}`}>
                  {sources.map((s, i) => <option key={s.id} value={s.id}>{s.name} · ₹{s.price}/{wanted.uom} · {s.leadTimeDays}d{i === 0 && sources.length > 1 ? " · cheapest" : ""}</option>)}
                </optgroup>
                <optgroup label="Don't list it yet">
                  {suppliers.filter((s) => !sources.some((x) => x.id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.leadTimeDays}d lead time</option>)}
                </optgroup>
              </>
            ) : suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.leadTimeDays}d lead time · {catalogueOf(s.id).length} products</option>)}
          </select>
        </label>
        <label className="text-[13px]">Segment
          <select name="segment" className={inputCls}><option value="NON_AUTOMOTIVE">Non-automotive</option><option value="AUTOMOTIVE">Automotive (COA at GRN)</option></select>
        </label>
      </div>

      <details className="group rounded-xl border border-border bg-white" open={!!want}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
          <span>Starting from a product? Find who supplies it</span><span className="text-xs font-normal text-ink-3 group-open:hidden">optional</span>
        </summary>
        <div className="space-y-2 border-t border-line p-3.5">
          <label className="block text-[13px]">Product
            <select value={want} onChange={(e) => startFrom(e.target.value)} className={inputCls}>
              <option value="">— choose a product —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name} ({supplying(i.id).length} supplier{supplying(i.id).length === 1 ? "" : "s"})</option>)}
            </select>
          </label>
          {wanted && (sources.length === 0
            ? <p className="text-xs text-warn-ink">No supplier lists {wanted.code} yet. Pick any supplier below and enter a price by hand, or add the supplier on the item in Masters.</p>
            : <p className="text-xs text-ink-2">{sources.length} supplier{sources.length === 1 ? "" : "s"} supply {wanted.code}: the cheapest, <b>{sources[0].name}</b> at ₹{sources[0].price}/{wanted.uom}, is picked. Change the supplier above to compare lead times.</p>)}
        </div>
      </details>

      {supplier && mine.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-3">{supplier.name} supplies {mine.length} product{mine.length === 1 ? "" : "s"}: tap to add</p>
          <div className="flex flex-wrap gap-1.5">
            {mine.map((i) => (
              <button key={i.id} type="button" onClick={() => lines.put({ itemId: i.id })} disabled={chosenIds.has(i.id)}
                className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-border bg-white px-3 text-[13px] font-semibold hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
                {chosenIds.has(i.id) ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />} {i.code} <span className="font-normal text-ink-3">₹{i.prices?.[supplierId]}/{i.uom}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {supplier && mine.length === 0 && <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-xs text-warn-ink">{supplier.name} has no products listed yet, so every line needs a price by hand. Add what it supplies on the supplier (Customers &amp; suppliers) or on each item (Masters).</p>}

      {supplier && (
        <div className="grid gap-3 rounded-xl bg-canvas p-3.5 md:grid-cols-[1fr_auto] md:items-end" aria-live="polite">
          <div className="space-y-0.5 text-[13px]">
            <div><strong>Lead time {lead} day{lead === 1 ? "" : "s"}</strong> <span className="text-ink-2">· earliest delivery <b>{longDate(earliest)}</b></span></div>
            <p className={`text-xs ${early ? "font-semibold text-warn-ink" : "text-ink-3"}`}>
              {early ? `${daysBetween(expected, earliest)} day${daysBetween(expected, earliest) === 1 ? "" : "s"} before ${supplier.name} can normally deliver.` : `Normal delivery. Pick an earlier date to ask ${supplier.name} to expedite.`}
            </p>
          </div>
          <label className="text-[13px] md:w-52">Expected delivery
            <input name="expected" type="date" required min={today} value={expected} onChange={(e) => setPicked(e.target.value)} className={inputCls} />
          </label>
        </div>
      )}
      <ExpediteBox asked={asked} early={early} leadTimeDays={lead} onChange={setExpedite} />

      <label className="block max-w-md text-[13px]">Your PO reference <span className="text-ink-3">(optional)</span>
        <input name="externalRef" maxLength={40} placeholder="from your other system" className={inputCls} />
      </label>

      {mine.length > 0 && (
        <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-[#c2410c]" />
          Only show {supplier?.name}&apos;s products in the lines
        </label>
      )}
      <LinesEditor lines={lines} options={offered} mode="po" supplierId={supplierId} />
      <p className="text-xs text-ink-3">Blank prices use the price master. Every line is expected on the date above.</p>
      <button className={`${btnCls} w-full md:w-auto`}>Create &amp; approve PO</button>
    </Form>
  );
}

// ───────── New pick list ─────────

export interface Suggestion { customerId: string; itemId: string; qty: number; due: string }

export function NewPickListForm({ action, customers, parts, ready, suggestions }: {
  action: FormAction;
  customers: { id: string; name: string }[]; parts: LineOption[];
  ready: Record<string, Record<string, number>>; // customer id -> part id -> boxed and released quantity
  suggestions: Suggestion[];
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const lines = useLines([{}]);
  const code = new Map(parts.map((p) => [p.id, p.code]));
  const mine = suggestions.filter((s) => s.customerId === customerId && code.has(s.itemId));
  return (
    <Form action={action} className="space-y-4">
      <label className="block max-w-xl text-[13px]">Customer
        <select name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      {mine.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-3">Due soon from this customer: tap to add</p>
          <div className="flex flex-wrap gap-1.5">
            {mine.map((s) => (
              <button key={`${s.itemId}-${s.due}`} type="button" onClick={() => lines.put({ itemId: s.itemId, qty: String(s.qty) })}
                className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-border bg-white px-3 text-[13px] font-semibold hover:border-accent hover:text-accent">
                <Plus size={14} aria-hidden /> {code.get(s.itemId)} · {s.qty.toLocaleString()} <span className="font-normal text-ink-3">due {s.due}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <LinesEditor lines={lines} options={parts} mode="dispatch" ready={ready[customerId] ?? {}} itemLabel="Part" />
      <button className={`${btnCls} w-full md:w-auto`}>Create &amp; start loading</button>
    </Form>
  );
}

// ───────── New customer order ─────────

export interface OrderPart extends LineOption { onHand: number; toShip: number }

/** A customer order entered by hand: the customer, their own PO number, firm or spot, and any number of part lines with a due date each. */
export function NewCustomerOrderForm({ action, customers, parts, today, back }: {
  action: FormAction;
  customers: { id: string; name: string; segment: string }[]; parts: OrderPart[];
  today: string; // the server's date, so the first render matches on the server and in the browser
  back: string;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const customer = customers.find((c) => c.id === customerId);
  const lines = useLines([{ date: addDays(today, 14) }]);
  const stock = new Map(parts.map((p) => [p.id, p]));
  const note = (o: LineOption) => {
    const p = stock.get(o.id);
    return p ? `${p.onHand.toLocaleString()} ${o.uom} in stock · ${p.toShip.toLocaleString()} already on order to ship` : undefined;
  };
  return (
    <Form action={action} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-[13px]">Customer
          <select name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-[13px]">Their PO number <span className="text-ink-3">(optional)</span>
          <input name="customerRef" maxLength={40} placeholder="the customer's own number" autoComplete="off" className={inputCls} />
        </label>
        <label className="text-[13px]">Order type
          <select name="type" className={inputCls}><option value="FIRM">Firm order</option><option value="SPOT">Spot order</option></select>
        </label>
      </div>
      {customer && (
        <p className="rounded-xl bg-canvas px-3.5 py-2.5 text-xs text-ink-2">
          {customer.segment === "AUTOMOTIVE"
            ? "Automotive customer: its parts are planned to a strict Kanban minimum, and lots ship with the OEM label."
            : "Non-automotive customer: its parts are planned from their reorder point."}
        </p>
      )}
      <LinesEditor lines={lines} options={parts} mode="order" showDate dateLabel="Due" itemLabel="Part" note={note} />
      <p className="text-xs text-ink-3">Each line becomes a demand line the MRP plan and the machine plan work from. Shipping a dispatch for this customer and part closes the oldest open line first.</p>
      <button className={`${btnCls} w-full md:w-auto`}>Add customer order</button>
    </Form>
  );
}

// ───────── Edit a PO's lines ─────────

export function EditPoLines({ action, poId, supplierId, items, initial, locked }: {
  action: FormAction; poId: string; supplierId: string; items: LineOption[];
  initial: { itemId: string; qty: string; price: string; date: string }[]; locked: boolean;
}) {
  const lines = useLines(initial.length ? initial : [{}]);
  return (
    <Form action={action} className="space-y-4">
      <input type="hidden" name="id" value={poId} />
      <LinesEditor lines={lines} options={items} mode="po" supplierId={supplierId} showDate locked={locked} />
      <button className={`${btnCls} w-full disabled:opacity-50 md:w-auto`} disabled={locked}>Save changes</button>
    </Form>
  );
}
