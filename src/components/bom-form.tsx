"use client";

import type { FormAction } from "@/lib/action-result";
import { Form } from "@/components/form";
import { useState } from "react";
import { ReasonButton } from "@/components/notice";
import { AlertTriangle, Check, Minus, Plus } from "lucide-react";
import { btnCls, inputCls } from "@/components/flash";
import { NewItemCard } from "@/components/new-item-card";
import { isBlend, kindForCategory, validateBomLines, type BomLineInput, type BomLineKind } from "@/server/services/bom-math";

// The BOM editor: one numbered, colour-coded card per material, as many as the part needs, with the blend rules checked live.
// Rows post as repeated `itemId` and `value` fields (a percentage for blend lines, a quantity per part for inserts and packaging).

export interface BomItem { id: string; code: string; name: string; uom: string; category: string; polymerGrade: string | null; maxRegrindPct: number | null }
export interface BomInitial { fgItemId?: string; mouldId?: string; partWeightG?: number; lines: { itemId: string; value: number }[] }

interface Row { key: number; cat: string; itemId: string; value: string }

// What each kind of material is called, how it is measured, and the colour that carries through the card, the summary and the BOM list.
const KINDS: { cat: string; kind: BomLineKind; label: string; short: string; add: string; color: string; unit: string }[] = [
  { cat: "RM_RESIN", kind: "RESIN", label: "Resin", short: "RM", add: "Resin", color: "#1D4ED8", unit: "% by weight" },
  { cat: "RM_MASTERBATCH", kind: "MASTERBATCH", label: "Masterbatch", short: "MB", add: "Masterbatch", color: "#15171A", unit: "% by weight" },
  { cat: "REGRIND", kind: "REGRIND", label: "Regrind", short: "RG", add: "Regrind", color: "#E98A3E", unit: "% by weight" },
  { cat: "BOP", kind: "BOP", label: "Insert / bought-out", short: "BOP", add: "Insert", color: "#7A4E14", unit: "per part" },
  { cat: "PACKAGING", kind: "PACKAGING", label: "Packaging", short: "PKG", add: "Packaging", color: "#1E7A46", unit: "per good part" },
];
const BY_CAT = new Map(KINDS.map((k) => [k.cat, k]));

const g = (n: number) => `${(Math.round(n * 1000) / 1000).toLocaleString()} g`;
const pct = (n: number) => `${Math.round(n * 1000) / 1000}%`;

export function BomForm({ action, fgItems: fgProp, moulds, items: itemsProp, suppliers, canAddItems, initial, back }: {
  action: FormAction;
  fgItems: { id: string; code: string; name: string }[];
  moulds: { id: string; code: string; cavities: number }[];
  items: BomItem[];
  suppliers: { id: string; name: string }[];
  canAddItems: boolean; // may create new parts and materials (Masters access)
  initial?: BomInitial;
  back: string; // where the page returns on an error, so the editor stays open
}) {
  // Parts and materials created from inside this form join the lists straight away, without a reload that would lose the BOM.
  const [added, setAdded] = useState<BomItem[]>([]);
  const [addedFg, setAddedFg] = useState<{ id: string; code: string; name: string }[]>([]);
  const items = [...itemsProp, ...added];
  const fgItems = [...fgProp, ...addedFg];
  const [fgId, setFgId] = useState(initial?.fgItemId ?? fgProp[0]?.id ?? "");
  const [adding, setAdding] = useState<{ cat: string; rowKey?: number; lock: boolean } | null>(null);
  const [note, setNote] = useState("");
  const byId = new Map(items.map((i) => [i.id, i]));
  const [{ rows }, setState] = useState(() => {
    const seeded = (initial?.lines ?? []).map((l, i) => ({ key: i, cat: byId.get(l.itemId)?.category ?? "", itemId: l.itemId, value: String(l.value) }));
    return { next: seeded.length || 1, rows: seeded.length ? seeded : [{ key: 0, cat: "RM_RESIN", itemId: "", value: "" }] };
  });
  const [weight, setWeight] = useState(initial?.partWeightG ? String(initial.partWeightG) : "");
  type St = { next: number; rows: Row[] };
  const change = (f: (s: St) => St) => setState((s) => f(s));
  const add = (cat = "") => change((s) => ({ next: s.next + 1, rows: [...s.rows, { key: s.next, cat, itemId: "", value: "" }] }));
  const remove = (key: number) => change((s) => (s.rows.length > 1 ? { ...s, rows: s.rows.filter((r) => r.key !== key) } : s));
  const created = (it: BomItem) => {
    const rowKey = adding?.rowKey;
    setAdded((a) => [...a, it]);
    if (rowKey !== undefined) change((st) => ({ ...st, rows: st.rows.map((r) => (r.key === rowKey ? { ...r, cat: it.category, itemId: it.id } : r)) }));
    else change((st) => ({ next: st.next + 1, rows: [...st.rows, { key: st.next, cat: it.category, itemId: it.id, value: "" }] }));
    setAdding(null);
    setNote(`Created ${it.code}. It is in the item master now, so Stores tracks it and it can be put on a PO.`);
  };
  const set = (key: number, patch: Partial<Omit<Row, "key">>) => change((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  const chosen = new Set(rows.map((r) => r.itemId).filter(Boolean));
  const w = Number(weight);

  // The same rules the server applies on save, run on what is typed so far.
  const lines: BomLineInput[] = [];
  for (const r of rows) {
    const it = byId.get(r.itemId);
    const kind = it && kindForCategory(it.category);
    if (!it || !kind) continue;
    const v = Number(r.value);
    lines.push(isBlend(kind) ? { itemId: it.id, kind, pct: Number.isFinite(v) && r.value !== "" ? v : undefined } : { itemId: it.id, kind, qtyPerPart: Number.isFinite(v) && r.value !== "" ? v : undefined });
  }
  const sum = (kind: BomLineKind) => lines.filter((l) => l.kind === kind).reduce((a, l) => a + (l.pct ?? 0), 0);
  const virgin = sum("RESIN"), mb = sum("MASTERBATCH"), regrind = sum("REGRIND");
  const total = virgin + mb + regrind;
  const resins = lines.filter((l) => l.kind === "RESIN").map((l) => byId.get(l.itemId)!);
  const limits = resins.filter((r) => r.maxRegrindPct !== null);
  const strictest = limits.length ? limits.reduce((a, b) => (b.maxRegrindPct! < a.maxRegrindPct! ? b : a)) : undefined;
  const errors = validateBomLines(lines, strictest?.maxRegrindPct ?? undefined);
  // Regrind must be the same polymer as the resin it dilutes (the server checks this too).
  const grades = new Set(resins.map((r) => r.polymerGrade).filter(Boolean));
  for (const l of lines.filter((x) => x.kind === "REGRIND")) {
    const gr = byId.get(l.itemId)?.polymerGrade;
    if (gr && grades.size > 0 && !grades.has(gr)) errors.push(`Regrind ${byId.get(l.itemId)!.code} is ${gr}, but the resin here is ${[...grades].join("/")}.`);
  }
  const ready = errors.length === 0 && w > 0;
  const gap = Math.round((100 - total) * 1000) / 1000;

  return (
    <Form action={action} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-[13px]">
          <span className="flex items-baseline justify-between gap-2">Finished part
            {canAddItems && <button type="button" onClick={() => setAdding({ cat: "FG", lock: true })} className="cursor-pointer text-xs font-semibold text-accent">New part…</button>}
          </span>
          <select name="fgItemId" required value={fgId} onChange={(e) => setFgId(e.target.value)} className={inputCls}>
            {fgItems.length === 0 && <option value="">No finished parts yet</option>}
            {fgItems.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </label>
        <label className="text-[13px]">Mould
          <select name="mouldId" required defaultValue={initial?.mouldId} className={inputCls}>
            {moulds.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.cavities}-cavity</option>)}
          </select>
        </label>
        <label className="text-[13px]">Net part weight (g)
          <input name="partWeightG" type="number" step="any" min="0" required value={weight} onChange={(e) => setWeight(e.target.value)} className={inputCls} />
        </label>
      </div>

      {adding?.cat === "FG" && (
        <NewItemCard cat="FG" lockType suppliers={suppliers} onCancel={() => setAdding(null)}
          onCreated={(it) => { setAddedFg((a) => [...a, { id: it.id, code: it.code, name: it.name }]); setFgId(it.id); setAdding(null); setNote(`Created ${it.code}. Stores will track its stock against the levels you set.`); }} />
      )}

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold">Materials</span>
          <span className="text-xs text-ink-3">Resin, masterbatch and regrind are % by weight and must total 100%. Inserts and packaging are a quantity per part.</span>
        </div>

        <ol className="space-y-2.5">
          {rows.map((r, i) => {
            const it = byId.get(r.itemId);
            const k = BY_CAT.get(it?.category ?? r.cat);
            const blend = k ? isBlend(k.kind) : true;
            const v = Number(r.value);
            const options = r.cat ? items.filter((x) => x.category === r.cat || x.id === r.itemId) : items;
            return (
              <li key={r.key} className="overflow-hidden rounded-xl border border-border bg-canvas" style={{ borderLeft: `6px solid ${k?.color ?? "#C9C5BC"}` }}>
                <div className="grid items-start gap-x-3 gap-y-2.5 p-3 md:grid-cols-[2rem_minmax(0,1fr)_9.5rem_6.5rem_2rem]">
                  <div className="flex items-center justify-between gap-2 md:contents">
                    <span className="flex items-center gap-2 md:contents">
                      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-ink font-mono text-xs font-bold text-white md:mt-2.5" aria-hidden>{i + 1}</span>
                      <span className="rounded-md px-2 py-0.5 text-[11px] font-bold text-white md:hidden" style={{ background: k?.color ?? "#6B7280" }}>{k?.label ?? "Material"}</span>
                    </span>
                    <ReasonButton type="button" onClick={() => remove(r.key)} why={rows.length === 1 && "A BOM needs at least one material."} aria-label={`Remove material ${i + 1}`}
                      className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-full bg-danger text-white hover:bg-[#8f1a10] aria-disabled:bg-border aria-disabled:text-ink-3 md:order-last md:mt-1.5">
                      <Minus size={16} strokeWidth={3} aria-hidden />
                    </ReasonButton>
                  </div>

                  <label className="block min-w-0 text-[13px]">
                    <span className="mb-1 hidden items-center gap-1.5 text-[11px] font-bold md:flex" style={{ color: k?.color ?? "#6B7280" }}>{k?.label ?? "Material"}<span className="font-normal text-ink-3">· {k?.unit ?? "choose a material"}</span></span>
                    <span className="mb-1 block text-xs text-ink-3 md:hidden">Material</span>
                    <select name="itemId" required value={r.itemId} onChange={(e) => set(r.key, { itemId: e.target.value })} className={`${inputCls} mt-0`}>
                      <option value="">— choose {r.cat ? (BY_CAT.get(r.cat)?.label ?? "").toLowerCase() : "a material"} —</option>
                      {r.cat ? options.map((x) => <option key={x.id} value={x.id} disabled={chosen.has(x.id) && x.id !== r.itemId}>{x.code} · {x.name}{chosen.has(x.id) && x.id !== r.itemId ? " (already used)" : ""}</option>)
                        : KINDS.map((kk) => (
                          <optgroup key={kk.cat} label={`${kk.label} (${kk.unit})`}>
                            {items.filter((x) => x.category === kk.cat).map((x) => <option key={x.id} value={x.id} disabled={chosen.has(x.id) && x.id !== r.itemId}>{x.code} · {x.name}{chosen.has(x.id) && x.id !== r.itemId ? " (already used)" : ""}</option>)}
                          </optgroup>
                        ))}
                    </select>
                    {canAddItems && !it && <button type="button" onClick={() => setAdding({ cat: r.cat || "RM_RESIN", rowKey: r.key, lock: !!r.cat })} className="mt-1 cursor-pointer text-xs font-semibold text-accent">Not in the list? Add a new {(k?.label ?? "material").toLowerCase()}…</button>}
                  </label>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:contents">
                    <label className="block text-[13px]">
                      <span className="mb-1 block text-xs text-ink-3 md:hidden">{blend ? "Percentage" : "Quantity per part"}</span>
                      <span className="relative block md:mt-[1.375rem]">
                        <input name="value" type="number" required step="any" min="0" max={blend ? 100 : undefined} inputMode="decimal" placeholder={blend ? "0" : "1"} value={r.value}
                          onChange={(e) => set(r.key, { value: e.target.value })} className={`${inputCls} mt-0 ${blend ? "pr-9" : "pr-16"}`} />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3">{blend ? "%" : `${it?.uom ?? ""}`}</span>
                      </span>
                    </label>
                    <div className="flex flex-col justify-end text-xs text-ink-3 md:mt-[1.375rem] md:min-h-12 md:justify-center">
                      {blend && w > 0 && Number.isFinite(v) && r.value !== "" ? <><span className="font-mono text-[13px] font-semibold text-ink-2">{g((v / 100) * w)}</span><span>per part</span></> : <span>{blend ? "g per part" : ""}</span>}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {adding && adding.cat !== "FG" && <NewItemCard key={`${adding.rowKey ?? "x"}-${adding.cat}`} cat={adding.cat} lockType={adding.lock} suppliers={suppliers} onCancel={() => setAdding(null)} onCreated={created} />}
        {note && <p role="status" className="rounded-lg bg-ok-bg px-3 py-2 text-[13px] text-ok-ink">{note}</p>}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-3">Add a material</p>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k.cat} type="button" onClick={() => add(k.cat)}
                className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-white px-3.5 text-[13px] font-semibold text-ink-2 hover:border-accent hover:text-accent">
                <span className="size-2.5 rounded-full" style={{ background: k.color }} aria-hidden /><Plus size={14} aria-hidden /> {k.add}
              </button>
            ))}
            {canAddItems
              ? <button type="button" onClick={() => setAdding({ cat: "RM_RESIN", lock: false })} className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border-2 border-dashed border-accent px-3.5 text-[13px] font-semibold text-accent hover:bg-white"><Plus size={14} aria-hidden /> New material not in the system…</button>
              : <span className="flex min-h-11 items-center text-xs text-ink-3">New materials are added by an admin under Masters → Items.</span>}
          </div>
        </div>
      </div>

      <section aria-live="polite" aria-label="Blend check" className="space-y-2.5 rounded-xl bg-canvas p-3.5">
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px] bg-white" aria-hidden>
          {[{ p: virgin, c: "#1D4ED8" }, { p: regrind, c: "#E98A3E" }, { p: mb, c: "#15171A" }].filter((x) => x.p > 0).map((x, i) => (
            <span key={i} style={{ width: `${Math.min(x.p, 100)}%`, background: x.c }} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-2">
            <span><span className="mr-1 inline-block size-2 rounded-full" style={{ background: "#1D4ED8" }} />Resin <b>{pct(virgin)}</b></span>
            <span><span className="mr-1 inline-block size-2 rounded-full" style={{ background: "#E98A3E" }} />Regrind <b>{pct(regrind)}</b></span>
            <span><span className="mr-1 inline-block size-2 rounded-full" style={{ background: "#15171A" }} />Masterbatch <b>{pct(mb)}</b></span>
          </span>
          <span className={`flex items-center gap-1 font-semibold ${Math.abs(gap) < 0.01 ? "text-ok-ink" : gap > 0 ? "text-warn-ink" : "text-danger"}`}>
            {Math.abs(gap) < 0.01 ? <><Check size={15} aria-hidden /> Blend is 100%</> : gap > 0 ? <>Blend is {pct(total)}: add {pct(gap)} more</> : <>Blend is {pct(total)}: {pct(-gap)} over</>}
          </span>
        </div>
        {strictest && <p className="text-xs text-ink-3">Regrind {pct(regrind)} of the {strictest.maxRegrindPct}% this resin allows ({strictest.code}).</p>}
        {errors.length > 0 && rows.some((r) => r.itemId || r.value) && (
          <ul className="space-y-0.5 text-[13px] text-warn-ink">
            {errors.map((e) => <li key={e} className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden />{e}</li>)}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className={`${btnCls} w-full disabled:cursor-not-allowed disabled:opacity-50 md:w-auto`} disabled={fgItems.length === 0 || !ready}>Save BOM</button>
        {!ready && <span className="text-xs text-ink-3">{w > 0 ? "Fix the points above to save." : "Enter the net part weight and a blend that adds up to 100%."}</span>}
      </div>
    </Form>
  );
}
