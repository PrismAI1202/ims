import Link from "next/link";
import { shipments } from "@/server/services/home";
import { Badge, Card, Mono, SectionTitle } from "@/components/ui";

export async function TodaysShipments() {
  const s = await shipments();
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <SectionTitle>Today&apos;s shipments</SectionTitle>
          <span className="block text-xs text-ink-3">Firm and spot demand due in 7 days · {s.readyBoxes} boxes ready to ship</span>
        </span>
        <Link href="/orders?kind=dispatch&state=active" className="text-[13px] font-semibold text-accent">Dispatches</Link>
      </div>
      {s.loading.length > 0 && (
        <ul className="space-y-1">
          {s.loading.map((d) => (
            <li key={d.id}>
              <Link href={`/dispatch/${d.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-canvas px-3 text-sm">
                <span><Mono className="font-semibold">{d.dcNumber}</Mono> · {d.customer}</span>
                <Badge tone="info">{d.scanned} boxes scanned</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {s.rows.length === 0 ? (
        <p className="text-sm text-ink-3">No firm or spot demand due in the next 7 days.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {s.rows.map((r, i) => {
            const short = r.qty - r.ready;
            return (
              <li key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
                <span className="min-w-0"><b>{r.part}</b> <span className="text-ink-3">· {r.customer} · due {r.due}</span></span>
                <span className="flex flex-none items-center gap-2">
                  <Mono className="text-xs">{r.ready.toLocaleString()} / {r.qty.toLocaleString()}</Mono>
                  <Badge tone={short <= 0 ? "ok" : r.ready > 0 ? "warn" : "danger"}>{short <= 0 ? "Ready" : `${short.toLocaleString()} short`}</Badge>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
