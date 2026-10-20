import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Tone = "danger" | "warn" | "ok" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  danger: "bg-danger-bg text-danger",
  warn: "bg-warn-bg text-warn-ink",
  ok: "bg-ok-bg text-ok-ink",
  info: "bg-info-bg text-info-ink",
  neutral: "bg-canvas text-ink-2",
};

/** Dark page header with a mono eyebrow, as on every screen of the design. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="-mx-4 -mt-4 mb-4 bg-shell px-5 pb-4 pt-8 text-on-shell md:-mx-8 md:-mt-8 md:mb-6 md:px-8 md:pt-8">
      {eyebrow && (
        <div className="font-mono text-xs tracking-[0.06em] text-on-shell-2">{eyebrow}</div>
      )}
      <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight">{title}</h1>
      {subtitle && <p className="mt-0.5 text-[13px] text-on-shell-2">{subtitle}</p>}
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[14px] bg-white p-4 ${className}`}>{children}</section>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-[17px] font-bold">{children}</h2>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-[13px] font-bold tracking-[0.04em] text-ink-3">{children}</h2>;
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-md px-2 py-1 text-[11px] font-bold ${TONE[tone]}`}>{children}</span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{children}</span>
  );
}

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono ${className}`}>{children}</span>;
}

/** Big coloured count tile (Below min / Near ROP / Optimal). */
export function StatTile({
  n,
  label,
  className,
  href,
  active,
}: {
  n: number;
  label: string;
  className: string;
  href?: string;
  active?: boolean;
}) {
  const cls = `flex flex-col rounded-[10px] px-3 py-2.5 text-left ${className} ${active ? "outline-[3px] outline-offset-2 outline-ink" : ""}`;
  const body = (
    <>
      <span className="font-display text-[28px] font-extrabold leading-none">{n}</span>
      <span className="mt-1 text-xs font-semibold">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} scroll={false} className={cls} aria-current={active ? "true" : undefined}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Tall tappable row ending in a chevron. */
export function ListRow({
  href,
  bar,
  title,
  sub,
  right,
}: {
  href: string;
  bar?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
    >
      {bar && <span className="w-1.5 flex-none self-stretch rounded-[3px]" style={{ background: bar }} />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        {sub && <span className="text-xs leading-snug text-ink-2">{sub}</span>}
      </span>
      {right}
      <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden />
    </Link>
  );
}

/** Segmented control made of links (server-friendly). */
export function SegmentedTabs({
  tabs,
}: {
  tabs: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav
      aria-label="Sections"
      className="grid gap-1 rounded-xl bg-shell-2 p-1"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`flex min-h-10 items-center justify-center rounded-[9px] px-1 text-center text-[13px] font-semibold ${
            t.active ? "bg-on-shell text-ink" : "text-[#d5d7db]"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const STORES_TABS = [
  { href: "/stock", label: "Stock & bins" },
  { href: "/requests", label: "Requisitions" },
  { href: "/issue", label: "FIFO issue" },
];

export function StoresTabs({ active }: { active: "/stock" | "/requests" | "/issue" }) {
  return <SegmentedTabs tabs={STORES_TABS.map((t) => ({ ...t, active: t.href === active }))} />;
}

/** Scrollable table wrapper with the design's dividers and mono numerals. */
export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[14px] bg-white">
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-line [&_td]:p-3 [&_th]:bg-canvas [&_th]:p-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ink-3">
        {children}
      </table>
    </div>
  );
}

export function ComingSoon({ title, what }: { title: string; what: string }) {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="PLANT 2 · MOULDING SHOP" title={title} />
      <Card className="space-y-3">
        <Badge tone="info">Coming soon</Badge>
        <p className="text-[15px]">{what}</p>
        <p className="text-sm text-ink-3">This module is part of the design but has not been built yet.</p>
      </Card>
    </div>
  );
}
