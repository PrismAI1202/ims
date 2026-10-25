import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { blockSlot, clearSlot, mondayOf, parseDay, placeJob, planWeek, weekDays } from "@/server/services/planning";
import { btnCls, btnDangerCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Eyebrow, Mono, PageHeader } from "@/components/ui";
import { href } from "@/lib/url";

export const instant = false;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const label = (day: string) => { const d = parseDay(day); return `${DAY[d.getUTCDay()]} ${d.getUTCDate()}`; };
const PALETTE: [string, string][] = [["#15171A", "#FFFFFF"], ["#9AA0A8", "#15171A"], ["#3D434B", "#FFFFFF"], ["#F5E7C6", "#3A2A00"], ["#6E95E8", "#0B1F4D"], ["#1E7A46", "#FFFFFF"], ["#6B4FB0", "#FFFFFF"]];
const colourFor = (part: string, kind: string): [string, string] =>
  kind === "PM" ? ["#FCEDEB", "#B42318"] : kind === "TRIAL" ? ["#FDF0E4", "#8A4B00"] : PALETTE[[...part].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

async function place(formData: FormData) {
  "use server";
  const user = await requirePermission("plan.manage");
  const week = String(formData.get("week")), job = String(formData.get("job"));
  let warning = "";
  await runAction(() => `/planning?week=${week}&job=${job}`, () => warning || "Slot booked. It shows on the shop-floor screens at the next sync.", async () => {
    warning = (await placeJob({ machineId: String(formData.get("machineId")), day: String(formData.get("day")), fgItemId: job, userId: user.id })).warning;
  }, `/planning?week=${week}&job=${job}`);
}

async function block(formData: FormData) {
  "use server";
  const user = await requirePermission("plan.manage");
  const week = String(formData.get("week"));
  await runAction(`/planning?week=${week}`, "Blocked.", async () => {
    await blockSlot({ machineId: String(formData.get("machineId")), day: String(formData.get("day")), kind: String(formData.get("kind")) === "TRIAL" ? "TRIAL" : "PM", note: String(formData.get("note") || ""), userId: user.id });
  });
}

async function clear(formData: FormData) {
  "use server";
  await requirePermission("plan.manage");
  const week = String(formData.get("week"));
  await runAction(`/planning?week=${week}`, "Slot freed.", async () => { await clearSlot(String(formData.get("slotId"))); });
}

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; week?: string; job?: string; slot?: string }> }) {
  const user = await requirePermission("stock.view");
  const sp = await searchParams;
  const now = new Date();
  const monday = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? mondayOf(parseDay(sp.week)) : mondayOf(now);
  const week = await planWeek(monday);
  const manage = can(user.role, "plan.manage");
  const job = week.jobs.find((j) => j.fgItemId === sp.job);
  const slot = week.slots.find((s) => s.id === sp.slot);
  const slotAt = (machineId: string, day: string) => week.slots.find((s) => s.machineId === machineId && s.day === day);
  const today = iso(now);
  const wk = iso(monday);
  const prev = iso(new Date(monday.getTime() - 7 * 86_400_000)), next = iso(new Date(monday.getTime() + 7 * 86_400_000));
  const nav = (w: string) => href("/planning", { week: w === iso(mondayOf(now)) ? undefined : w, job: job?.fgItemId });
  const days = weekDays(monday).map(iso);

  return (
    <CreateProvider>
      <div className="space-y-4">
        <PageHeader right={manage ? <CreateButton label="Block time" /> : undefined} eyebrow={`PLANNING · WEEK OF ${label(wk).toUpperCase()}`} title="Mould × machine plan"
          subtitle={job ? `Placing ${job.part} — tap a free slot` : `${week.machines.length} machines · ${week.jobs.length} job${week.jobs.length === 1 ? "" : "s"} to schedule`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link href={nav(prev)} className="flex min-h-10 items-center gap-1 rounded-[10px] bg-shell-2 px-3"><ChevronLeft size={16} aria-hidden />Prev</Link>
            <Link href={nav(iso(mondayOf(now)))} className="flex min-h-10 items-center rounded-[10px] bg-shell-2 px-3">This week</Link>
            <Link href={nav(next)} className="flex min-h-10 items-center gap-1 rounded-[10px] bg-shell-2 px-3">Next<ChevronRight size={16} aria-hidden /></Link>
          </div>
        </PageHeader>
        <Flash error={sp.error} ok={sp.ok} />

        <CreatePanel>
          <Card className="space-y-3">
            <Eyebrow>BLOCK A MACHINE-DAY FOR PM OR A TRIAL</Eyebrow>
            <form action={block} className="grid gap-3 md:grid-cols-5">
              <input type="hidden" name="week" value={wk} />
              <label className="text-[13px]">Machine<select name="machineId" className={inputCls}>{week.machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.tonnage ?? "?"} T</option>)}</select></label>
              <label className="text-[13px]">Day<select name="day" className={inputCls}>{days.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select></label>
              <label className="text-[13px]">Block as<select name="kind" className={inputCls}><option value="PM">Mould / machine PM</option><option value="TRIAL">Trial</option></select></label>
              <label className="text-[13px]">Note<input name="note" className={inputCls} /></label>
              <div className="flex items-end"><button className={`${btnCls} w-full`}>Block</button></div>
            </form>
          </Card>
        </CreatePanel>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className="min-w-0 space-y-2 self-start">
            <span className="font-mono text-[11px] tracking-[0.06em] text-ink-3">TO SCHEDULE · pick one, then tap a free slot</span>
            {week.jobs.map((j) => {
              const [bg] = colourFor(j.part, "JOB");
              const on = job?.fgItemId === j.fgItemId;
              return (
                <Link key={j.fgItemId} href={href("/planning", { week: wk === iso(mondayOf(now)) ? undefined : wk, job: on ? undefined : j.fgItemId })} aria-current={on ? "true" : undefined}
                  className={`flex items-center gap-2.5 rounded-xl border-2 p-2.5 ${on ? "border-accent" : "border-line"} ${j.left ? "" : "opacity-55"}`}>
                  <span className="h-9 w-1.5 flex-none rounded-sm" style={{ background: bg }} />
                  <span className="flex min-w-0 flex-1 flex-col"><span className="text-sm font-semibold">{j.part} · {j.mould}</span>
                    <span className="text-xs text-ink-3">{j.minTonnage ? `needs ≥ ${j.minTonnage} T · ` : ""}{j.qty.toLocaleString()} pcs · {j.colour}</span></span>
                  <span className={`text-[11px] font-bold ${j.left ? "text-warn-ink" : "text-ok"}`}>{j.days === null ? "Set cycle time" : j.left ? `${j.left} day${j.left > 1 ? "s" : ""} left` : "Planned"}</span>
                </Link>
              );
            })}
            {week.jobs.length === 0 && <p className="py-2 text-sm text-ink-3">Nothing to schedule. Firm and spot demand with a BOM shows up here once it isn&apos;t already covered by stock.</p>}
            {job && job.days === null && <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-ink">{job.mould} has no standard cycle time, so days needed can&apos;t be estimated. Set it under Maintenance → mould settings.</p>}
          </Card>

          <div className="min-w-0 space-y-3">
            <Card className="overflow-x-auto">
              <div className="grid min-w-[24rem] grid-cols-[3.5rem_repeat(6,1fr)] gap-1">
                <span />
                {days.map((d) => <span key={d} className={`rounded-md py-1 text-center text-[10px] font-semibold ${d === today ? "bg-ink text-white" : "text-ink-3"}`}>{label(d)}</span>)}
                {week.machines.map((m) => (
                  <div key={m.id} className="contents">
                    <span className="flex flex-col justify-center text-[11px]"><strong className="font-mono">{m.code}</strong><span className="text-ink-3">{m.tonnage ?? "?"} T</span></span>
                    {days.map((d) => {
                      const s = slotAt(m.id, d);
                      if (s) {
                        const [bg, fg] = colourFor(s.part, s.kind);
                        return (
                          <Link key={d} href={href("/planning", { week: wk === iso(mondayOf(now)) ? undefined : wk, job: job?.fgItemId, slot: s.id })} aria-label={`${m.code} ${label(d)}: ${s.part} ${s.mould}`}
                            className={`flex h-12 flex-col items-center justify-center rounded-md text-center font-mono text-[9px] leading-tight ${slot?.id === s.id ? "outline-[3px] outline-accent" : ""}`} style={{ background: bg, color: fg }}>
                            <span>{s.part}</span><span>{s.mould}</span>
                          </Link>
                        );
                      }
                      if (job && manage) {
                        return (
                          <form key={d} action={place} className="contents">
                            <input type="hidden" name="week" value={wk} /><input type="hidden" name="job" value={job.fgItemId} />
                            <input type="hidden" name="machineId" value={m.id} /><input type="hidden" name="day" value={d} />
                            <button aria-label={`${m.code} ${label(d)}: place ${job.part} here`} className="h-12 cursor-pointer rounded-md border-[1.5px] border-dashed border-accent bg-[#f4f3ef] text-[10px] font-semibold text-accent">+</button>
                          </form>
                        );
                      }
                      return <span key={d} aria-label={`${m.code} ${label(d)}: free`} className="h-12 rounded-md border border-dashed border-[#C9C5BC] bg-[#f4f3ef]" />;
                    })}
                  </div>
                ))}
              </div>
              {week.machines.length === 0 && <p className="text-sm text-ink-3">No machines yet. Add them in Masters.</p>}
            </Card>

            {slot && (
              <Card className="space-y-1">
                <span className="font-mono text-[11px] text-ink-3">{week.machines.find((m) => m.id === slot.machineId)?.code} · {label(slot.day)}</span>
                <span className="block font-display text-base font-bold">{slot.part}{slot.mould ? ` · ${slot.mould}` : ""}</span>
                <span className="block text-[13px] text-ink-3">{slot.kind === "JOB" ? `Colour ${slot.colour}` : slot.note || (slot.kind === "PM" ? "Preventive maintenance" : "Trial")}</span>
                {slot.kind === "JOB" && <Link href="/bom" className="inline-block pt-1 text-[13px] font-semibold text-accent">View BOM</Link>}
                {manage && (
                  <form action={clear} className="pt-1"><input type="hidden" name="week" value={wk} /><input type="hidden" name="slotId" value={slot.id} />
                    <button className={`${btnDangerCls} min-h-10 px-4 text-[13px]`}>Unschedule this day</button></form>
                )}
              </Card>
            )}
            <p className="text-xs text-ink-3">PM blocks come from the tool room. A job&apos;s days are estimated from the mould&apos;s cavities and standard cycle time at 85% OEE over three {week.shiftMinutes}-minute shifts. <Badge tone="neutral">Live</Badge> <Mono className="sr-only">plan</Mono></p>
          </div>
        </div>
      </div>
    </CreateProvider>
  );
}
