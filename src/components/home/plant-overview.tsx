import Link from "next/link";
import { plantOverview } from "@/server/services/home";
import { Badge, Card, Mono, SectionTitle } from "@/components/ui";

export async function PlantOverview() {
  const o = await plantOverview();
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>Plant overview</SectionTitle>
        <Link href="/metrics" className="text-[13px] font-semibold text-accent">Metrics</Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-canvas p-3">
          <span className="text-[11px] font-semibold text-ink-3">OEE · {o.label}</span>
          <Mono className="block text-2xl font-bold">{o.oee === null ? "—" : `${(o.oee * 100).toFixed(0)}%`}</Mono>
        </div>
        <div className="rounded-xl bg-canvas p-3">
          <span className="text-[11px] font-semibold text-ink-3">Top downtime (month)</span>
          <span className="block text-sm font-semibold">{o.topStop ? o.topStop.reason : "—"}</span>
          {o.topStop && <Mono className="text-xs text-ink-2">{Math.round(o.topStop.minutes).toLocaleString()} min</Mono>}
        </div>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {o.exceptions.map((e) => (
          <li key={e.label}>
            <Link href={e.href} className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm">
              {e.label}
              <Badge tone={e.n ? "warn" : "ok"}>{e.n}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
