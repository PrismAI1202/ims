import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { can, canView } from "@/server/auth/permissions";
import { hubTabs, viewDef } from "@/lib/views";
import { Flash } from "@/components/flash";
import { Chips, PageHeader } from "@/components/ui";
import { PackTab } from "./tabs/pack";
import { CratesTab } from "./tabs/crates";

export const instant = false;

const LABEL = { pack: "Pack & label", crates: "Crates" } as const;
type Tab = keyof typeof LABEL;

/** Finished goods: pack and label boxes, keep the crate ledger, and a way into Dispatch (which lives under Orders). */
export default async function FgPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string; status?: string; tab?: string }> }) {
  const user = await requireView("fg");
  const { error, ok, q: rawQ, status, tab } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const allowed = hubTabs(viewDef("fg")!, user.permissions) as Tab[];
  const active = (tab && (allowed as string[]).includes(tab) ? tab : allowed[0]) as Tab;
  const toDispatch = canView(user, "orders") && can(user, "dispatch.manage");
  const ready = toDispatch ? await db.fgBox.count({ where: { status: "IN_STOCK", dispatchId: null, lot: { pdiStatus: { notIn: ["PENDING", "HOLD"] } } } }) : 0;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="STORE & SHOP FLOOR" title="Finished goods" subtitle="Pack and label boxes, keep the crate ledger, send to the customer" />
      <Flash error={error} ok={ok} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {allowed.length > 1 ? <Chips chips={allowed.map((t) => ({ href: `/fg?tab=${t}`, label: LABEL[t], active: t === active }))} /> : <span />}
        {toDispatch && (
          <Link href="/orders?kind=dispatch" className="flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] border-border bg-white px-3.5 text-[13px] font-semibold text-accent">
            Dispatch{ready > 0 && <span className="font-mono text-[11px] text-ink-3">{ready.toLocaleString()} boxes ready</span>} <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      {active === "pack" && <PackTab q={q} status={status} />}
      {active === "crates" && <CratesTab q={q} />}
    </div>
  );
}
