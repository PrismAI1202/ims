import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { completePm, logRepair, machineReliability, mouldHistory, mouldRows, PM_CHECKS, updateMouldSettings, type MouldMaint } from "@/server/services/maintenance";
import { uploadFrom } from "@/server/upload-form";
import { btnCls, btnOkCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { SearchBar } from "@/components/search-bar";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader, SegmentedTabs } from "@/components/ui";
import { matches } from "@/lib/url";

export const instant = false;

async function completeAction(formData: FormData) {
  "use server";
  const user = await requirePermission("maintenance.manage");
  const id = String(formData.get("mouldId"));
  await runAction(`/maintenance?id=${id}`, "PM recorded. The PM counter was reset.", async () => {
    await completePm({ mouldId: id, checks: formData.getAll("check").map(String), photoRef: await uploadFrom(formData, "photo"), note: String(formData.get("note") || ""), userId: user.id });
  });
}

async function repairAction(formData: FormData) {
  "use server";
  const user = await requirePermission("maintenance.manage");
  const id = String(formData.get("mouldId"));
  await runAction(`/maintenance?id=${id}`, "Logged.", async () => {
    const mins = String(formData.get("downtimeMin") || "");
    await logRepair({
      mouldId: id, kind: String(formData.get("kind")) === "TRIAL" ? "TRIAL" : "REPAIR", summary: String(formData.get("summary") || ""),
      downtimeMin: mins === "" ? undefined : Number(mins), photoRef: await uploadFrom(formData, "photo"), note: String(formData.get("note") || ""), userId: user.id,
    });
  });
}

async function settingsAction(formData: FormData) {
  "use server";
  await requirePermission("maintenance.manage");
  const id = String(formData.get("mouldId"));
  const opt = (k: string) => { const v = String(formData.get(k) || "").trim(); return v === "" ? null : Number(v); };
  await runAction(`/maintenance?id=${id}`, "Mould settings saved.", async () => {
    await updateMouldSettings({
      mouldId: id, idealCycleSec: opt("idealCycleSec"), minTonnage: opt("minTonnage"),
      pmIntervalShots: Number(formData.get("pmIntervalShots")), lifeShots: Number(formData.get("lifeShots")), openingShots: Number(formData.get("openingShots") || 0),
    });
  });
}

const STATE = {
  OK: { t: "OK", tone: "ok" as const, color: "#1E7A46" },
  DUE_SOON: { t: "PM due soon", tone: "warn" as const, color: "#E0A526" },
  OVERDUE: { t: "Overdue", tone: "danger" as const, color: "#B42318" },
};
const fmt = (n: number) => Math.abs(n).toLocaleString("en-US");
const pmText = (m: MouldMaint) => (m.left <= 0 ? `${fmt(m.left)} over` : `${fmt(m.left)} shots`);

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; tab?: string; id?: string; q?: string }> }) {
  const user = await requirePermission("stock.view");
  const { error, ok, tab, id, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const manage = can(user.role, "maintenance.manage");
  const moulds = await mouldRows();
  const sel = id ? moulds.find((m) => m.id === id) : undefined;

  if (sel) {
    const [history, mould] = await Promise.all([mouldHistory(sel.id), db.mould.findUniqueOrThrow({ where: { id: sel.id } })]);
    const s = STATE[sel.state];
    return (
      <CreateProvider>
        <div className="space-y-4">
          <PageHeader eyebrow="TOOL ROOM" title={`${sel.code} · mould`} right={manage ? <CreateButton label="Log repair" /> : undefined}>
            <Link href="/maintenance" className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> All moulds</Link>
          </PageHeader>
          <Flash error={error} ok={ok} />
          <CreatePanel>
            <Card className="space-y-3">
              <Eyebrow>LOG A REPAIR OR TRIAL</Eyebrow>
              <form action={repairAction} className="grid gap-3 md:grid-cols-4">
                <input type="hidden" name="mouldId" value={sel.id} />
                <label className="text-[13px]">Type<select name="kind" className={inputCls}><option value="REPAIR">Repair</option><option value="TRIAL">Trial</option></select></label>
                <label className="text-[13px] md:col-span-2">What was done<input name="summary" required placeholder="e.g. Cavity 3 flash, parting line polished" className={inputCls} /></label>
                <label className="text-[13px]">Downtime (min)<input name="downtimeMin" type="number" min="0" step="1" className={inputCls} /></label>
                <label className="text-[13px] md:col-span-2">Photo (optional)<input name="photo" type="file" accept="image/*,application/pdf" capture="environment" className={`${inputCls} py-2.5 text-xs`} /></label>
                <label className="text-[13px] md:col-span-2">Note<input name="note" className={inputCls} /></label>
                <div className="md:col-span-4"><button className={`${btnCls} w-full md:w-auto`}>Save</button></div>
              </form>
            </Card>
          </CreatePanel>

          <Card className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">{sel.parts.join(", ") || sel.name} · {sel.cavities} cav{sel.machineCode ? ` · on ${sel.machineCode}` : ""}</span><Badge tone={s.tone}>{s.t}</Badge></div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{fmt(sel.shots)}</strong>Shot counter</span>
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{fmt(sel.lastPm)}</strong>Last PM at</span>
              <span className="flex flex-col"><strong className="font-mono text-[15px] font-medium text-ink">{pmText(sel)}</strong>To next PM</span>
            </div>
            <div aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px]" style={{ width: `${sel.usedPct}%`, background: s.color }} /></div>
            <span className="text-xs text-ink-3">Life used {sel.lifePct}% of {fmt(sel.life)} shots · PM every {fmt(sel.interval)} shots</span>
          </Card>

          {manage && (
            <Card>
              <form action={completeAction} className="space-y-2">
                <input type="hidden" name="mouldId" value={sel.id} />
                <Eyebrow>PM CHECKLIST · EVERY {fmt(sel.interval)} SHOTS</Eyebrow>
                {PM_CHECKS.map((c) => (
                  <label key={c} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" name="check" value={c} className="size-6 accent-[#1e7a46]" />{c}</label>
                ))}
                <label className="block text-[13px]">After-PM photo (required)
                  <input name="photo" type="file" accept="image/*,application/pdf" capture="environment" required className={`${inputCls} py-2.5 text-xs`} />
                </label>
                <label className="block text-[13px]">Note<input name="note" className={inputCls} /></label>
                <button className={`${btnOkCls} w-full`}>Complete PM · reset counter</button>
              </form>
            </Card>
          )}

          {manage && (
            <details className="rounded-[14px] bg-white p-4">
              <summary className="min-h-9 cursor-pointer text-sm font-semibold text-accent">Mould settings · cycle time, press size, PM plan</summary>
              <form action={settingsAction} className="mt-3 grid gap-3 md:grid-cols-5">
                <input type="hidden" name="mouldId" value={sel.id} />
                <label className="text-[13px]">Standard cycle (s)<input name="idealCycleSec" type="number" step="any" min="0" defaultValue={mould.idealCycleSec === null ? "" : Number(mould.idealCycleSec)} className={inputCls} /></label>
                <label className="text-[13px]">Min press (T)<input name="minTonnage" type="number" min="1" step="1" defaultValue={mould.minTonnage ?? ""} className={inputCls} /></label>
                <label className="text-[13px]">PM every (shots)<input name="pmIntervalShots" type="number" min="1000" step="1" required defaultValue={mould.pmIntervalShots} className={inputCls} /></label>
                <label className="text-[13px]">Life (shots)<input name="lifeShots" type="number" min="1000" step="1" required defaultValue={mould.lifeShots} className={inputCls} /></label>
                <label className="text-[13px]">Counter at go-live<input name="openingShots" type="number" min="0" step="1" required defaultValue={mould.openingShots} className={inputCls} /></label>
                <div className="md:col-span-5"><button className={`${btnCls} w-full md:w-auto`}>Save settings</button></div>
                <p className="text-xs text-ink-3 md:col-span-5">The standard cycle time is what lets Metrics measure performance. Booked shots are added to the go-live counter automatically.</p>
              </form>
            </details>
          )}

          <h2 className="font-display text-[15px] font-bold text-ink-3">Repair &amp; PM history</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {history.map((h, i) => (
              <div key={i} className="flex flex-col gap-0.5 rounded-xl bg-white px-3.5 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-xs text-ink-3"><span>{h.when.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span><Badge tone={h.kind === "Repair" ? "warn" : h.kind === "PM" ? "ok" : "info"}>{h.kind}</Badge></span>
                <span className="font-semibold">{h.what}</span>{h.note && <span className="text-xs text-ink-3">{h.note}</span>}
              </div>
            ))}
            {history.length === 0 && <Card><p className="text-sm text-ink-3">No repairs or PMs recorded yet.</p></Card>}
          </div>
        </div>
      </CreateProvider>
    );
  }

  const tabKey = tab === "machines" ? "machines" : "moulds";
  const rel = tabKey === "machines" ? await machineReliability(30) : [];
  const visible = moulds.filter((m) => matches(q, m.code, m.name, m.machineCode, ...m.parts));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="TOOL ROOM" title="Maintenance" subtitle={`${moulds.filter((m) => m.state === "OVERDUE").length} overdue · ${moulds.filter((m) => m.state === "DUE_SOON").length} due soon`}>
        <SegmentedTabs tabs={[{ href: "/maintenance", label: "Moulds", active: tabKey === "moulds" }, { href: "/maintenance?tab=machines", label: "Machines", active: tabKey === "machines" }]} />
      </PageHeader>
      <Flash error={error} ok={ok} />

      {tabKey === "moulds" && (
        <>
          <SearchBar q={q} placeholder="Search mould, part or machine" clearHref="/maintenance" />
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((m) => {
              const s = STATE[m.state];
              return (
                <Link key={m.id} href={`/maintenance?id=${m.id}`} className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5">
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex flex-col"><Mono className="text-sm font-semibold">{m.code}</Mono><span className="text-xs text-ink-3">{m.parts.join(", ") || m.name}{m.machineCode ? ` · on ${m.machineCode}` : ""}</span></span>
                    <Badge tone={s.tone}>{s.t}</Badge>
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="flex justify-between text-xs"><span className="text-ink-3">To next PM</span><Mono>{pmText(m)}</Mono></span>
                    <span aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px]" style={{ width: `${m.usedPct}%`, background: s.color }} /></span>
                  </span>
                  <span className="flex justify-between text-[11px] text-ink-3"><span>Life used {m.lifePct}%</span><span>{fmt(m.shots)} shots</span></span>
                </Link>
              );
            })}
            {visible.length === 0 && <Card><p className="text-sm text-ink-3">{q ? `No moulds match “${q}”.` : "No moulds yet. Add them in Masters."}</p></Card>}
          </div>
        </>
      )}

      {tabKey === "machines" && (
        <>
          <p className="text-xs text-ink-3">Last 30 days · MTBF = run hours ÷ breakdowns · MTTR = repair minutes ÷ breakdowns. Log stops under <Link href="/production" className="font-semibold text-accent">Production → Log downtime</Link>.</p>
          <DataTable>
            <thead><tr><th>Machine</th><th>Breakdowns</th><th>MTBF</th><th>MTTR</th><th>Next PM</th></tr></thead>
            <tbody>
              {rel.map((m) => (
                <tr key={m.machineId}>
                  <td><Mono className="font-semibold">{m.code}</Mono></td><td><Mono>{m.breakdowns}</Mono></td>
                  <td><Mono>{m.mtbfHours === null ? "—" : `${m.mtbfHours} h`}</Mono></td>
                  <td className={m.mttrMin !== null && m.mttrMin > 60 ? "text-danger" : ""}><Mono>{m.mttrMin === null ? "—" : `${m.mttrMin} min`}</Mono></td>
                  <td>{m.nextPm}</td>
                </tr>
              ))}
              {rel.length === 0 && <tr><td className="text-ink-3" colSpan={5}>No machines yet.</td></tr>}
            </tbody>
          </DataTable>
        </>
      )}
    </div>
  );
}
