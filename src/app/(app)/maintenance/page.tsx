import Link from "next/link";
import { Check, ChevronLeft, Pencil, Plus } from "lucide-react";
import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { requireView, requirePermission, runAction } from "@/server/auth/guard";
import { completePm, logRepair, machineReliability, mouldHistory, mouldRows, PM_CHECKS, updateMouldSettings, type MouldMaint } from "@/server/services/maintenance";
import { uploadFrom } from "@/server/upload-form";
import { btnCls, btnOkCls, Flash, inputCls } from "@/components/flash";
import { createMachine, createMould, reactivateEquipment, removeMachine, removeMould, updateMachine, updateMould } from "@/server/services/masters";
import { Drawer, dotted, field, RemoveButton } from "@/components/edit-mode";
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

// Machines and moulds used to be added under Masters. Each action re-checks the permission itself.
const rawOf = (f: FormData) => Object.fromEntries(f.entries());
const backOf = (tab: string) => `/maintenance?tab=${tab}&edit=1`;

async function addMachineAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  await runAction(backOf("machines"), "Machine added.", async () => { await createMachine(rawOf(f)); });
}
async function saveMachineAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  await runAction(backOf("machines"), "Machine updated.", async () => { await updateMachine(String(f.get("id")), rawOf(f)); });
}
async function removeMachineAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  let msg = "";
  await runAction(backOf("machines"), () => msg, async () => {
    msg = (await removeMachine(String(f.get("id")))) === "deleted" ? "Machine deleted." : "Machine has production history, so it was retired instead. Its moulds are free to fit elsewhere. Reactivate it any time.";
  });
}
async function addMouldAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  await runAction(backOf("moulds"), "Mould added. Set its cycle time and PM plan on its page.", async () => { await createMould(rawOf(f)); });
}
async function saveMouldAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  await runAction(backOf("moulds"), "Mould updated.", async () => { await updateMould(String(f.get("id")), rawOf(f)); });
}
async function removeMouldAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  let msg = "";
  await runAction(backOf("moulds"), () => msg, async () => {
    msg = (await removeMould(String(f.get("id")))) === "deleted" ? "Mould deleted." : "Mould has PM, repair or plan history, so it was retired instead. Reactivate it any time.";
  });
}
async function reactivateAction(f: FormData) {
  "use server";
  await requirePermission("equipment.manage");
  const kind = f.get("kind") === "machine" ? "machine" : "mould";
  await runAction(backOf(kind === "machine" ? "machines" : "moulds"), "Back in service.", async () => { await reactivateEquipment(kind, String(f.get("id"))); });
}

const STATE = {
  OK: { t: "OK", tone: "ok" as const, color: "#1E7A46" },
  DUE_SOON: { t: "PM due soon", tone: "warn" as const, color: "#E0A526" },
  OVERDUE: { t: "Overdue", tone: "danger" as const, color: "#B42318" },
};
const fmt = (n: number) => Math.abs(n).toLocaleString("en-US");
const pmText = (m: MouldMaint) => (m.left <= 0 ? `${fmt(m.left)} over` : `${fmt(m.left)} shots`);

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; tab?: string; id?: string; q?: string; edit?: string }> }) {
  const user = await requireView("maintenance");
  const { error, ok, tab, id, q: rawQ, edit } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const manage = can(user, "maintenance.manage");
  const canEdit = can(user, "equipment.manage");
  const editing = canEdit && edit === "1" && !id;
  const moulds = await mouldRows(undefined, { includeRetired: editing });
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
  const [rel, machines, rawMoulds] = await Promise.all([
    machineReliability(30),
    db.machine.findMany({ where: editing ? {} : { active: true }, orderBy: { code: "asc" }, include: { moulds: { where: { active: true }, select: { code: true } } } }),
    db.mould.findMany({ select: { id: true, name: true, shotWeightG: true, runnerWeightG: true, machineId: true, active: true } }),
  ]);
  const relOf = new Map(rel.map((r) => [r.machineId, r]));
  const rawMould = new Map(rawMoulds.map((m) => [m.id, m]));
  const activeMachines = machines.filter((m) => m.active);
  const visible = moulds.filter((m) => matches(q, m.code, m.name, m.machineCode, ...m.parts));
  const shownMachines = machines.filter((m) => matches(q, m.code, m.name, ...m.moulds.map((x) => x.code)));
  const tabHref = (t: string) => `/maintenance?tab=${t}${editing ? "&edit=1" : ""}`;
  const toggle = `/maintenance?tab=${tabKey}${editing ? "" : "&edit=1"}`;

  const mouldCard = (m: MouldMaint) => {
    const s = STATE[m.state];
    return (
      <>
        <span className="flex items-start justify-between gap-2">
          <span className="flex flex-col"><Mono className="text-sm font-semibold">{m.code}</Mono><span className="text-xs text-ink-3">{m.parts.join(", ") || m.name}{m.machineCode ? ` · on ${m.machineCode}` : ""} · {m.cavities} cav</span></span>
          <Badge tone={s.tone}>{s.t}</Badge>
        </span>
        <span className="flex flex-col gap-1">
          <span className="flex justify-between text-xs"><span className="text-ink-3">To next PM</span><Mono>{pmText(m)}</Mono></span>
          <span aria-hidden className="h-2.5 rounded-[5px] bg-canvas"><span className="block h-2.5 rounded-[5px]" style={{ width: `${m.usedPct}%`, background: s.color }} /></span>
        </span>
        <span className="flex justify-between text-[11px] text-ink-3"><span>Life used {m.lifePct}%</span><span>{fmt(m.shots)} shots</span></span>
      </>
    );
  };
  const cardCls = "flex flex-col gap-2 rounded-[14px] bg-white p-3.5 text-left";
  const mouldFields = (m?: { name: string; cavities: number; shotWeightG: number | null; runnerWeightG: number | null; machineId: string | null }) => (
    <>
      <label className="text-xs sm:col-span-2">Name<input name="name" required defaultValue={m?.name} className={field} /></label>
      <label className="text-xs">Cavities<input name="cavities" type="number" min="1" max="256" required defaultValue={m?.cavities ?? 1} className={field} /></label>
      <label className="text-xs">Shot weight (g)<input name="shotWeightG" type="number" step="any" min="0" defaultValue={m?.shotWeightG ?? ""} className={field} /></label>
      <label className="text-xs">Runner weight (g)<input name="runnerWeightG" type="number" step="any" min="0" defaultValue={m?.runnerWeightG ?? ""} className={field} /></label>
      <label className="text-xs">On machine
        <select name="machineId" defaultValue={m?.machineId ?? ""} className={field}><option value="">Not fitted</option>{activeMachines.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select>
      </label>
    </>
  );
  const retired = (on: boolean) => (on ? "" : "opacity-70");

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="TOOL ROOM" title="Maintenance" subtitle={`${moulds.filter((m) => m.state === "OVERDUE").length} overdue · ${moulds.filter((m) => m.state === "DUE_SOON").length} due soon`}
        right={canEdit ? (
          <Link href={toggle} aria-pressed={editing} className={`flex min-h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold ${editing ? "bg-on-shell text-ink" : "bg-shell-2 text-on-shell"}`}>
            {editing ? <><Check size={15} aria-hidden /> Done</> : <><Pencil size={15} aria-hidden /> Edit list</>}
          </Link>
        ) : undefined}>
        <SegmentedTabs tabs={[{ href: tabHref("moulds"), label: "Moulds", active: tabKey === "moulds" }, { href: tabHref("machines"), label: "Machines", active: tabKey === "machines" }]} />
      </PageHeader>
      <Flash error={error} ok={ok} />
      {editing && (
        <p className="rounded-xl bg-info-bg px-3.5 py-2.5 text-[13px] text-info-ink">
          Editing the list. Tap a {tabKey === "moulds" ? "mould" : "machine"} to change its details, or the dotted box to add one. The red <b>−</b> deletes one that was never used, or retires one with history (it leaves the pickers but its records stay). It is greyed out while the {tabKey === "moulds" ? "mould is on a BOM or has upcoming plan days" : "machine has upcoming plan days"}.
        </p>
      )}

      {tabKey === "moulds" && (
        <>
          <SearchBar q={q} placeholder="Search mould, part or machine" keep={{ edit: editing ? "1" : undefined }} clearHref={`/maintenance${editing ? "?edit=1" : ""}`} />
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((m) => {
              const raw = rawMould.get(m.id);
              if (!editing) return <Link key={m.id} href={`/maintenance?id=${m.id}`} className={cardCls}>{mouldCard(m)}</Link>;
              const locked = m.parts.length > 0 ? `Used by the BOM for ${m.parts.slice(0, 3).join(", ")}: move it to another mould first` : "";
              return (
                <div key={m.id} className={`group/p relative has-[details[open]]:col-span-full ${retired(raw?.active ?? true)}`}>
                  <Drawer label={`Edit mould ${m.code}`} tile={<>{mouldCard(m)}{raw && !raw.active && <Badge tone="neutral">Retired</Badge>}</>} tileClass={`${cardCls} cursor-pointer ring-1 ring-transparent hover:ring-accent`}>
                    <form action={saveMouldAction} className="grid gap-3 rounded-[14px] border border-border bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                      <input type="hidden" name="id" value={m.id} /><input type="hidden" name="code" value={m.code} />
                      <p className="text-[13px] font-semibold sm:col-span-2 lg:col-span-4">{m.code} <span className="font-normal text-ink-3">· code can&apos;t be changed · cycle time and PM plan are on its own page</span></p>
                      {mouldFields(raw && { name: raw.name, cavities: m.cavities, shotWeightG: raw.shotWeightG === null ? null : Number(raw.shotWeightG), runnerWeightG: raw.runnerWeightG === null ? null : Number(raw.runnerWeightG), machineId: raw.machineId })}
                      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
                        <button className={btnCls}>Save</button>
                        {raw && !raw.active && <button formAction={reactivateAction} formNoValidate name="kind" value="mould" className="min-h-12 cursor-pointer text-sm font-semibold text-accent">Put back in service</button>}
                      </div>
                    </form>
                  </Drawer>
                  {(raw?.active ?? true) && (
                    <form action={removeMouldAction} className="group-has-[details[open]]/p:hidden">
                      <input type="hidden" name="id" value={m.id} />
                      <RemoveButton label={`Remove mould ${m.code}`} busy={!!locked} why={locked} />
                    </form>
                  )}
                </div>
              );
            })}
            {editing && (
              <Drawer label="Add a mould" className="open:col-span-full" tileClass={`flex min-h-32 flex-col items-center justify-center gap-1 rounded-[14px] ${dotted}`} tile={<><Plus size={26} aria-hidden /><span className="text-sm font-semibold">Add mould</span></>}>
                <form action={addMouldAction} className="grid gap-3 rounded-[14px] border-2 border-dashed border-accent bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <p className="text-[13px] font-semibold sm:col-span-2 lg:col-span-4">New mould</p>
                  <label className="text-xs">Code<input name="code" required maxLength={30} placeholder="e.g. MLD-2001" className={field} /></label>
                  {mouldFields()}
                  <div className="sm:col-span-2 lg:col-span-4"><button className={btnCls}>Create mould</button></div>
                </form>
              </Drawer>
            )}
            {visible.length === 0 && !editing && <Card><p className="text-sm text-ink-3">{q ? `No moulds match “${q}”.` : canEdit ? "No moulds yet. Use Edit list to add one." : "No moulds yet. Ask an admin to add them."}</p></Card>}
          </div>
        </>
      )}

      {tabKey === "machines" && (
        <>
          <p className="text-xs text-ink-3">Last 30 days · MTBF = run hours ÷ breakdowns · MTTR = repair minutes ÷ breakdowns. Log stops under <Link href="/production" className="font-semibold text-accent">Production → Log downtime</Link>.</p>
          {!editing ? (
            <DataTable>
              <thead><tr><th>Machine</th><th>Press</th><th>Moulds fitted</th><th>Breakdowns</th><th>MTBF</th><th>MTTR</th><th>Next PM</th></tr></thead>
              <tbody>
                {shownMachines.map((m) => {
                  const r = relOf.get(m.id);
                  return (
                    <tr key={m.id}>
                      <td><Mono className="font-semibold">{m.code}</Mono><span className="block text-xs text-ink-3">{m.name}</span></td>
                      <td>{m.tonnage ? `${m.tonnage} T` : "—"}</td><td className="text-xs">{m.moulds.map((x) => x.code).join(", ") || "—"}</td>
                      <td><Mono>{r?.breakdowns ?? 0}</Mono></td>
                      <td><Mono>{!r || r.mtbfHours === null ? "—" : `${r.mtbfHours} h`}</Mono></td>
                      <td className={r && r.mttrMin !== null && r.mttrMin > 60 ? "text-danger" : ""}><Mono>{!r || r.mttrMin === null ? "—" : `${r.mttrMin} min`}</Mono></td>
                      <td>{r?.nextPm ?? "—"}</td>
                    </tr>
                  );
                })}
                {shownMachines.length === 0 && <tr><td className="text-ink-3" colSpan={7}>{canEdit ? "No machines yet. Use Edit list to add one." : "No machines yet. Ask an admin to add them."}</td></tr>}
              </tbody>
            </DataTable>
          ) : (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {shownMachines.map((m) => {
                const r = relOf.get(m.id);
                const body = (
                  <>
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex flex-col"><Mono className="text-sm font-semibold">{m.code}</Mono><span className="text-xs text-ink-3">{m.name}{m.tonnage ? ` · ${m.tonnage} T` : ""}</span></span>
                      {m.active ? <Badge tone="neutral">{m.moulds.length} mould{m.moulds.length === 1 ? "" : "s"}</Badge> : <Badge tone="neutral">Retired</Badge>}
                    </span>
                    <span className="text-xs text-ink-3">{m.moulds.map((x) => x.code).join(", ") || "No mould fitted"}{r ? ` · ${r.breakdowns} breakdown${r.breakdowns === 1 ? "" : "s"} in 30 days` : ""}</span>
                  </>
                );
                return (
                  <div key={m.id} className={`group/p relative has-[details[open]]:col-span-full ${retired(m.active)}`}>
                    <Drawer label={`Edit machine ${m.code}`} tile={body} tileClass={`${cardCls} cursor-pointer ring-1 ring-transparent hover:ring-accent`}>
                      <form action={saveMachineAction} className="grid gap-3 rounded-[14px] border border-border bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="code" value={m.code} />
                        <p className="text-[13px] font-semibold sm:col-span-2 lg:col-span-4">{m.code} <span className="font-normal text-ink-3">· code can&apos;t be changed</span></p>
                        <label className="text-xs sm:col-span-2">Name<input name="name" required defaultValue={m.name} className={field} /></label>
                        <label className="text-xs">Tonnage<input name="tonnage" type="number" min="1" defaultValue={m.tonnage ?? ""} className={field} /></label>
                        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
                          <button className={btnCls}>Save</button>
                          {!m.active && <button formAction={reactivateAction} formNoValidate name="kind" value="machine" className="min-h-12 cursor-pointer text-sm font-semibold text-accent">Put back in service</button>}
                        </div>
                      </form>
                    </Drawer>
                    {m.active && (
                      <form action={removeMachineAction} className="group-has-[details[open]]/p:hidden">
                        <input type="hidden" name="id" value={m.id} />
                        <RemoveButton label={`Remove machine ${m.code}`} busy={false} why="" />
                      </form>
                    )}
                  </div>
                );
              })}
              <Drawer label="Add a machine" className="open:col-span-full" tileClass={`flex min-h-32 flex-col items-center justify-center gap-1 rounded-[14px] ${dotted}`} tile={<><Plus size={26} aria-hidden /><span className="text-sm font-semibold">Add machine</span></>}>
                <form action={addMachineAction} className="grid gap-3 rounded-[14px] border-2 border-dashed border-accent bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <p className="text-[13px] font-semibold sm:col-span-2 lg:col-span-4">New machine</p>
                  <label className="text-xs">Code<input name="code" required maxLength={30} placeholder="e.g. IMM-05" className={field} /></label>
                  <label className="text-xs sm:col-span-2">Name<input name="name" required placeholder="e.g. Injection Machine 120T" className={field} /></label>
                  <label className="text-xs">Tonnage<input name="tonnage" type="number" min="1" className={field} /></label>
                  <div className="sm:col-span-2 lg:col-span-4"><button className={btnCls}>Create machine</button></div>
                </form>
              </Drawer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
