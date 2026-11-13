import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { pendingScrap } from "@/server/services/scrap";
import { pdiQueue } from "@/server/services/pdi";
import { rejectedLots } from "@/server/services/rtv";
import { isQualityTab, qualityHref, qualityTabs, QUALITY_TAB_LABEL, type QualityTab } from "@/lib/quality-tabs";
import { Flash } from "@/components/flash";
import { Chips, PageHeader } from "@/components/ui";
import { InwardTab } from "./tabs/inward";
import { ScrapTab } from "./tabs/scrap";
import { PdiTab } from "./tabs/pdi";
import { FirstOffTab } from "./tabs/firstoff";
import { ReturnsTab } from "./tabs/returns";

export const instant = false;

export default async function Quality({
  searchParams,
}: { searchParams: Promise<{ tab?: string; q?: string; lot?: string; error?: string; ok?: string }> }) {
  const user = await requireView("quality");
  const { tab, q, lot, error, ok } = await searchParams;
  const allowed = qualityTabs(user.permissions);
  const active: QualityTab | undefined = isQualityTab(tab) && allowed.includes(tab) ? tab : allowed[0];

  // A count beside each tab the user can open, so the queue is visible before opening it.
  const counts: Record<QualityTab, () => Promise<number>> = {
    inward: () => db.lot.count({ where: { qcStatus: "PENDING_QC" } }),
    scrap: async () => (await pendingScrap()).length,
    pdi: async () => (await pdiQueue()).filter((l) => l.status === "PENDING").length,
    firstoff: () => db.firstOff.count({ where: { status: "PENDING" } }),
    rtv: async () => (await rejectedLots()).length,
  };
  const n = await Promise.all(allowed.map((t) => counts[t]()));

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="QUALITY" title="Quality" subtitle="Inspections, scrap decisions, final release and returns." />
      <Flash error={error} ok={ok} />
      {allowed.length > 1 && (
        <Chips chips={allowed.map((t, i) => ({ href: qualityHref(t), label: QUALITY_TAB_LABEL[t], active: t === active, n: n[i] }))} />
      )}
      {active === "inward" && <InwardTab q={q} lot={lot} />}
      {active === "scrap" && <ScrapTab />}
      {active === "pdi" && <PdiTab />}
      {active === "firstoff" && <FirstOffTab user={user} />}
      {active === "rtv" && <ReturnsTab />}
    </div>
  );
}
