import Link from "next/link";
import { machineCards } from "@/server/services/home";
import { canView } from "@/server/auth/permissions";
import { Badge, Card, Mono, SectionTitle } from "@/components/ui";
import type { HomeProps } from "./types";

export async function MyMachines({ user }: HomeProps) {
  const cards = await machineCards();
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>My machines</SectionTitle>
        {canView(user, "production") && <Link href="/production" className="text-[13px] font-semibold text-accent">Book production</Link>}
      </div>
      {cards.length === 0 && <Card><p className="text-sm text-ink-3">No machines set up yet.</p></Card>}
      <div className="grid gap-2.5 md:grid-cols-2">
        {cards.map((m) => (
          <article key={m.id} className="space-y-2 rounded-[14px] bg-white p-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col">
                <Mono className="text-[15px] font-semibold">{m.code}</Mono>
                <span className="text-xs text-ink-3">{m.mould ? `Mould ${m.mould}` : "No mould"}{m.tonnage ? ` · ${m.tonnage} T` : ""}</span>
              </span>
              {m.downtimeMin > 0 ? <Badge tone="warn">{m.downtimeMin} min stopped today</Badge> : <Badge tone="ok">No stops today</Badge>}
            </div>
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-[13px]">
              <dt className="text-ink-3">Plan today</dt>
              <dd>{m.plan ? <><b>{m.plan.label}</b>{m.plan.note && <span className="text-ink-3"> · {m.plan.note}</span>}</> : <span className="text-ink-3">Nothing planned</span>}</dd>
              <dt className="text-ink-3">Last booking</dt>
              <dd>{m.last ? <><Mono>{m.last.number}</Mono> · {m.last.part} · {m.last.good.toLocaleString()} good{m.last.reject ? `, ${m.last.reject} rejected` : ""} <span className="text-ink-3">· {m.last.when}</span></> : <span className="text-ink-3">None yet</span>}</dd>
              <dt className="text-ink-3">Last stop</dt>
              <dd>{m.lastStop ? <>{m.lastStop.reason} · {m.lastStop.minutes} min <span className="text-ink-3">· {m.lastStop.when}</span></> : <span className="text-ink-3">None this week</span>}</dd>
              <dt className="text-ink-3">At machine</dt>
              <dd>{m.lots.length ? m.lots.map((l) => <Mono key={l.lotNumber} className="mr-2 text-xs">{l.item} {l.lotNumber}</Mono>) : <span className="text-ink-3">No lots cited</span>}</dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
