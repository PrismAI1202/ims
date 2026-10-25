import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { stockByItem } from "@/server/services/stock";
import { requirePermission } from "@/server/auth/guard";
import { can, type Permission } from "@/server/auth/permissions";
import { Flash } from "@/components/flash";
import { DownloadLink } from "@/components/download-link";
import { Card, Chip, Eyebrow, Mono, PageHeader, roleLabel, SectionTitle, StatTile } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out";

const TONE = {
  RED: "bg-danger text-white",
  YELLOW: "bg-[#f5c451] text-[#3a2a00]",
  GREEN: "bg-ok-bg text-ok-ink",
} as const;
const LABEL = { RED: "Below min", YELLOW: "Near ROP", GREEN: "Optimal" } as const;
type Status = keyof typeof TONE;

const ACTIONS: { href: string; label: string; sub: string; perm: Permission }[] = [
  { href: "/grn", label: "Gate entry / GRN", sub: "Inward", perm: "grn.create" },
  { href: "/issue", label: "Issue to shop floor", sub: "FIFO lot", perm: "stock.issue" },
  { href: "/stock", label: "Bin transfer", sub: "Move between bins", perm: "stock.transfer" },
  { href: "/purchase", label: "Supplier PO", sub: "Raise / receive", perm: "po.manage" },
  { href: "/qc", label: "QC queue", sub: "Hold / release", perm: "qc.inspect" },
  { href: "/requests", label: "Request material", sub: "To stores", perm: "request.create" },
  { href: "/scan", label: "Scanner", sub: "Works offline", perm: "stock.transfer" },
];

export const instant = false;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const user = await requirePermission("stock.view");
  const { error, status } = await searchParams;
  const sel: Status = status === "YELLOW" || status === "GREEN" ? status : "RED";
  const rows = await stockByItem();
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => r.status === sel);
  const actions = ACTIONS.filter((a) => can(user.role, a.perm));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PLANT 2 · MOULDING SHOP"
        title={user.name ?? "Home"}
        subtitle={roleLabel(user.role)}
        right={<SignOutButton />}
      />
      <Flash error={error} />
      <p className="flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
        <DownloadLink href={"/api/v1/export/stock?format=xlsx"}>Download Excel</DownloadLink>
        <DownloadLink href={"/api/v1/export/stock?format=csv"}>Download CSV</DownloadLink>
        <span className="font-normal text-ink-3">For a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
      </p>
      <Card className="space-y-3">
        <Link href="/stock" className="flex min-h-8 items-center justify-between gap-2">
          <span>
            <SectionTitle>Stock health</SectionTitle>
            <span className="block text-xs text-ink-3">{rows.length} stock items</span>
          </span>
          <span className="flex items-center gap-1 text-[13px] font-semibold text-accent">
            Stores <ChevronRight size={18} aria-hidden />
          </span>
        </Link>
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
          {shown.map((r) => (
            <div key={r.itemId} className="flex flex-col gap-1 border-t border-line py-2.5">
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
          {shown.length === 0 && (
            <p className="border-t border-line py-4 text-sm text-ink-3">Nothing {LABEL[sel].toLowerCase()} right now.</p>
          )}
          {can(user.role, "stock.view") && (
            <Link href="/stock" className="flex min-h-11 items-center justify-center gap-1 border-t border-line text-sm font-semibold">
              See Stores · bin map <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      </Card>

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
    </div>
  );
}
