import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { inbox } from "@/server/services/inbox";
import { Card, SectionTitle } from "@/components/ui";
import type { HomeProps } from "./types";

export async function NeedsYou({ user }: HomeProps) {
  const tasks = await inbox(user);
  const waiting = tasks.filter((t) => t.kind === "act").reduce((a, t) => a + t.count, 0);
  return (
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
  );
}
