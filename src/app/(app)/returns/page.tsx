import { db } from "@/server/db";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { returnableLots, returnMaterial } from "@/server/services/returns";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Card, Eyebrow, Mono, PageHeader } from "@/components/ui";

export const instant = false;

async function giveBack(formData: FormData) {
  "use server";
  const user = await requirePermission("material.return");
  await runAction("/returns", "Material returned to stores.", async () => {
    await returnMaterial({
      lotNumber: String(formData.get("lot") || ""), locationCode: String(formData.get("bin") || ""),
      qty: Number(formData.get("qty") || 0), note: String(formData.get("note") || ""), userId: user.id,
    });
  });
}

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireView("returns");
  const { error, ok } = await searchParams;
  const [lots, bins, recent] = await Promise.all([
    returnableLots(),
    db.location.findMany({ where: { type: "STORAGE", active: true }, orderBy: { code: "asc" } }),
    db.stockTransaction.findMany({
      where: { type: "RETURN", refType: "MACHINE_RETURN" }, orderBy: { createdAt: "desc" }, take: 10,
      include: { lot: { include: { item: true } }, location: true },
    }),
  ]);
  const binOptions = bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>);

  return (
    <CreateProvider>
      <div className="space-y-4">
        <PageHeader right={<CreateButton label="Another lot" />} eyebrow="STORE & SHOP FLOOR" title="Return to stores" subtitle="Unused material back from the machines" />
        <p className="max-w-3xl text-sm text-ink-2">
          Put leftover material back at the end of a shift. It returns to the same lot, so FIFO and traceability stay right, and the BOM variance report stops counting it as used.
        </p>
        <Flash error={error} ok={ok} />
        <CreatePanel>
          <Card className="space-y-3">
            <Eyebrow>RETURN ANOTHER LOT</Eyebrow>
            <form action={giveBack} className="grid gap-3 md:grid-cols-5">
              <label className="text-[13px]">Lot number<input name="lot" required className={inputCls} /></label>
              <label className="text-[13px]">Quantity<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
              <label className="text-[13px]">Bin<select name="bin" required className={inputCls}>{binOptions}</select></label>
              <label className="text-[13px]">Note<input name="note" className={inputCls} /></label>
              <div className="flex items-end"><button className={`${btnCls} w-full`}>Return</button></div>
            </form>
          </Card>
        </CreatePanel>

        <section className="space-y-1.5">
          <Eyebrow>OUT AT THE MACHINES</Eyebrow>
          {lots.length === 0 && <Card><p className="text-sm text-ink-3">Nothing issued in the last 14 days is still out at a machine.</p></Card>}
          <div className="grid gap-2.5 md:grid-cols-2">
            {lots.map((l) => (
              <article key={l.lotNumber} className="space-y-2 rounded-[14px] bg-white p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span><Mono className="font-semibold">{l.lotNumber}</Mono> <span className="text-sm text-ink-2">{l.itemCode} · {l.itemName}</span></span>
                  <Mono className="text-xs">{l.atMachine.toLocaleString()} {l.uom} out</Mono>
                </div>
                <form action={giveBack} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="lot" value={l.lotNumber} />
                  <label className="w-28 text-[13px]">Qty<input name="qty" type="number" step="any" min="0" max={l.atMachine} defaultValue={l.atMachine} required className={inputCls} /></label>
                  <label className="min-w-28 flex-1 text-[13px]">Bin<select name="bin" required className={inputCls}>{binOptions}</select></label>
                  <button className={btnCls}>Return</button>
                </form>
              </article>
            ))}
          </div>
        </section>

        {recent.length > 0 && (
          <section className="space-y-1.5">
            <Eyebrow>RECENT RETURNS</Eyebrow>
            <div className="overflow-hidden rounded-[14px] bg-white">
              {recent.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                  <span><Mono className="font-semibold">{t.lot.lotNumber}</Mono> <span className="text-ink-3">{t.lot.item.code} → {t.location?.code}</span></span>
                  <Mono>{Number(t.qty).toLocaleString()} {t.lot.item.uom}</Mono>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </CreateProvider>
  );
}
