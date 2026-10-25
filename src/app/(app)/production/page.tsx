import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { bookProduction } from "@/server/services/production";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Card, Eyebrow, Mono, PageHeader } from "@/components/ui";
import { WeightInput } from "@/components/weight-input";

export const instant = false;

const LOT_ROWS = 4;
const optNum = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

async function book(formData: FormData) {
  "use server";
  const user = await requirePermission("production.book");
  let regrindSkipped = false;
  const message = () =>
    regrindSkipped
      ? "Production booked. No regrind item exists for this resin grade, so the runners were logged but not added to stock."
      : "Production booked.";
  await runAction("/production", message, async () => {
    const r = await bookProduction({
      bomId: String(formData.get("bomId")), machineId: String(formData.get("machineId")),
      shift: String(formData.get("shift")) as "A" | "B" | "C",
      shots: Number(formData.get("shots")), goodParts: Number(formData.get("goodParts")),
      rejectParts: Number(formData.get("rejectParts") || 0),
      runnerKgActual: optNum(formData.get("runnerKg")),
      regrindLocationCode: String(formData.get("regrindBin") || "") || undefined,
      note: String(formData.get("note") || "") || undefined, userId: user.id,
      // Lots that went into the machine: the link that makes a finished box traceable back to the supplier.
      materialLots: Array.from({ length: LOT_ROWS }, (_, i) => ({
        lotNumber: String(formData.get(`lot_${i}`) || "").trim(), qty: Number(formData.get(`lotqty_${i}`) || 0),
      })).filter((l) => l.lotNumber),
      requireMaterialLots: true,
    });
    regrindSkipped = r.regrindSkipped;
  });
}

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string }> }) {
  await requirePermission("production.book");
  const { error, ok, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const [boms, machines, bins, recent] = await Promise.all([
    db.bom.findMany({ include: { fgItem: true, mould: true }, orderBy: { fgItem: { code: "asc" } } }),
    db.machine.findMany({ orderBy: { code: "asc" } }),
    db.location.findMany({ where: { type: "STORAGE" }, orderBy: { code: "asc" } }),
    db.productionBooking.findMany({
      orderBy: { producedAt: "desc" }, take: 100,
      include: { bom: { include: { fgItem: true } }, machine: true },
    }),
  ]);

  return (
    <CreateProvider>
    <div className="space-y-4">
      <PageHeader right={boms.length > 0 ? <CreateButton label="Book production" /> : undefined} eyebrow="STORE & SHOP FLOOR" title="Production" subtitle="Book output per shift, with the material lots that went into the machine" />
      <Flash error={error} ok={ok} />
      {boms.length === 0 ? (
        <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">No BOMs defined yet. Ask an admin to add one under BOMs.</p>
      ) : (
        <CreatePanel><Card>
          <form action={book} className="grid gap-3 md:grid-cols-4">
            <label className="text-[13px] md:col-span-2">Part / BOM
              <select name="bomId" required className={inputCls}>
                {boms.map((b) => <option key={b.id} value={b.id}>{b.fgItem.code} · {b.mould.code} ({b.mould.cavities} cav)</option>)}
              </select>
            </label>
            <label className="text-[13px]">Machine
              <select name="machineId" required className={inputCls}>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select>
            </label>
            <label className="text-[13px]">Shift
              <select name="shift" className={inputCls}><option>A</option><option>B</option><option>C</option></select>
            </label>
            <label className="text-[13px]">Shots (counter)<input name="shots" type="number" min="1" step="1" required className={inputCls} /></label>
            <label className="text-[13px]">Good parts<input name="goodParts" type="number" min="0" step="1" required className={inputCls} /></label>
            <label className="text-[13px]">Rejected parts<input name="rejectParts" type="number" min="0" step="1" defaultValue={0} className={inputCls} /></label>
            <div className="text-[13px]"><div>Runner/sprue weighed (kg)</div>
              <WeightInput name="runnerKg" placeholder="auto from mould" className={inputCls} />
            </div>
            <label className="text-[13px]">Regrind bin
              <select name="regrindBin" className={inputCls}><option value="">First storage bin</option>{bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}</select>
            </label>
            <div className="space-y-2 md:col-span-4">
              <div className="text-[13px] font-semibold">Material lots used <span className="font-normal text-ink-3">(scan the lot tag of every resin and masterbatch fed to the machine; add regrind lots if used)</span></div>
              {Array.from({ length: LOT_ROWS }, (_, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-4">
                  <input name={`lot_${i}`} placeholder="Lot tag, e.g. LOT-261014-0001" autoComplete="off" className={`${inputCls} md:col-span-3`} aria-label={`Material lot ${i + 1}`} />
                  <input name={`lotqty_${i}`} type="number" min="0" step="any" placeholder="Quantity used" className={inputCls} aria-label={`Quantity used ${i + 1}`} />
                </div>
              ))}
            </div>
            <label className="text-[13px] md:col-span-3">Note<input name="note" className={inputCls} /></label>
            <div className="md:col-span-4"><button className={`${btnCls} w-full md:w-auto`}>Book production</button></div>
          </form>
        </Card></CreatePanel>
      )}

      <Eyebrow>RECENT BOOKINGS</Eyebrow>
      <SearchBar q={q} placeholder="Search booking, part or machine" clearHref="/production" />
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {recent.filter((b) => matches(q, b.bookingNumber, b.bom.fgItem.code, b.bom.fgItem.name, b.machine.code, `shift ${b.shift}`)).map((b) => {
          const total = b.goodParts + b.rejectParts;
          const rej = total ? (b.rejectParts / total) * 100 : 0;
          return (
            <article key={b.id} className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col"><Mono className="text-[13px] font-semibold">{b.bookingNumber}</Mono><span className="text-sm">{b.bom.fgItem.code} · {b.machine.code} / shift {b.shift}</span></span>
                <span className="text-xs text-ink-3">{b.producedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              </div>
              <div aria-hidden className="flex h-2.5 overflow-hidden rounded-[5px] bg-canvas">
                <span className="bg-ok" style={{ width: `${100 - rej}%` }} /><span className="bg-danger" style={{ width: `${rej}%` }} />
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-2">
                <span>Good <Mono>{b.goodParts.toLocaleString()}</Mono></span>
                <span className={rej > 5 ? "font-semibold text-danger" : ""}>Rejects <Mono>{b.rejectParts.toLocaleString()}</Mono> ({rej.toFixed(1)}%)</span>
                <span>Shots <Mono>{b.shots.toLocaleString()}</Mono></span>
                <span>Runner <Mono>{Number(b.runnerKg)}</Mono> kg</span>
              </div>
            </article>
          );
        })}
        {recent.length === 0 && <Card><p className="text-sm text-ink-3">No production booked yet.</p></Card>}
      </div>
    </div>
    </CreateProvider>
  );
}
