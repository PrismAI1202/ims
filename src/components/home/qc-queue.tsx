import Link from "next/link";
import { qcQueue } from "@/server/services/home";
import { can } from "@/server/auth/permissions";
import { qualityHref, type QualityTab } from "@/lib/quality-tabs";
import { Card, SectionTitle } from "@/components/ui";
import type { HomeProps } from "./types";

export async function QcQueue({ user }: HomeProps) {
  const q = await qcQueue();
  // Only the queues this user's role can act on (each Quality tab has its own permission).
  const tiles: { tab: QualityTab; label: string; n: number; sub: string; perm: "qc.inspect" | "firstoff.approve" | "pdi.release" | "scrap.approve" }[] = [
    { tab: "inward", label: "Inward", n: q.inward.n, sub: q.inward.oldest ? `oldest ${q.inward.oldest}` : "nothing waiting", perm: "qc.inspect" },
    { tab: "firstoff", label: "First-off", n: q.firstOff, sub: "set-ups to check", perm: "firstoff.approve" },
    { tab: "pdi", label: "Final (PDI)", n: q.pdi, sub: "FG lots to release", perm: "pdi.release" },
    { tab: "scrap", label: "Scrap", n: q.scrap, sub: "rejects to decide", perm: "scrap.approve" },
  ];
  const tabs = tiles.filter((t) => can(user, t.perm));
  if (tabs.length === 0) return null;
  return (
    <Card className="space-y-3">
      <SectionTitle>QC queue</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {tabs.map((t) => (
          <Link key={t.tab} href={qualityHref(t.tab)} className={`flex min-h-20 flex-col justify-between rounded-xl px-3.5 py-3 ${t.n ? "bg-accent text-white" : "bg-canvas text-ink"}`}>
            <span className="text-xs font-semibold opacity-85">{t.label}</span>
            <span className="font-display text-2xl font-extrabold">{t.n.toLocaleString()}</span>
            <span className="text-[11px] opacity-80">{t.sub}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
