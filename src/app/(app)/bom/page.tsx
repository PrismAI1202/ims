import { db } from "@/server/db";
import { requireView, requirePermission, runAction } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { DomainError } from "@/server/services/inventory";
import { importBoms, parseBomRows, type BomImportResult } from "@/server/services/bom-import";
import { MAX_UPLOAD_BYTES, readSpreadsheet } from "@/server/services/demand-import";
import { isBlend, kindForCategory, type BomLineInput } from "@/server/services/bom-math";
import { saveBom } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { BomForm } from "@/components/bom-form";
import { SidePanel } from "@/components/side-panel";
import { DownloadLink } from "@/components/download-link";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import Link from "next/link";
import { BLEND_COLORS, Badge, Card, Chip, LegendDot, Mono, PageHeader, StackedBar } from "@/components/ui";

export const instant = false;

const BOM_CATEGORIES = ["RM_RESIN", "RM_MASTERBATCH", "REGRIND", "BOP", "PACKAGING"] as const;

// Where to return when something goes wrong, so the panel stays open with the message (a form field, kept inside /bom).
const backTo = (v: FormDataEntryValue | null, fallback: string) => {
  const s = String(v ?? "");
  return s.startsWith("/bom") ? s : fallback;
};

async function save(formData: FormData) {
  "use server";
  await requirePermission("bom.manage");
  await runAction("/bom", "BOM saved.", async () => {
    // One itemId and one value per material row, in row order, however many rows the form had.
    const ids = formData.getAll("itemId").map(String), values = formData.getAll("value").map(String);
    const wanted = ids.map((itemId, i) => ({ itemId, value: Number(values[i] || 0) })).filter((r) => r.itemId);
    const items = await db.item.findMany({ where: { id: { in: wanted.map((w) => w.itemId) } } });
    const lines: BomLineInput[] = wanted.map((w) => {
      const kind = kindForCategory(items.find((i) => i.id === w.itemId)?.category ?? "");
      if (!kind) throw new DomainError("That item type can't be used in a BOM.");
      return isBlend(kind) ? { itemId: w.itemId, kind, pct: w.value } : { itemId: w.itemId, kind, qtyPerPart: w.value };
    });
    await saveBom({
      fgItemId: String(formData.get("fgItemId")), mouldId: String(formData.get("mouldId")),
      partWeightG: Number(formData.get("partWeightG")), lines,
    });
  }, backTo(formData.get("back"), "/bom?new=1"));
}

function importSummary(r: BomImportResult) {
  const parts = [`Imported ${r.created.length + r.replaced.length} BOM${r.created.length + r.replaced.length === 1 ? "" : "s"}`];
  if (r.replaced.length) parts.push(`(${r.replaced.length} replaced)`);
  let msg = parts.join(" ") + ".";
  if (r.skipped.length) msg += ` Skipped ${r.skipped.length} that already exist${r.skipped.length <= 4 ? `: ${r.skipped.join(", ")}` : ""}.`;
  if (r.newItems.length) {
    msg += ` Added ${r.newItems.length} new item${r.newItems.length === 1 ? "" : "s"} to the item master (${r.newItems.map((i) => i.code).slice(0, 6).join(", ")}${r.newItems.length > 6 ? "…" : ""}).`;
    const noLevels = r.newItems.filter((i) => !i.levelsSet).length;
    const noSupplier = r.newItems.filter((i) => i.category !== "FG" && !i.supplierSet).length;
    if (noLevels) msg += ` ${noLevels} ${noLevels === 1 ? "has" : "have"} no stock levels yet: set Min and Reorder point on the item (Masters → Items) so Stores can flag low stock.`;
    if (noSupplier) msg += ` ${noSupplier} ${noSupplier === 1 ? "has" : "have"} no supplier price: add one on the item so MRP can suggest a PO.`;
  }
  return msg;
}

async function importFile(formData: FormData) {
  "use server";
  const user = await requirePermission("bom.manage");
  let msg = "";
  await runAction("/bom", () => msg, async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose a .csv or .xlsx file first.");
    if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("File is larger than 5 MB.");
    const createMissing = formData.get("createMissing") === "on";
    if (createMissing && !can(user, "masters.manage")) throw new DomainError("Creating new parts and materials needs access to Masters. Untick that option, or ask an admin.");
    let rows;
    try {
      rows = await readSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    } catch (e) {
      throw new DomainError(e instanceof Error ? e.message : "Could not read the file.");
    }
    const parsed = parseBomRows(rows);
    msg = importSummary(await importBoms({ groups: parsed.groups, rowErrors: parsed.errors, createMissing, replaceExisting: formData.get("replaceExisting") === "on" }));
  }, "/bom?import=1");
}

export default async function BomPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; edit?: string; new?: string; import?: string; q?: string }> }) {
  const user = await requireView("bom");
  const { error, ok, edit, new: isNew, import: isImport, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const canAddItems = can(user, "masters.manage");
  const canEdit = can(user, "bom.manage");
  const [fgItems, items, moulds, boms, suppliers] = await Promise.all([
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    db.item.findMany({ where: { category: { in: [...BOM_CATEGORIES] }, active: true }, orderBy: { code: "asc" } }),
    db.mould.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.bom.findMany({
      orderBy: { createdAt: "desc" },
      include: { fgItem: true, mould: true, lines: { include: { item: true } } },
    }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const editing = edit ? boms.find((b) => b.id === edit) : undefined;

  const visible = boms.filter((b) => matches(q, b.fgItem.code, b.fgItem.name, b.mould.code, ...b.lines.flatMap((l) => [l.item.code, l.item.name])));
  const pctOf = (b: (typeof boms)[number], kind: string) => b.lines.filter((l) => l.kind === kind).reduce((a, l) => a + Number(l.pct ?? 0), 0);

  const panel = !canEdit ? null : editing ? "edit" : isNew ? "new" : isImport ? "import" : null;
  const closeHref = "/bom";

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="BOMs" subtitle={`${boms.length} BOM${boms.length === 1 ? "" : "s"} · one per finished part. Open one for planned versus actual use and alternate grades`}>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <Link href="/bom?new=1" className="flex min-h-10 items-center rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">+ New BOM</Link>}
          {canEdit && <Link href="/bom?import=1" className="flex min-h-10 items-center rounded-[10px] bg-shell-2 px-3.5 text-[13px] font-semibold text-on-shell">Import from file</Link>}
          <Link href="/bom/groups" className="flex min-h-10 items-center px-2 text-sm font-semibold">Equivalent groups →</Link>
        </div>
      </PageHeader>
      {!panel && <Flash error={error} ok={ok} />}

      {panel === "import" && (
        <SidePanel title="Import BOMs from a file" subtitle="Excel or CSV, one row per material" closeHref={closeHref}>
          <Flash error={error} />
          <Card className="space-y-4">
            <form action={importFile} className="space-y-4">
              <label className="block text-[13px] font-semibold">File (.csv or .xlsx, up to 5 MB)
                <input name="file" type="file" accept=".csv,.xlsx" required className={`${inputCls} bg-white py-2.5 file:mr-3`} />
              </label>
              <label className="flex items-start gap-2 text-[13px]">
                <input name="replaceExisting" type="checkbox" className="mt-0.5 size-5 accent-[#c2410c]" />
                <span>Replace BOMs that already exist. <span className="text-ink-3">Left unticked, a part that already has a BOM is skipped and left as it is.</span></span>
              </label>
              <label className="flex items-start gap-2 text-[13px]">
                <input name="createMissing" type="checkbox" disabled={!canAddItems} className="mt-0.5 size-5 accent-[#c2410c]" />
                <span>Create parts and materials that aren&apos;t in the system yet. <span className="text-ink-3">{canAddItems ? "They are added to the item master with the stock levels and supplier price from the file, so Stores tracks them and they can be put on a PO." : "This needs access to Masters; ask an admin."}</span></span>
              </label>
              <button className={`${btnCls} w-full md:w-auto`}>Upload &amp; import</button>
            </form>
            <p className="text-xs text-ink-3">
              Every row is checked before anything is saved; a file with any problem is rejected as a whole and each problem is listed with its row number.{" "}
              <DownloadLink href="/api/v1/bom-template">Download a template</DownloadLink>
            </p>
          </Card>
          <Card className="space-y-2 text-[13px] text-ink-2">
            <h3 className="font-display text-sm font-bold text-ink">What goes in the file</h3>
            <p><b>Required on every row:</b> <code>fg_code</code>, <code>mould_code</code>, <code>part_weight_g</code> (once per part is enough), <code>material_code</code>, and the amount: <code>pct</code> for resin, masterbatch and regrind (they must total 100%), or <code>qty_per_part</code> for inserts and packaging. Rows with the same <code>fg_code</code> make one BOM.</p>
            <p><b>To add something new</b> (with the option ticked): <code>fg_name</code> for a new part; <code>material_name</code> and <code>material_type</code> (resin, masterbatch, regrind, insert or packaging) for a new material; and optionally <code>uom</code>, <code>polymer_grade</code>, <code>max_regrind_pct</code>, <code>min_stock</code>, <code>reorder_point</code>, <code>max_stock</code>, <code>supplier_code</code> and <code>price</code>.</p>
            <p>Moulds must already exist (Maintenance → Moulds → Edit list).</p>
          </Card>
        </SidePanel>
      )}

      {(panel === "new" || panel === "edit") && (
        <SidePanel title={editing ? `Edit BOM · ${editing.fgItem.code}` : "New BOM"} subtitle={editing ? editing.fgItem.name : "One BOM per finished part; saving a part that already has one replaces it"} closeHref={closeHref}>
          <Flash error={error} />
          <Card className="space-y-3">
            <BomForm key={editing?.id ?? "new"} action={save} back={editing ? `/bom?edit=${editing.id}` : "/bom?new=1"} suppliers={suppliers.map((x) => ({ id: x.id, name: x.name }))} canAddItems={canAddItems}
              fgItems={fgItems.map((x) => ({ id: x.id, code: x.code, name: x.name }))}
              moulds={moulds.map((m) => ({ id: m.id, code: m.code, cavities: m.cavities }))}
              items={items.map((it) => ({ id: it.id, code: it.code, name: it.name, uom: it.uom, category: it.category, polymerGrade: it.polymerGrade, maxRegrindPct: it.maxRegrindPct === null ? null : Number(it.maxRegrindPct) }))}
              initial={editing ? { fgItemId: editing.fgItemId, mouldId: editing.mouldId, partWeightG: Number(editing.partWeightG), lines: editing.lines.map((l) => ({ itemId: l.itemId, value: Number(l.pct ?? l.qtyPerPart) })) } : undefined} />
          </Card>
          <p className="max-w-3xl text-xs text-ink-3">Resin + masterbatch + regrind must add up to 100% by weight, and regrind can&apos;t exceed the resin&apos;s max-regrind limit.</p>
        </SidePanel>
      )}

      {fgItems.length === 0 && (
        <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">No finished-goods items yet. Create one from New BOM (&ldquo;New part…&rdquo;), by importing a file with new parts, or in Masters → Items.</p>
      )}

      <SearchBar q={q} placeholder="Search part, mould or material" clearHref="/bom" />
      <div className="flex flex-wrap gap-3 text-xs text-ink-2">
        <LegendDot color={BLEND_COLORS.virgin} label="Virgin" /><LegendDot color={BLEND_COLORS.regrind} label="Regrind" /><LegendDot color={BLEND_COLORS.masterbatch} label="Masterbatch" />
      </div>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((b) => {
          const virgin = pctOf(b, "RESIN"), regrind = pctOf(b, "REGRIND"), mb = pctOf(b, "MASTERBATCH");
          const limit = Math.min(...b.lines.filter((l) => l.kind === "RESIN" && l.item.maxRegrindPct !== null).map((l) => Number(l.item.maxRegrindPct)), 100);
          return (
            <article key={b.id} className="relative flex flex-col gap-2.5 rounded-[14px] bg-white p-3.5 transition-shadow focus-within:ring-2 focus-within:ring-accent hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  {/* The whole card opens the BOM; Edit sits above the link so it stays its own button. */}
                  <Link href={`/bom/${b.id}`} className="font-semibold after:absolute after:inset-0 after:rounded-[14px] after:content-['']">{b.fgItem.name}</Link>
                  <span className="text-xs text-ink-3"><Mono>{b.fgItem.code}</Mono> · {b.mould.code} · {b.mould.cavities} cav · {Number(b.partWeightG)} g/part</span></span>
                {canEdit && <Link href={`/bom?edit=${b.id}`} className="relative z-10 flex min-h-9 items-center text-xs font-semibold text-accent">Edit</Link>}
              </div>
              <StackedBar parts={[
                { pct: virgin, color: BLEND_COLORS.virgin, label: `${virgin}%` },
                { pct: regrind, color: BLEND_COLORS.regrind, label: `${regrind}%` },
                { pct: mb, color: BLEND_COLORS.masterbatch, label: `${mb}%` },
              ]} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                <span>{virgin} / {regrind} / {mb} virgin · regrind · MB</span>
                {limit < 100 && <Badge tone={regrind > limit ? "danger" : "neutral"}>Max regrind {limit}%</Badge>}
              </div>
              <ul className="grid gap-1 border-t border-line pt-2 text-[13px]">
                {b.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <Chip>{l.kind === "RESIN" ? "RM" : l.kind === "MASTERBATCH" ? "MB" : l.kind === "REGRIND" ? "RG" : l.kind === "BOP" ? "BOP" : "PKG"}</Chip>
                    <span className="min-w-0 flex-1 truncate">{l.item.name}</span>
                    <Mono className="text-xs">{l.pct !== null ? `${Number(l.pct)}%` : `${Number(l.qtyPerPart)} ${l.item.uom}/part`}</Mono>
                  </li>
                ))}
              </ul>
              <span className="text-xs font-semibold text-accent">Variance and alternate grades →</span>
            </article>
          );
        })}
        {visible.length === 0 && <Card><p className="text-sm text-ink-3">{q ? `No BOMs match “${q}”.` : "No BOMs yet."}</p></Card>}
      </div>

    </div>
  );
}
