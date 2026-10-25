import Link from "next/link";
import { ChevronLeft, FileText } from "lucide-react";
import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { addGrade, createGroup, decideGrade, GROUP_CATEGORIES, listGroups, moveGradeUp, type GroupView } from "@/server/services/equivalents";
import { uploadFrom } from "@/server/upload-form";
import { btnCls, btnDangerCls, btnOkCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { SearchBar } from "@/components/search-bar";
import { Badge, Card, Eyebrow, Mono, PageHeader } from "@/components/ui";
import { matches } from "@/lib/url";

export const instant = false;

async function create(formData: FormData) {
  "use server";
  await requirePermission("equivalents.manage");
  let id = "";
  await runAction(() => `/equivalents?id=${id}`, "Group created. Add its first grade.", async () => {
    id = (await createGroup({ name: String(formData.get("name") || ""), itemId: String(formData.get("itemId") || ""), spec: String(formData.get("spec") || "") })).id;
  }, "/equivalents");
}

async function add(formData: FormData) {
  "use server";
  const user = await requirePermission("equivalents.manage");
  const groupId = String(formData.get("groupId"));
  await runAction(`/equivalents?id=${groupId}`, "Grade sent to QA for approval. It can be used once QA approves it.", async () => {
    const days = String(formData.get("leadTimeDays") || "");
    await addGrade({
      groupId, gradeName: String(formData.get("gradeName") || ""), supplierId: String(formData.get("supplierId") || ""),
      datasheetRef: await uploadFrom(formData, "datasheet"), trialRef: await uploadFrom(formData, "trial"),
      leadTimeDays: days === "" ? undefined : Number(days), userId: user.id,
    });
  });
}

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("qc.inspect");
  const groupId = String(formData.get("groupId"));
  const decision = String(formData.get("decision")) as "APPROVE_ALL" | "APPROVE_NON_AUTO" | "REJECT";
  await runAction(`/equivalents?id=${groupId}`, decision === "REJECT" ? "Grade rejected." : "Grade approved.", async () => {
    await decideGrade({ gradeId: String(formData.get("gradeId")), decision, userId: user.id });
  });
}

async function moveUp(formData: FormData) {
  "use server";
  await requirePermission("equivalents.manage");
  const groupId = String(formData.get("groupId"));
  await runAction(`/equivalents?id=${groupId}`, "Priority updated.", async () => { await moveGradeUp(String(formData.get("gradeId"))); });
}

const COLORS = ["#1D4ED8", "#6E95E8", "#E98A3E", "#1E7A46"];
const fmt = (n: number) => n.toLocaleString("en-US");

function GroupBar({ g }: { g: GroupView }) {
  const approved = g.grades.filter((x) => x.status === "APPROVED");
  const tot = Math.max(approved.reduce((a, x) => a + x.stock, 0), 1);
  return (
    <span aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-md bg-canvas">
      {approved.map((x, j) => <span key={x.id} style={{ width: `${(x.stock / tot) * 100}%`, background: COLORS[j % COLORS.length] }} />)}
    </span>
  );
}

export default async function EquivalentsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; id?: string; q?: string }> }) {
  const user = await requirePermission("stock.view");
  const { error, ok, id, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const groups = await listGroups();
  const canManage = can(user.role, "equivalents.manage");
  const canDecide = can(user.role, "qc.inspect");
  const sel = id ? groups.find((g) => g.id === id) : undefined;

  if (sel) {
    const approved = sel.grades.filter((x) => x.status === "APPROVED");
    const others = sel.grades.filter((x) => x.status !== "APPROVED");
    const suppliers = canManage ? await db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
    return (
      <CreateProvider>
        <div className="space-y-4">
          <PageHeader eyebrow={sel.code} title={sel.name} right={canManage ? <CreateButton label="Add grade" /> : undefined}>
            <div className="space-y-2.5">
              <Link href="/equivalents" className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> All groups</Link>
              <div className="flex flex-wrap gap-1.5">{sel.spec.map((sp) => <span key={sp} className="rounded-md bg-shell-2 px-2 py-1 font-mono text-[11px]">{sp}</span>)}</div>
            </div>
          </PageHeader>
          <Flash error={error} ok={ok} />
          <CreatePanel>
            <Card className="space-y-3">
              <Eyebrow>ADD EQUIVALENT GRADE TO {sel.code}</Eyebrow>
              <form action={add} className="grid gap-3 md:grid-cols-3">
                <input type="hidden" name="groupId" value={sel.id} />
                <label className="text-[13px]">Vendor grade name<input name="gradeName" required placeholder="e.g. HP-500N" className={inputCls} /></label>
                <label className="text-[13px]">Vendor
                  <select name="supplierId" required className={inputCls}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                </label>
                <label className="text-[13px]">Lead time (days)<input name="leadTimeDays" type="number" min="0" step="1" placeholder="vendor default" className={inputCls} /></label>
                <label className="text-[13px] md:col-span-1">Datasheet (PDF / photo, required)<input name="datasheet" type="file" accept=".pdf,.png,.jpg,.jpeg" required className={`${inputCls} py-2.5 text-xs`} /></label>
                <label className="text-[13px] md:col-span-1">Trial report (optional)<input name="trial" type="file" accept=".pdf,.png,.jpg,.jpeg" className={`${inputCls} py-2.5 text-xs`} /></label>
                <div className="flex items-end"><button className={`${btnCls} w-full`}>Send to QA for approval</button></div>
              </form>
              <p className="text-xs text-ink-3">Snap datasheet → check spec window → attach trial report → QA approves.</p>
            </Card>
          </CreatePanel>

          <Card className="space-y-2">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-3">Group stock (approved grades)</span>
              <Mono className={sel.onHand < sel.min ? "text-danger" : ""}>{fmt(sel.onHand)} / min {fmt(sel.min)} {sel.uom}</Mono>
            </div>
            <GroupBar g={sel} />
            <span className="text-xs text-ink-3">Used in {sel.usedIn.length ? sel.usedIn.join(", ") : "no BOM yet"}. Automotive parts draw only from grades approved for all parts.</span>
          </Card>
          {sel.warning && <div className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-ink">{sel.warning}</div>}

          <h2 className="font-display text-[15px] font-bold text-ink-3">Approved grades · priority order</h2>
          <div className="grid gap-2.5 md:grid-cols-2">
            {approved.map((x) => (
              <article key={x.id} className={`space-y-2.5 rounded-[14px] border-2 bg-white p-3.5 ${x.rank === 1 ? "border-ok" : "border-white"}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`flex size-7 flex-none items-center justify-center rounded-full text-xs font-bold ${x.rank === 1 ? "bg-ok text-white" : "bg-canvas"}`}>{x.rank}</span>
                  <span className="flex min-w-0 flex-1 flex-col"><span className="font-semibold">{x.gradeName}</span><span className="text-xs text-ink-3">{x.supplierName}</span></span>
                  <Badge tone={x.autoApproved ? "info" : "warn"}>{x.autoApproved ? "Auto + Non-auto" : "Non-auto only"}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-3">
                  <span className="flex flex-col"><strong className="font-mono text-[13px] font-medium text-ink">{fmt(x.stock)} {sel.uom}</strong>In stock</span>
                  <span className="flex flex-col"><strong className="font-mono text-[13px] font-medium text-ink">{x.leadTimeDays ?? "—"} d</strong>Lead time</span>
                  <span className="flex flex-col"><strong className="font-mono text-[13px] font-medium text-ink">{x.price === null ? "—" : `₹${x.price}`}</strong>Price</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
                  <span className="flex items-center gap-1.5"><FileText size={13} aria-hidden />{x.evidence}</span>
                  {canManage && (x.rank ?? 1) > 1 && (
                    <form action={moveUp}><input type="hidden" name="groupId" value={sel.id} /><input type="hidden" name="gradeId" value={x.id} />
                      <button className="min-h-9 cursor-pointer rounded-lg border border-border bg-canvas px-3 text-xs font-semibold">Move up</button></form>
                  )}
                </div>
              </article>
            ))}
            {approved.length === 0 && <Card><p className="text-sm text-ink-3">No approved grades yet.</p></Card>}
          </div>

          {others.length > 0 && (
            <>
              <h2 className="font-display text-[15px] font-bold text-ink-3">Waiting for QA or rejected</h2>
              <div className="grid gap-2.5 md:grid-cols-2">
                {others.map((x) => (
                  <article key={x.id} className="space-y-2.5 rounded-[14px] bg-white p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex min-w-0 flex-1 flex-col"><span className="font-semibold">{x.gradeName}</span><span className="text-xs text-ink-3">{x.supplierName} · {x.evidence}</span></span>
                      <Badge tone={x.status === "PENDING_QA" ? "warn" : "danger"}>{x.status === "PENDING_QA" ? "Pending QA" : "Rejected"}</Badge>
                    </div>
                    {x.status === "PENDING_QA" && canDecide && (
                      <form action={decide} className="grid gap-2 sm:grid-cols-3">
                        <input type="hidden" name="groupId" value={sel.id} /><input type="hidden" name="gradeId" value={x.id} />
                        <button name="decision" value="APPROVE_ALL" className={btnOkCls}>Approve for all parts</button>
                        <button name="decision" value="APPROVE_NON_AUTO" className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-border bg-white px-4 text-[15px] font-semibold">Non-auto only</button>
                        <button name="decision" value="REJECT" className={btnDangerCls}>Reject</button>
                      </form>
                    )}
                    {x.status === "PENDING_QA" && !canDecide && <p className="text-xs text-ink-3">QA will review the datasheet and trial report.</p>}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </CreateProvider>
    );
  }

  const eligible = canManage
    ? await db.item.findMany({ where: { active: true, category: { in: [...GROUP_CATEGORIES] }, equivalentGroup: null }, orderBy: { code: "asc" } })
    : [];
  const visible = groups.filter((g) => matches(q, g.code, g.name, g.itemCode, ...g.grades.flatMap((x) => [x.gradeName, x.supplierName])));

  return (
    <CreateProvider>
      <div className="space-y-4">
        <PageHeader right={canManage ? <CreateButton label="New group" /> : undefined} eyebrow="SET UP" title="Equivalent groups" subtitle="One spec, many vendor grades. BOMs, MRP and stock use the group.">
          <Link href="/bom" className="flex min-h-9 items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} aria-hidden /> BOMs</Link>
        </PageHeader>
        <Flash error={error} ok={ok} />
        <CreatePanel>
          <Card className="space-y-3">
            <Eyebrow>NEW EQUIVALENT GROUP</Eyebrow>
            {eligible.length === 0 ? <p className="text-sm text-ink-3">Every resin, masterbatch, insert and packaging item already has a group. Add the item in Masters first.</p> : (
              <form action={create} className="grid gap-3 md:grid-cols-3">
                <label className="text-[13px]">Group name<input name="name" required placeholder="e.g. PC/ABS FR V0" className={inputCls} /></label>
                <label className="text-[13px]">Stock item it covers
                  <select name="itemId" required className={inputCls}>{eligible.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select>
                </label>
                <label className="text-[13px]">Key spec values (comma separated)<input name="spec" placeholder="MFI 10–14, UL94 V0, H₂O ≤ 0.02%" className={inputCls} /></label>
                <div className="md:col-span-3"><button className={`${btnCls} w-full md:w-auto`}>Create group</button></div>
              </form>
            )}
          </Card>
        </CreatePanel>
        <SearchBar q={q} placeholder="Search group, item, grade or vendor" clearHref="/equivalents" />
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g) => {
            const low = g.onHand < g.min;
            const approved = g.grades.filter((x) => x.status === "APPROVED").length;
            return (
              <Link key={g.id} href={`/equivalents?id=${g.id}`} className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5">
                <span className="flex items-start justify-between gap-2">
                  <span className="flex flex-col"><span className="font-semibold">{g.name}</span>
                    <span className="text-xs text-ink-3"><Mono>{g.code}</Mono> · {approved} approved grade{approved === 1 ? "" : "s"} · used in {g.usedIn.length ? g.usedIn.join(", ") : "no BOM yet"}</span></span>
                  <Badge tone={low ? "danger" : "ok"}>{low ? "Below min" : "In stock"}</Badge>
                </span>
                <span className="flex items-baseline justify-between text-xs text-ink-2"><span>On hand</span><Mono>{fmt(g.onHand)} / min {fmt(g.min)} {g.uom}</Mono></span>
                <GroupBar g={g} />
                {g.warning && <span className="rounded-lg bg-warn-bg px-2.5 py-1.5 text-xs text-warn-ink">{g.warning}</span>}
              </Link>
            );
          })}
          {visible.length === 0 && <Card><p className="text-sm text-ink-3">{q ? `No groups match “${q}”.` : "No equivalent groups yet. Create the first one."}</p></Card>}
        </div>
      </div>
    </CreateProvider>
  );
}
