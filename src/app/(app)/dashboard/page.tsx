import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { stockByItem } from "@/server/services/stock";
import { inbox } from "@/server/services/inbox";
import { requireUser } from "@/server/auth/guard";
import { can, canView } from "@/server/auth/permissions";
import type { ViewKey } from "@/lib/views";
import { Flash } from "@/components/flash";
import { DownloadLink } from "@/components/download-link";
import { Card, Chip, Eyebrow, Mono, PageHeader, SectionTitle, StatTile } from "@/components/ui";

const TONE = {
  RED: "bg-danger text-white",
  YELLOW: "bg-[#f5c451] text-[#3a2a00]",
  GREEN: "bg-ok-bg text-ok-ink",
} as const;
const LABEL = { RED: "Below min", YELLOW: "Near ROP", GREEN: "Optimal" } as const;
type Status = keyof typeof TONE;

const ACTIONS: { href: string; label: string; sub: string; view: ViewKey }[] = [
  { href: "/grn", label: "Gate entry / GRN", sub: "Inward", view: "grn" },
  { href: "/issue", label: "Issue to shop floor", sub: "FIFO lot", view: "issue" },
  { href: "/qc", label: "QC queue", sub: "Hold / release", view: "qc" },
  { href: "/production", label: "Book production", sub: "Shots, rejects, downtime", view: "production" },
  { href: "/requests", label: "Request material", sub: "To stores", view: "requests" },
  { href: "/fg", label: "Pack & label", sub: "FG boxes", view: "fg" },
  { href: "/dispatch", label: "Dispatch", sub: "Pick, load, DC", view: "dispatch" },
  { href: "/purchase", label: "Supplier PO", sub: "Raise / receive", view: "purchase" },
  { href: "/stock", label: "Bin transfer", sub: "Move between bins", view: "stock" },
  { href: "/scan", label: "Scanner", sub: "Works offline", view: "scan" },
];

export const instant = false;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { error, status } = await searchParams;
  const sel: Status = status === "YELLOW" || status === "GREEN" ? status : "RED";
  // Stock health is for the roles that buy and stock material (Admin, Store, Planner); everyone else starts at their tasks.
  const health = can(user, "reorder.view");
  const [tasks, rows] = await Promise.all([inbox(user), health ? stockByItem() : []]);
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  // Most urgent first: how far below its minimum each item is.
  const shown = rows.filter((r) => r.status === sel).sort((a, b) => a.onHand / Math.max(a.minStock, 1) - b.onHand / Math.max(b.minStock, 1));
  const actions = ACTIONS.filter((a) => canView(user, a.view)).slice(0, 4);
  const waiting = tasks.filter((t) => t.kind === "act").reduce((a, t) => a + t.count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PLANT 2 · MOULDING SHOP"
        title={user.name ?? "Home"}
        subtitle={(user.name ?? "").toLowerCase() === user.roleName.toLowerCase() ? undefined : user.roleName}
      />
      <Flash error={error} />
      <Card className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <SectionTitle>Needs you</SectionTitle>
          <span className={`font-display text-2xl font-extrabold ${waiting ? "text-accent" : "text-ok"}`}>{waiting}</span>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing waiting on you right now.</p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-line">
            {tasks.map((t, i) => (
              <li key={t.key} className={i > 0 ? "border-t border-line" : ""}>
                <Link href={t.href} className="flex min-h-14 items-center gap-3 px-3 py-2.5 hover:bg-canvas">
                  <span className={`min-w-10 rounded-lg px-2 py-1 text-center font-mono text-sm font-bold ${t.kind === "act" ? "bg-accent text-white" : "bg-canvas text-ink-2"}`}>
                    {t.count.toLocaleString()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span className="text-xs text-ink-3">{t.sub}</span>
                  </span>
                  <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {health && (
      <Card className="space-y-3">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <span>
            <SectionTitle>Stock health</SectionTitle>
            <span className="block text-xs text-ink-3">{rows.length} stock items</span>
          </span>
          {canView(user, "stock") && (
            <Link href="/stock" className="flex items-center gap-1 text-[13px] font-semibold text-accent">
              Stores <ChevronRight size={18} aria-hidden />
            </Link>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["RED", "YELLOW", "GREEN"] as const).map((s) => (
            <StatTile
              key={s}
              n={count(s)}
              label={LABEL[s]}
              className={TONE[s]}
              href={`/dashboard?status=${s}`}
              active={sel === s}
            />
          ))}
        </div>
        <div>
          <div
            tabIndex={0} role="region" aria-label="Stock list"
            className="max-h-[21rem] overflow-y-auto overscroll-contain rounded-xl border border-line px-3 [scrollbar-width:thin]"
          >
            {shown.map((r, i) => (
              <div key={r.itemId} className={`flex flex-col gap-1 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Chip>{r.category.replace("_", " ")}</Chip>
                    <span className="whitespace-nowrap text-sm font-semibold">{r.code}</span>
                  </span>
                  <Mono className={`flex-none text-xs ${sel === "RED" ? "text-danger" : "text-ink-2"}`}>
                    {r.onHand.toLocaleString()} / min {r.minStock.toLocaleString()} {r.uom}
                  </Mono>
                </div>
                <div className="text-[13px] text-ink-2">{r.name}</div>
                <div className="flex gap-4 text-xs text-ink-2">
                  <span>Pending QC <Mono>{r.pendingQc.toLocaleString()}</Mono></span>
                  <span>ROP <Mono>{r.reorderPoint.toLocaleString()}</Mono></span>
                  <span>Max <Mono>{r.maxStock.toLocaleString()}</Mono></span>
                </div>
              </div>
            ))}
          </div>
          {shown.length > 5 && <p className="pt-1.5 text-center text-[11px] text-ink-3">Showing the most urgent first · scroll for all {shown.length}</p>}
          {shown.length === 0 && (
            <p className="py-4 text-sm text-ink-3">Nothing {LABEL[sel].toLowerCase()} right now.</p>
          )}
          {canView(user, "stock") && (
            <Link href="/stock" className="flex min-h-11 items-center justify-center gap-1 border-t border-line text-sm font-semibold">
              See Stores · bin map <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      </Card>
      )}

      {actions.length > 0 && (
        <section className="space-y-2">
          <Eyebrow>Quick actions</Eyebrow>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {actions.map((a, i) => (
              <Link
                key={a.href}
                href={a.href}
                className={`flex min-h-16 flex-col justify-between gap-1.5 rounded-xl px-3.5 py-3 ${i === 0 ? "bg-accent text-white" : "bg-white text-ink"}`}
              >
                <span className="text-[15px] font-semibold">{a.label}</span>
                <span className="flex items-center justify-between text-xs opacity-85">
                  {a.sub} <ChevronRight size={16} aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {health && (
        <p className="flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
          <DownloadLink href={"/api/v1/export/stock?format=xlsx"}>Download Excel</DownloadLink>
          <DownloadLink href={"/api/v1/export/stock?format=csv"}>Download CSV</DownloadLink>
          <span className="font-normal text-ink-3">For a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
        </p>
      )}
    </div>
  );
}
