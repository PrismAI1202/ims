import { ScanSearch } from "@/components/scan-search";
import { Form } from "@/components/form";
import Link from "next/link";
import { Check, Pencil, Plus } from "lucide-react";
import { db } from "@/server/db";
import { can, canView } from "@/server/auth/permissions";
import { requireView, requirePermission, runAction } from "@/server/auth/guard";
import { transferStock } from "@/server/services/inventory";
import { stockByItem } from "@/server/services/stock";
import { addBin, removeBin, removeRack, renameBin, renameRack, renameShelf } from "@/server/services/masters";
import { Flash } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CountsTab } from "./counts";
import { startSheet } from "./count-actions";
import { MoveLotForm } from "@/components/move-lot-form";
import { Drawer, dotted, field, RemoveButton } from "@/components/edit-mode";
import { X } from "lucide-react";
import {
  Badge, Card, Chip, Chips, Eyebrow, LegendDot, MinMaxBar, Mono, PageHeader, StoresTabs,
} from "@/components/ui";

export const instant = false;

async function transfer(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.transfer");
  const back = String(formData.get("back") || "/stock");
  return runAction(back, "Stock moved.", async () => {
    await transferStock({
      lotNumber: String(formData.get("lotNumber")).trim(),
      fromCode: String(formData.get("fromCode")).trim(),
      toCode: String(formData.get("toCode")).trim(),
      qty: Number(formData.get("qty")),
      userId: user.id,
    });
  });
}

const STATUS = {
  RED: { label: "Below min", color: "#B42318", fg: "text-danger" },
  YELLOW: { label: "Near ROP", color: "#E0A526", fg: "text-warn-ink" },
  GREEN: { label: "Optimal", color: "#1E7A46", fg: "text-ok" },
} as const;
type Status = keyof typeof STATUS;

const CATS: { key: string; label: string; match: (c: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "rm", label: "RM", match: (c) => c === "RM_RESIN" },
  { key: "mb", label: "MB", match: (c) => c === "RM_MASTERBATCH" },
  { key: "bop", label: "BOP", match: (c) => c === "BOP" },
  { key: "pkg", label: "PKG", match: (c) => c === "PACKAGING" || c === "RETURNABLE" },
  { key: "fg", label: "FG", match: (c) => c === "FG" },
];
const CAT_CHIP: Record<string, string> = {
  RM_RESIN: "RM", RM_MASTERBATCH: "MB", BOP: "BOP", PACKAGING: "PKG", RETURNABLE: "PKG", REGRIND: "RG", FG: "FG",
};

type BinState = "full" | "part" | "empty" | "hold";
const BIN_STYLE: Record<BinState, string> = {
  full: "bg-[#1D4ED8] text-white border-transparent",
  part: "bg-[#8FAEF0] text-ink border-transparent",
  empty: "bg-white text-ink-3 border-[#C9C5BC]",
  hold: "bg-[#E98A3E] text-ink border-transparent",
};

const EDIT = "/stock?view=bins&edit=1";

// The small tags on a bin tile and in the summary strip.
const TAG = {
  qc: "bg-[#FDF0D5] text-[#7A4E14]", ready: "bg-[#DDF3E4] text-[#1E7A46]",
  counting: "bg-[#E0E9FF] text-[#1D4ED8]", approve: "bg-[#FDE4E1] text-[#B42318]",
} as const;
const pill = "flex min-h-8 items-center rounded-full px-3 text-xs font-semibold";
const tag = "rounded px-1 text-[9px] font-bold uppercase leading-4";

// Adds a shelf/bin to an existing rack, or starts a new rack with its first bin.
async function addBinAction(formData: FormData) {
  "use server";
  await requirePermission("bins.manage");
  return runAction(EDIT, "Bin added. Print its label from Print bin labels.", async () => {
    await addBin({ rack: formData.get("rack"), shelf: formData.get("shelf"), bin: formData.get("bin") });
  });
}

const RELABEL = " Labels already printed for the renamed bins are out of date: print new ones.";
const text = (f: FormData, k: string) => String(f.get(k) ?? "");

async function removeBinAction(formData: FormData) {
  "use server";
  await requirePermission("bins.manage");
  return runAction(EDIT, "Bin removed.", async () => { await removeBin(text(formData, "id")); });
}

async function removeRackAction(formData: FormData) {
  "use server";
  await requirePermission("bins.manage");
  const rack = text(formData, "rack");
  return runAction(EDIT, `Rack ${rack} removed.`, async () => { await removeRack(rack); });
}

async function renameBinAction(formData: FormData) {
  "use server";
  await requirePermission("bins.manage");
  return runAction(EDIT, "Bin renamed." + RELABEL, async () => { await renameBin(text(formData, "id"), text(formData, "to")); });
}

async function renameShelfAction(formData: FormData) {
  "use server";
  await requirePermission("bins.manage");
  return runAction(EDIT, "Shelf renamed." + RELABEL, async () => { await renameShelf(text(formData, "rack"), text(formData, "shelf"), text(formData, "to")); });
}

async function renameRackAction(formData: FormData) {
  "use server";
  await requirePermission("bins.manage");
  return runAction(EDIT, "Rack renamed." + RELABEL, async () => { await renameRack(text(formData, "rack"), text(formData, "to")); });
}

type Search = { error?: string; ok?: string; view?: string; status?: string; cat?: string; bin?: string; item?: string; q?: string; edit?: string };

export default async function StockPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireView("stock");
  const sp = await searchParams;
  const counting = can(user, "stock.count") || can(user, "stock.adjust");
  const view = sp.view === "bins" || sp.view === "counts" ? "bins" : "stock"; // counts are part of the bin map now; old links still land here
  const canMove = can(user, "stock.transfer");
  // Layout editing is its own switch: only roles ticked for "edit the store layout" see it.
  const canEdit = can(user, "bins.manage");
  const editing = view === "bins" && canEdit && sp.edit === "1";

  const [rows, balances, locations, boxedRows] = await Promise.all([
    stockByItem(),
    db.stockBalance.findMany({
      where: { qty: { gt: 0 } },
      include: { lot: { include: { item: true } }, location: true },
      orderBy: [{ location: { code: "asc" } }, { lot: { receivedAt: "asc" } }],
    }),
    db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.fgBox.groupBy({ by: ["lotId", "locationId"], where: { status: "IN_STOCK" }, _sum: { qty: true } }),
  ]);
  // Parts already in labelled boxes are reserved for dispatch and cannot be moved.
  const boxed = new Map(boxedRows.map((r) => [`${r.lotId}:${r.locationId}`, r._sum.qty ?? 0]));

  const where = new Map<string, Set<string>>();
  for (const b of balances) {
    const set = where.get(b.lot.itemId) ?? new Set<string>();
    set.add(b.location.code);
    where.set(b.lot.itemId, set);
  }

  const header = (
    <PageHeader
      eyebrow={`STORES · ${user.role.replace("_", " ")}`}
      title="Stores"
    >
      <StoresTabs active={view} user={user} />
    </PageHeader>
  );

  if (view === "bins") {
    const byLoc = new Map<string, typeof balances>();
    for (const b of balances) byLoc.set(b.locationId, [...(byLoc.get(b.locationId) ?? []), b]);
    const stateOf = (locId: string): BinState => {
      const bs = byLoc.get(locId) ?? [];
      if (bs.length === 0) return "empty";
      if (bs.some((b) => b.lot.qcStatus === "PENDING_QC")) return "hold";
      return bs.some((b) => Number(b.qty) < Number(b.lot.receivedQty)) ? "part" : "full";
    };
    // What is pending in each bin: QC on a lot, a count being done or waiting for approval, an approved lot waiting to be put away.
    const openCounts = await db.stockCount.findMany({ where: { status: { in: ["OPEN", "SUBMITTED"] } }, select: { locationId: true, status: true } });
    const countOf = new Map<string, "OPEN" | "SUBMITTED">();
    for (const c of openCounts) if (countOf.get(c.locationId) !== "SUBMITTED") countOf.set(c.locationId, c.status as "OPEN" | "SUBMITTED");
    const infoOf = (locId: string) => {
      const bs = byLoc.get(locId) ?? [];
      return {
        items: [...new Set(bs.map((b) => b.lot.item.code))],
        qc: bs.filter((b) => b.lot.qcStatus === "PENDING_QC").length,
        ready: bs.filter((b) => b.location.type === "STAGING" && (b.lot.qcStatus === "APPROVED" || b.lot.qcStatus === "DEVIATED")).length,
        count: countOf.get(locId),
      };
    };
    const canQc = can(user, "qc.inspect") && canView(user, "quality");
    const qcHref = (lot: string) => `/quality?tab=inward&lot=${encodeURIComponent(lot)}#lot-${lot}`;
    const stagingIds = new Set(locations.filter((l) => l.type === "STAGING").map((l) => l.id));
    const stagingCode = locations.find((l) => l.type === "STAGING")?.code ?? "";
    const totals = {
      qc: balances.filter((b) => b.lot.qcStatus === "PENDING_QC").length,
      ready: balances.filter((b) => stagingIds.has(b.locationId) && (b.lot.qcStatus === "APPROVED" || b.lot.qcStatus === "DEVIATED")).length,
      counting: openCounts.filter((c) => c.status === "OPEN").length,
      approve: openCounts.filter((c) => c.status === "SUBMITTED").length,
    };
    const racks = [...new Set(locations.map((l) => l.rack))];
    const highlight = new Set(sp.item ? (rows.find((r) => r.code === sp.item) ? [...(where.get(rows.find((r) => r.code === sp.item)!.itemId) ?? [])] : []) : []);
    const selected = !editing && sp.bin ? locations.find((l) => l.code === sp.bin) : undefined;
    const selBalances = selected ? byLoc.get(selected.id) ?? [] : [];
    const targetsFor = (fromId: string) => locations.filter((l) => l.type === "STORAGE" && l.id !== fromId).map((l) => {
      const bs = byLoc.get(l.id) ?? [];
      const codes = [...new Set(bs.map((b) => b.lot.item.code))];
      return { code: l.code, rack: l.rack, note: bs.length === 0 ? "empty" : `holds ${codes.slice(0, 2).join(", ")}${codes.length > 2 ? "…" : ""}` };
    });
    const here = `/stock?view=bins&bin=${selected?.code ?? ""}${sp.item ? `&item=${sp.item}` : ""}`;
    const closeHref = `/stock?view=bins${sp.item ? `&item=${sp.item}` : ""}`;

    return (
      <div className="space-y-4">
        {header}
        {!selected && !editing && <Flash error={sp.error} ok={sp.ok} />}
        {!editing && (totals.qc + totals.ready + totals.counting + totals.approve > 0) && (
          <div className="flex flex-wrap gap-2">
            {totals.qc > 0 && (canQc
              ? <Link href="/quality?tab=inward" className={`${pill} ${TAG.qc}`}>{totals.qc} lot{totals.qc === 1 ? "" : "s"} waiting for QC →</Link>
              : <span className={`${pill} ${TAG.qc}`}>{totals.qc} lot{totals.qc === 1 ? "" : "s"} waiting for QC</span>)}
            {totals.ready > 0 && <Link href={`/stock?view=bins&bin=${stagingCode}`} className={`${pill} ${TAG.ready}`}>{totals.ready} released, to put away →</Link>}
            {counting && totals.counting > 0 && <a href="#counts" className={`${pill} ${TAG.counting}`}>{totals.counting} count{totals.counting === 1 ? "" : "s"} in progress ↓</a>}
            {counting && totals.approve > 0 && <a href="#counts" className={`${pill} ${TAG.approve}`}>{totals.approve} count{totals.approve === 1 ? "" : "s"} to approve ↓</a>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
          <ScanSearch mode="locate" title="Scan a lot, box or bin" hint="A bin label opens that bin; a lot tag or box label opens the bin it is in." />
          <LegendDot color="#1D4ED8" label="Full" />
          <LegendDot color="#8FAEF0" label="Part" />
          <LegendDot color="#FFFFFF" label="Empty" border />
          <LegendDot color="#E98A3E" label="QC hold" />
          {canEdit && (
            <span className="ml-auto flex flex-wrap items-center gap-3">
              <Link href="/masters/bin-labels" className="font-semibold text-accent">Print bin labels</Link>
              <Link href={editing ? "/stock?view=bins" : EDIT} scroll={false} aria-pressed={editing}
                className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold ${editing ? "bg-ink text-white" : "border border-border bg-white text-ink"}`}>
                {editing ? <><Check size={15} aria-hidden /> Done</> : <><Pencil size={15} aria-hidden /> Edit layout</>}
              </Link>
            </span>
          )}
        </div>
        {editing && (
          <p className="rounded-xl bg-info-bg px-3.5 py-2.5 text-[13px] text-info-ink">
            Editing the layout. Tap a dotted <b>+</b> to add a shelf and bin to a rack, or the dotted box at the end to start a new rack. Tap a bin or a rack name to rename it. The red <b>−</b> removes an empty bin or rack; it is greyed out while anything is still stored there.
          </p>
        )}
        <Flash error={editing ? sp.error : undefined} ok={editing ? sp.ok : undefined} />
        {sp.item && <p className="text-sm text-ink-2">Showing bins that hold <Mono className="font-semibold">{sp.item}</Mono> (outlined). <Link href="/stock?view=bins" className="font-semibold text-accent">Clear</Link></p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {racks.map((rack) => {
            const rackBins = locations.filter((l) => l.rack === rack);
            const rackBusy = rackBins.some((l) => (byLoc.get(l.id)?.length ?? 0) > 0);
            const shelves = [...new Set(rackBins.map((l) => l.shelf))];
            const layoutRack = editing && rack !== "STG";
            return (
              <Card key={rack} className="relative space-y-2">
                {layoutRack && (
                  <Form action={removeRackAction}>
                    <input type="hidden" name="rack" value={rack} />
                    <RemoveButton label={`Remove rack ${rack}`} busy={rackBusy} why="Empty every bin in this rack first" />
                  </Form>
                )}
                {layoutRack ? (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden" aria-label={`Rename rack ${rack} or its shelves`}>
                      <h2 className="font-display text-sm font-bold">Rack {rack}</h2>
                      <span className="flex items-center gap-1 text-xs font-semibold text-ink-3 group-open:text-accent"><Pencil size={13} aria-hidden /> Rename</span>
                    </summary>
                    <div className="mt-2 space-y-3 rounded-lg bg-canvas p-2.5">
                      <Form action={renameRackAction} className="flex items-end gap-2">
                        <input type="hidden" name="rack" value={rack} />
                        <label className="flex-1 text-xs">Rack name<input name="to" required maxLength={10} defaultValue={rack} className={field} /></label>
                        <button className="min-h-10 cursor-pointer rounded-lg bg-accent px-3 text-sm font-semibold text-white">Rename rack</button>
                      </Form>
                      <Form action={renameShelfAction} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                        <input type="hidden" name="rack" value={rack} />
                        <label className="text-xs">Shelf<select name="shelf" className={field}>{shelves.map((sh) => <option key={sh}>{sh}</option>)}</select></label>
                        <label className="text-xs">New name<input name="to" required maxLength={10} className={field} /></label>
                        <button className="min-h-10 cursor-pointer rounded-lg bg-accent px-3 text-sm font-semibold text-white">Rename</button>
                      </Form>
                      <p className="text-xs text-ink-3">Renaming changes the scan code of every bin it touches. Stock stays where it is.</p>
                    </div>
                  </details>
                ) : (
                  <h2 className="font-display text-sm font-bold">{rack === "STG" ? "Staging (awaiting QC)" : `Rack ${rack}`}</h2>
                )}
                {rack === "STG" && !editing ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white text-[13px]">
                    {rackBins.flatMap((l) => byLoc.get(l.id) ?? []).map((b) => {
                      const ready = b.lot.qcStatus === "APPROVED" || b.lot.qcStatus === "DEVIATED";
                      return (
                        <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                          <span className="min-w-0">
                            <Mono className="text-xs font-semibold">{b.lot.lotNumber}</Mono>
                            <span className="ml-2">{b.lot.item.code}</span>
                            <span className="ml-2 text-ink-3">{Number(b.qty).toLocaleString()} {b.lot.item.uom}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            {b.lot.qcStatus === "PENDING_QC" && <span className={`${tag} ${TAG.qc}`}>Waiting for QC</span>}
                            {ready && <span className={`${tag} ${TAG.ready}`}>Released</span>}
                            {b.lot.qcStatus === "REJECTED" && <span className={`${tag} ${TAG.approve}`}>Rejected</span>}
                            {countOf.get(b.locationId) === "SUBMITTED" && <span className={`${tag} ${TAG.approve}`}>Count to approve</span>}
                            {b.lot.qcStatus === "PENDING_QC" && canQc && <Link href={qcHref(b.lot.lotNumber)} className="text-xs font-semibold text-accent">Do QC →</Link>}
                            {ready && canMove && <Link href={`/stock?view=bins&bin=${b.location.code}`} className="text-xs font-semibold text-accent">Put away →</Link>}
                            {b.lot.qcStatus === "REJECTED" && can(user, "rtv.manage") && canView(user, "quality") && <Link href="/quality?tab=rtv" className="text-xs font-semibold text-accent">Send back →</Link>}
                          </span>
                        </li>
                      );
                    })}
                    {rackBins.every((l) => (byLoc.get(l.id)?.length ?? 0) === 0) && <li className="px-3 py-2 text-ink-3">Nothing in staging. Received lots wait here for QC, then move to a rack.</li>}
                  </ul>
                ) : (
                <div className={`grid gap-1.5 ${editing ? "grid-cols-4" : "grid-cols-3"}`}>
                  {rackBins.map((l) => {
                    const st = stateOf(l.id);
                    const info = infoOf(l.id);
                    const on = l.code === sp.bin;
                    const hi = highlight.has(l.code);
                    const cls = `flex h-11 items-center justify-center rounded-lg border font-mono text-[11px] ${BIN_STYLE[st]} ${on ? "outline-[3px] outline-offset-2 outline-ink" : ""} ${hi ? "ring-[3px] ring-accent ring-offset-1" : ""}`;
                    if (!layoutRack) {
                      // Staging, and the normal view: tap a bin to open it. (Staging bins are never edited.)
                      return editing ? (
                        <span key={l.id} className={cls}>{l.code}</span>
                      ) : (
                        <Link key={l.id} href={`/stock?view=bins&bin=${l.code}${sp.item ? `&item=${sp.item}` : ""}`} scroll={false}
                          aria-label={`${l.code}, ${st === "hold" ? "QC hold" : st}${info.items.length ? `, holds ${info.items.join(", ")}` : ""}`} aria-pressed={on}
                          className={`flex min-h-[4.5rem] flex-col justify-between gap-1 rounded-lg border p-1.5 text-left ${BIN_STYLE[st]} ${on ? "outline-[3px] outline-offset-2 outline-ink" : ""} ${hi ? "ring-[3px] ring-accent ring-offset-1" : ""}`}>
                          <span className="font-mono text-[11px] font-semibold">{l.code}</span>
                          <span className="truncate text-[10px] leading-tight opacity-90">{info.items.length ? info.items.slice(0, 2).join(", ") + (info.items.length > 2 ? ` +${info.items.length - 2}` : "") : "empty"}</span>
                          <span className="flex flex-wrap gap-0.5">
                            {info.qc > 0 && <span className={`${tag} ${TAG.qc}`}>QC</span>}
                            {info.ready > 0 && <span className={`${tag} ${TAG.ready}`}>Put away</span>}
                            {info.count === "OPEN" && <span className={`${tag} ${TAG.counting}`}>Counting</span>}
                            {info.count === "SUBMITTED" && <span className={`${tag} ${TAG.approve}`}>Approve</span>}
                          </span>
                        </Link>
                      );
                    }
                    const busy = (byLoc.get(l.id)?.length ?? 0) > 0;
                    return (
                      <div key={l.id} className="group/b relative has-[details[open]]:col-span-4">
                        <Drawer label={`Rename bin ${l.code}`} tile={l.code} tileClass={cls} >
                          <Form action={renameBinAction} className="space-y-2 rounded-lg border border-border bg-canvas p-2.5">
                            <input type="hidden" name="id" value={l.id} />
                            <p className="text-xs text-ink-2">Rename bin <b className="font-mono">{l.code}</b>. Its scan code changes with it.</p>
                            <div className="flex items-end gap-2">
                              <label className="flex-1 text-xs">Bin name<input name="to" required maxLength={10} defaultValue={l.bin} className={field} /></label>
                              <button className="min-h-10 cursor-pointer rounded-lg bg-accent px-3 text-sm font-semibold text-white">Rename</button>
                            </div>
                          </Form>
                        </Drawer>
                        <Form action={removeBinAction} className="group-has-[details[open]]/b:hidden">
                          <input type="hidden" name="id" value={l.id} />
                          <RemoveButton label={`Remove bin ${l.code}`} busy={busy} why="Holds stock: move it out first" />
                        </Form>
                      </div>
                    );
                  })}
                  {layoutRack && (
                    <Drawer label={`Add a shelf and bin to rack ${rack}`} className="col-span-1 open:col-span-4"
                      tileClass={`flex h-11 items-center justify-center rounded-lg ${dotted}`} tile={<Plus size={18} aria-hidden />}>
                      <Form action={addBinAction} className="space-y-2 rounded-lg border-2 border-dashed border-accent p-2.5">
                        <input type="hidden" name="rack" value={rack} />
                        <p className="text-xs text-ink-2">New bin in rack {rack}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs">Shelf<input name="shelf" required maxLength={10} list={`shelves-${rack}`} placeholder="e.g. 03" className={field} /></label>
                          <label className="text-xs">Bin<input name="bin" required maxLength={10} placeholder="e.g. 01" className={field} /></label>
                        </div>
                        <datalist id={`shelves-${rack}`}>{shelves.map((sh) => <option key={sh} value={sh} />)}</datalist>
                        <button className="min-h-10 w-full cursor-pointer rounded-lg bg-accent text-sm font-semibold text-white">Add bin</button>
                      </Form>
                    </Drawer>
                  )}
                </div>
                )}
              </Card>
            );
          })}
          {editing && (
            <Drawer label="Add a new rack" className="open:md:col-span-2 open:xl:col-span-1"
              tileClass={`flex h-full min-h-32 flex-col items-center justify-center gap-1 rounded-[14px] ${dotted}`}
              tile={<><Plus size={26} aria-hidden /><span className="text-sm font-semibold">Add rack</span></>}>
              <Form action={addBinAction} className="space-y-2 rounded-[14px] border-2 border-dashed border-accent bg-white p-4">
                <h2 className="font-display text-sm font-bold">New rack</h2>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs">Rack<input name="rack" required maxLength={10} placeholder="e.g. D" className={field} /></label>
                  <label className="text-xs">First shelf<input name="shelf" required maxLength={10} placeholder="01" className={field} /></label>
                  <label className="text-xs">First bin<input name="bin" required maxLength={10} placeholder="01" className={field} /></label>
                </div>
                <p className="text-xs text-ink-3">A rack exists once it has a bin. Add more shelves and bins to it afterwards with its + tile.</p>
                <button className="min-h-10 w-full cursor-pointer rounded-lg bg-accent text-sm font-semibold text-white">Create rack</button>
              </Form>
            </Drawer>
          )}
        </div>

        {counting && !editing && (
          <section id="counts" className="scroll-mt-4 space-y-2 pt-2">
            <Eyebrow>STOCK COUNTS</Eyebrow>
            <CountsTab user={user} />
          </section>
        )}

        {selected && (
          <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label={`Bin ${selected.code}`}>
            <Link href={closeHref} scroll={false} aria-label="Close bin" className="absolute inset-0 bg-black/45" />
            <section className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-shell text-on-shell shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[420px] md:rounded-none">
              <div className="flex items-start justify-between gap-3 border-b border-shell-line p-4">
                <span className="flex flex-col">
                  <span className="font-mono text-[17px] font-semibold">{selected.code}</span>
                  <span className="text-xs text-on-shell-2">{selected.type === "STAGING" ? "Staging area" : `Rack ${selected.rack} · shelf ${selected.shelf} · bin ${selected.bin}`}</span>
                </span>
                <Link href={closeHref} scroll={false} aria-label="Close" className="flex size-10 items-center justify-center rounded-lg bg-shell-2"><X size={18} aria-hidden /></Link>
              </div>
              <div className="space-y-3 overflow-y-auto p-4">
                <Flash error={sp.error} ok={sp.ok} />
                {countOf.get(selected.id) && (
                  <p className="rounded-lg bg-shell-2 px-3 py-2 text-xs">
                    {countOf.get(selected.id) === "OPEN" ? "A count of this bin is in progress." : "A count of this bin is waiting for approval."} <a href="#counts" className="font-semibold underline">See Counts</a>
                  </p>
                )}
                {can(user, "stock.count") && !countOf.get(selected.id) && (
                  <Form action={startSheet}>
                    <input type="hidden" name="bin" value={selected.code} />
                    <button className="min-h-10 w-full cursor-pointer rounded-lg border border-shell-line bg-shell-2 text-[13px] font-semibold">Count this bin</button>
                  </Form>
                )}
                {canMove && canView(user, "scan") && <p className="text-xs text-on-shell-2">No signal? <Link href="/scan/transfer" className="font-semibold underline">Move stock with the offline scanner</Link>.</p>}
                {selBalances.length === 0 ? (
                  <p className="text-sm">Empty bin. Open another bin and choose this one as the destination.</p>
                ) : (
                  selBalances.map((b) => {
                    const onBox = boxed.get(`${b.lotId}:${b.locationId}`) ?? 0;
                    const max = Math.max(Number(b.qty) - onBox, 0);
                    const blocked = b.lot.qcStatus === "PENDING_QC" || b.lot.qcStatus === "REJECTED";
                    return (
                      <div key={b.id} className="space-y-2.5 rounded-[10px] bg-shell-2 p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span><Mono className="text-[13px]">{b.lot.lotNumber}</Mono> · {b.lot.item.code}</span>
                          <span><Mono>{Number(b.qty).toLocaleString()}</Mono> {b.lot.item.uom}</span>
                        </div>
                        <div className="text-xs text-on-shell-2">
                          {b.lot.item.name} · received {b.lot.receivedAt.toISOString().slice(0, 10)} · {b.lot.qcStatus.replace("_", " ")}
                        </div>
                        {b.lot.qcStatus === "PENDING_QC" && (canQc
                          ? <Link href={qcHref(b.lot.lotNumber)} className="inline-block text-xs font-semibold underline">Do QC and count for this lot →</Link>
                          : <p className="text-xs text-on-shell-2">Waiting for QC. QA counts and inspects it, then it can be put away.</p>)}
                        {onBox > 0 && <div className="text-xs text-on-shell-2">{onBox.toLocaleString()} {b.lot.item.uom} are in labelled boxes and stay here.</div>}
                        {!canMove ? null : blocked ? (
                          <p className="text-xs text-on-shell-2">This lot is {b.lot.qcStatus.replace("_", " ").toLowerCase()} and cannot be moved.</p>
                        ) : max <= 0 ? null : (
                          <MoveLotForm
                            action={transfer} lotNumber={b.lot.lotNumber} fromCode={selected.code} back={here}
                            max={max} uom={b.lot.item.uom} targets={targetsFor(selected.id)}
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  // Stock view
  const st: Status | "ALL" = sp.status === "RED" || sp.status === "YELLOW" || sp.status === "GREEN" ? sp.status : "ALL";
  const catKey = CATS.find((c) => c.key === sp.cat)?.key ?? "all";
  const cat = CATS.find((c) => c.key === catKey)!;
  const search = sp.q?.trim() || undefined;
  const q = (over: Partial<{ status: string; cat: string }>) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    const s2 = over.status ?? (st === "ALL" ? "" : st);
    const c2 = over.cat ?? (catKey === "all" ? "" : catKey);
    if (s2) p.set("status", s2);
    if (c2) p.set("cat", c2);
    const qs = p.toString();
    return `/stock${qs ? `?${qs}` : ""}`;
  };
  const inCat = rows.filter((r) => cat.match(r.category) && matches(search, r.code, r.name, r.category));
  const count = (s: Status) => inCat.filter((r) => r.status === s).length;
  const shown = inCat.filter((r) => st === "ALL" || r.status === st);

  return (
    <div className="space-y-4">
      {header}
      <Flash error={sp.error} ok={sp.ok} />
      <SearchBar q={search} scan={{ mode: "locate", title: "Scan a lot, box or bin", hint: "A bin label opens that bin; a lot tag or box label opens the bin it is in." }} placeholder="Search item code or name" keep={{ status: st === "ALL" ? undefined : st, cat: catKey === "all" ? undefined : catKey }} clearHref={q({})} />
      <Chips
        chips={[
          { href: q({ status: "" }), label: "All", n: inCat.length, active: st === "ALL" },
          ...(["RED", "YELLOW", "GREEN"] as const).map((s) => ({ href: q({ status: s }), label: STATUS[s].label, n: count(s), active: st === s })),
        ]}
      />
      <Chips chips={CATS.map((c) => ({ href: q({ cat: c.key === "all" ? "" : c.key }), label: c.label, active: c.key === catKey }))} />
      <p className="text-xs text-ink-3">{shown.length} item{shown.length === 1 ? "" : "s"} · green bar = on hand, black tick = minimum</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => {
          const bins = [...(where.get(r.itemId) ?? [])].sort();
          const s = STATUS[r.status as Status];
          return (
            <article key={r.itemId} className="space-y-2 rounded-[14px] bg-white p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Chip>{CAT_CHIP[r.category] ?? r.category}</Chip>
                  <span className="truncate font-semibold">{r.name}</span>
                </span>
                <Mono className="flex-none text-sm">{r.onHand.toLocaleString()} {r.uom}</Mono>
              </div>
              <MinMaxBar value={r.onHand} min={r.minStock} max={r.maxStock} color={s.color} />
              <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
                <span>Min {r.minStock.toLocaleString()} · ROP {r.reorderPoint.toLocaleString()} · Max {r.maxStock.toLocaleString()} {r.uom}</span>
                <span className={`font-bold ${s.fg}`}>{s.label}</span>
              </div>
              <div className="flex flex-col gap-0.5 text-xs text-ink-2">
                <span>Stored in <Mono>{bins.length ? bins.join(", ") : "—"}</Mono></span>
                {r.pendingQc > 0 && <span>Awaiting QC <Mono>{r.pendingQc.toLocaleString()}</Mono> {r.uom}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {bins.length > 0 && (
                  <Link href={`/stock?view=bins&item=${r.code}`} className="flex min-h-9 items-center rounded-[10px] border border-border bg-[#f4f3ef] px-3 text-[13px] font-semibold">
                    Show on bin map
                  </Link>
                )}
                {r.status !== "GREEN" && r.category !== "FG" && canView(user, "orders") && can(user, "po.manage") && (
                  <Link href="/orders?new=po" className={`flex min-h-9 items-center rounded-[10px] px-3 text-[13px] font-semibold ${r.status === "RED" ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn-ink"}`}>
                    {r.status === "RED" ? "Raise PO" : "Reorder"}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
        {shown.length === 0 && <Card><Badge tone="ok">All clear</Badge><p className="mt-2 text-sm text-ink-3">No items match this filter.</p></Card>}
      </div>
    </div>
  );
}
