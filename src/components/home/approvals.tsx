import Link from "next/link";
import { db } from "@/server/db";
import { Badge, Card, Mono, SectionTitle } from "@/components/ui";

export async function Approvals() {
  const waiting = await db.stockCount.findMany({
    where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, take: 5,
    include: { location: true, lines: true },
  });
  const diffs = (c: (typeof waiting)[number]) => c.lines.filter((l) => Math.abs(Number(l.countedQty) - Number(l.systemQty)) > 1e-9).length;
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>Approvals</SectionTitle>
        <Link href="/stock?view=bins" className="text-[13px] font-semibold text-accent">Open</Link>
      </div>
      {waiting.length === 0 ? (
        <p className="text-sm text-ink-3">No stock counts are waiting for a decision.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {waiting.map((c) => (
            <li key={c.id}>
              <Link href="/stock?view=bins" className="flex min-h-12 items-center justify-between gap-2 px-3 text-sm">
                <span><Mono className="font-semibold">{c.countNumber}</Mono> <span className="text-ink-3">· bin {c.location.code}</span></span>
                <Badge tone={diffs(c) ? "warn" : "ok"}>{diffs(c) ? `${diffs(c)} differences` : "No differences"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
