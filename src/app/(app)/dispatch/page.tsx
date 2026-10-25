import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createDispatch, dispatchProgress } from "@/server/services/dispatch";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { href } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Chips, Eyebrow, Mono, PageHeader, ProgressBar } from "@/components/ui";

export const instant = false;
const LINES = 4;

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("dispatch.manage");
  let id = "";
  await runAction(() => `/dispatch/${id}`, "Pick list created. Scan the boxes to load.", async () => {
    const lines = Array.from({ length: LINES }, (_, i) => ({
      itemId: String(formData.get(`item_${i}`) || ""), qty: Number(formData.get(`qty_${i}`) || 0),
    })).filter((l) => l.itemId);
    const d = await createDispatch({
      customerId: String(formData.get("customerId")), vehicleNumber: String(formData.get("vehicleNumber") || ""),
      driverName: String(formData.get("driverName") || "") || undefined, lines, userId: user.id,
    });
    id = d.id;
  }, "/dispatch");
}

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string; status?: string }> }) {
  await requirePermission("dispatch.manage");
  const { error, ok, q: rawQ, status } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const view = status === "LOADING" || status === "DISPATCHED" || status === "CANCELLED" ? status : "ALL";
  const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const [customers, fgItems, dispatches] = await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.item.findMany({ where: { category: "FG", active: true }, orderBy: { code: "asc" } }),
    db.dispatch.findMany({
      where: {
        ...(view === "ALL" ? {} : { status: view }),
        ...(q ? { OR: [{ dcNumber: ci(q) }, { vehicleNumber: ci(q) }, { driverName: ci(q) }, { customer: { name: ci(q) } }] } : {}),
      },
      orderBy: { createdAt: "desc" }, take: 50, include: { customer: true, lines: { include: { item: true } } },
    }),
  ]);

  const progress = new Map(
    await Promise.all(dispatches.filter((d) => d.status === "LOADING").map(async (d) => [d.id, await dispatchProgress(d.id)] as const)),
  );
  const tone = (s: string) => (s === "DISPATCHED" ? "ok" : s === "CANCELLED" ? "danger" : "warn") as "ok" | "danger" | "warn";

  return (
    <CreateProvider>
    <div className="space-y-4">
      <PageHeader right={<CreateButton label="New pick list" />} eyebrow="SHIP" title="Dispatch" subtitle={`${dispatches.filter((d) => d.status === "LOADING").length} loading now`} />
      <Flash error={error} ok={ok} />
      <CreatePanel>
        <Card className="space-y-3">
          <Eyebrow>NEW PICK LIST</Eyebrow>
          <form action={create} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-[13px]">Customer
                <select name="customerId" required className={inputCls}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
              <label className="text-[13px]">Vehicle no.<input name="vehicleNumber" required className={inputCls} /></label>
              <label className="text-[13px]">Driver<input name="driverName" className={inputCls} /></label>
            </div>
            {Array.from({ length: LINES }, (_, i) => (
              <div key={i} className="grid gap-2 md:grid-cols-4">
                <select name={`item_${i}`} className={`${inputCls} md:col-span-3`} aria-label={`Part ${i + 1}`}>
                  <option value="">— part {i + 1} —</option>
                  {fgItems.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
                </select>
                <input name={`qty_${i}`} type="number" min="1" step="1" placeholder="Qty" className={inputCls} aria-label={`Quantity ${i + 1}`} />
              </div>
            ))}
            <button className={`${btnCls} w-full md:w-auto`}>Create &amp; start loading</button>
          </form>
        </Card>
      </CreatePanel>

      <SearchBar q={q} placeholder="Search DC no., customer or vehicle" keep={{ status: view === "ALL" ? undefined : view }} clearHref={href("/dispatch", { status: view === "ALL" ? undefined : view })} />
      <Chips chips={(["ALL", "LOADING", "DISPATCHED", "CANCELLED"] as const).map((k) => ({
        href: href("/dispatch", { q, status: k === "ALL" ? undefined : k }), label: k === "ALL" ? "All" : k[0] + k.slice(1).toLowerCase(), active: view === k,
      }))} />
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {dispatches.map((d) => {
          const pr = progress.get(d.id);
          const ordered = pr ? pr.lines.reduce((a, l) => a + l.ordered, 0) : 0;
          const scanned = pr ? pr.lines.reduce((a, l) => a + Math.min(l.scanned, l.ordered), 0) : 0;
          return (
            <Link key={d.id} href={`/dispatch/${d.id}`} className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5">
              <span className="flex items-start justify-between gap-2">
                <span className="flex flex-col"><Mono className="text-[15px] font-semibold">{d.dcNumber}</Mono><span className="text-[13px] text-ink-2">{d.customer.name} · {d.vehicleNumber}</span></span>
                <Badge tone={tone(d.status)}>{d.status}</Badge>
              </span>
              <span className="text-xs text-ink-3">{d.lines.map((l) => `${l.item.code} × ${l.qty.toLocaleString()}`).join(", ")}</span>
              {pr && (
                <span className="flex flex-col gap-1">
                  <span className="flex justify-between text-xs"><span className="text-ink-3">Scanned</span><Mono>{scanned.toLocaleString()} / {ordered.toLocaleString()}</Mono></span>
                  <ProgressBar value={scanned} max={ordered} color={scanned >= ordered ? "#1E7A46" : "#1D4ED8"} />
                </span>
              )}
            </Link>
          );
        })}
        {dispatches.length === 0 && <Card><p className="text-sm text-ink-3">{q ? `No dispatches match “${q}”.` : "No dispatches in this view."}</p></Card>}
      </div>
    </div>
    </CreateProvider>
  );
}
