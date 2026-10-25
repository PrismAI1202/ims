import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { DomainError } from "@/server/services/inventory";
import { isBlend, kindForCategory, type BomLineInput } from "@/server/services/bom-math";
import { saveBom } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";
import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { BLEND_COLORS, Badge, Card, Chip, Eyebrow, LegendDot, Mono, PageHeader, StackedBar } from "@/components/ui";

export const instant = false;

const ROWS = 8;
const BOM_CATEGORIES = ["RM_RESIN", "RM_MASTERBATCH", "REGRIND", "BOP", "PACKAGING"] as const;
const GROUP_LABEL: Record<string, string> = {
  RM_RESIN: "Resin (% by weight)", RM_MASTERBATCH: "Masterbatch (% by weight)", REGRIND: "Regrind (% by weight)",
  BOP: "Inserts / bought-out (qty per part)", PACKAGING: "Packaging (qty per good part)",
};

async function save(formData: FormData) {
  "use server";
  await requirePermission("bom.manage");
  await runAction("/bom", "BOM saved.", async () => {
    const wanted = Array.from({ length: ROWS }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), value: Number(formData.get(`value_${i}`) || 0),
    })).filter((r) => r.itemId);
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
  }, "/bom");
}

export default async function BomPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; edit?: string }> }) {
  await requirePermission("bom.manage");
  const { error, ok, edit } = await searchParams;
  const [fgItems, items, moulds, boms] = await Promise.all([
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    db.item.findMany({ where: { category: { in: [...BOM_CATEGORIES] }, active: true }, orderBy: { code: "asc" } }),
    db.mould.findMany({ orderBy: { code: "asc" } }),
    db.bom.findMany({
      orderBy: { createdAt: "desc" },
      include: { fgItem: true, mould: true, lines: { include: { item: true } } },
    }),
  ]);
  const editing = edit ? boms.find((b) => b.id === edit) : undefined;
  const byCat = (c: string) => items.filter((i) => i.category === c);

  const pctOf = (b: (typeof boms)[number], kind: string) => b.lines.filter((l) => l.kind === kind).reduce((a, l) => a + Number(l.pct ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="BOMs" subtitle={`${boms.length} BOM${boms.length === 1 ? "" : "s"} · one per finished part`}>
        <Link href="/equivalents" className="text-sm font-semibold">Equivalent groups →</Link>
      </PageHeader>
      <Flash error={error} ok={ok} />
      <NewPanel label="New BOM" defaultOpen={!!editing}>
        <Card className="space-y-3">
          <Eyebrow>{editing ? `EDIT BOM · ${editing.fgItem.code}` : "NEW BOM"}</Eyebrow>
          <form key={editing?.id ?? "new"} action={save} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-[13px]">Finished part
                <select name="fgItemId" required defaultValue={editing?.fgItemId} className={inputCls}>
                  {fgItems.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
                </select>
              </label>
              <label className="text-[13px]">Mould
                <select name="mouldId" required defaultValue={editing?.mouldId} className={inputCls}>
                  {moulds.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.cavities}-cavity</option>)}
                </select>
              </label>
              <label className="text-[13px]">Net part weight (g)
                <input name="partWeightG" type="number" step="any" min="0" required defaultValue={editing ? Number(editing.partWeightG) : undefined} className={inputCls} />
              </label>
            </div>
            <div className="space-y-2">
              <div className="text-[13px] font-semibold">Materials <span className="font-normal text-ink-3">(% for resin, masterbatch and regrind; quantity per part for inserts and packaging)</span></div>
              {Array.from({ length: ROWS }, (_, i) => {
                const l = editing?.lines[i];
                const v = l ? Number(l.pct ?? l.qtyPerPart) : undefined;
                return (
                  <div key={i} className="grid gap-2 md:grid-cols-4">
                    <select name={`item_${i}`} defaultValue={l?.itemId ?? ""} className={`${inputCls} md:col-span-3`} aria-label={`Material ${i + 1}`}>
                      <option value="">— none —</option>
                      {BOM_CATEGORIES.map((c) => (
                        <optgroup key={c} label={GROUP_LABEL[c]}>
                          {byCat(c).map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <input name={`value_${i}`} type="number" step="any" min="0" defaultValue={v} placeholder="% or qty" className={inputCls} aria-label={`Value ${i + 1}`} />
                  </div>
                );
              })}
            </div>
            <button className={`${btnCls} w-full disabled:opacity-50 md:w-auto`} disabled={fgItems.length === 0}>Save BOM</button>
          </form>
        </Card>
      </NewPanel>
      <p className="max-w-3xl text-sm text-ink-2">
        Resin + masterbatch + regrind must add up to 100% by weight, and regrind can&apos;t exceed the resin&apos;s max-regrind limit.
        Saving a part that already has a BOM replaces it.
      </p>
      {fgItems.length === 0 && (
        <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">No finished-goods items yet. Add one in Masters → Items with category FG.</p>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-ink-2">
        <LegendDot color={BLEND_COLORS.virgin} label="Virgin" /><LegendDot color={BLEND_COLORS.regrind} label="Regrind" /><LegendDot color={BLEND_COLORS.masterbatch} label="Masterbatch" />
      </div>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {boms.map((b) => {
          const virgin = pctOf(b, "RESIN"), regrind = pctOf(b, "REGRIND"), mb = pctOf(b, "MASTERBATCH");
          const limit = Math.min(...b.lines.filter((l) => l.kind === "RESIN" && l.item.maxRegrindPct !== null).map((l) => Number(l.item.maxRegrindPct)), 100);
          return (
            <article key={b.id} className="flex flex-col gap-2.5 rounded-[14px] bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col"><span className="font-semibold">{b.fgItem.name}</span>
                  <span className="text-xs text-ink-3"><Mono>{b.fgItem.code}</Mono> · {b.mould.code} · {b.mould.cavities} cav · {Number(b.partWeightG)} g/part</span></span>
                <Link href={`/bom?edit=${b.id}`} className="min-h-9 text-xs font-semibold text-accent">Edit</Link>
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
            </article>
          );
        })}
        {boms.length === 0 && <Card><p className="text-sm text-ink-3">No BOMs yet.</p></Card>}
      </div>

    </div>
  );
}
