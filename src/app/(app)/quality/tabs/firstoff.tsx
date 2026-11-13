import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { getRule } from "@/server/services/settings";
import { ago } from "@/server/services/home";
import { btnCls, btnDangerCls, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Eyebrow, Mono } from "@/components/ui";
import type { HomeUser } from "@/components/home/types";
import { decideFirst, requestFirst } from "../actions";

const tone = (s: string) => (s === "APPROVED" ? "ok" : s === "REJECTED" ? "danger" : "warn") as "ok" | "danger" | "warn";

export async function FirstOffTab({ user }: { user: HomeUser }) {
  const canRequest = can(user, "firstoff.request"), canDecide = can(user, "firstoff.approve");
  const [machines, boms, waiting, recent, enforced] = await Promise.all([
    db.machine.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.bom.findMany({ include: { fgItem: true }, orderBy: { fgItem: { code: "asc" } } }),
    db.firstOff.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { machine: true, bom: { include: { fgItem: true } } } }),
    db.firstOff.findMany({ where: { status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 10, include: { machine: true, bom: { include: { fgItem: true } } } }),
    getRule("requireFirstOff"),
  ]);
  const now = new Date();

  return (
    <CreateProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm text-ink-2">
            After a mould set-up, production asks QA to check the first parts. An approval holds for 24 hours for that machine, part and shift.{" "}
            {enforced ? <b>Production can&apos;t be booked without one.</b> : <>This isn&apos;t enforced yet: an admin can require it under Settings.</>}
          </p>
          {canRequest && <CreateButton label="Request first-off" />}
        </div>
        {canRequest && (
          <CreatePanel>
            <Card className="space-y-3">
              <Eyebrow>REQUEST A FIRST-OFF</Eyebrow>
              <form action={requestFirst} className="grid gap-3 md:grid-cols-5">
                <label className="text-[13px]">Machine<select name="machine" required className={inputCls}>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select></label>
                <label className="text-[13px]">Part<select name="bom" required className={inputCls}>{boms.map((b) => <option key={b.id} value={b.id}>{b.fgItem.code}</option>)}</select></label>
                <label className="text-[13px]">Shift<select name="shift" className={inputCls}><option>A</option><option>B</option><option>C</option></select></label>
                <label className="text-[13px]">Note<input name="note" placeholder="e.g. new mould" className={inputCls} /></label>
                <div className="flex items-end"><button className={`${btnCls} w-full`}>Request</button></div>
              </form>
            </Card>
          </CreatePanel>
        )}

        {waiting.length === 0 && <Card><p className="text-sm text-ink-3">No first-offs are waiting.</p></Card>}
        <div className="grid gap-2.5 md:grid-cols-2">
          {waiting.map((f) => (
            <article key={f.id} className="space-y-2.5 rounded-[14px] bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col"><Mono className="text-[15px] font-semibold">{f.machine.code} · {f.bom.fgItem.code}</Mono><span className="text-xs text-ink-3">Shift {f.shift} · asked {ago(f.createdAt, now)}</span></span>
                <Badge tone="warn">Waiting</Badge>
              </div>
              {f.note && <p className="text-[13px] text-ink-2">{f.note}</p>}
              {canDecide && (
                <form action={decideFirst} className="space-y-2">
                  <input type="hidden" name="id" value={f.id} />
                  <label className="block text-[13px]">Remarks <span className="text-ink-3">(needed to reject)</span><input name="note" className={inputCls} /></label>
                  <div className="flex gap-2">
                    <button name="decision" value="approve" className={btnCls}>Approve</button>
                    <button name="decision" value="reject" className={btnDangerCls}>Reject</button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </div>

        {recent.length > 0 && (
          <section className="space-y-1.5">
            <Eyebrow>RECENTLY DECIDED</Eyebrow>
            <div className="overflow-hidden rounded-[14px] bg-white">
              {recent.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
                  <span><Mono className="font-semibold">{f.machine.code} · {f.bom.fgItem.code}</Mono> <span className="text-ink-3">· shift {f.shift}</span>{f.decisionNote && <span className="block text-xs text-ink-3">{f.decisionNote}</span>}</span>
                  <Badge tone={tone(f.status)}>{f.status}</Badge>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </CreateProvider>
  );
}
