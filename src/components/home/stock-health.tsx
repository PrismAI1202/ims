import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { stockByItem, supplyByItem } from "@/server/services/stock";
import { supplySteps, type SupplyStep } from "@/server/services/supply-steps";
import { can, canView } from "@/server/auth/permissions";
import { DownloadLink } from "@/components/download-link";
import { Card, Chip, Mono, SectionTitle, StatTile } from "@/components/ui";
import type { HomeProps } from "./types";

const TONE = {
  RED: "bg-danger text-white",
  YELLOW: "bg-[#f5c451] text-[#3a2a00]",
  GREEN: "bg-ok-bg text-ok-ink",
} as const;
const LABEL = { RED: "Below min", YELLOW: "Near ROP", GREEN: "Optimal" } as const;
type Status = keyof typeof TONE;

export async function StockHealth({ user, stockStatus }: HomeProps) {
  const sel: Status = stockStatus === "YELLOW" || stockStatus === "GREEN" ? stockStatus : "RED";
  const [rows, supply] = await Promise.all([stockByItem(), supplyByItem()]);
  const stepsOf = (r: (typeof rows)[number]) => supplySteps(r, supply.get(r.itemId) ?? { openPoQty: 0, toPutAway: 0 });
  // A step links to the first screen on its list that this user's role can open; otherwise it is shown as plain text.
  const linkOf = (st: SupplyStep) => st.links.find((l) => canView(user, l.view) && (!l.perm || can(user, l.perm)))?.href;
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  // Most urgent first: how far below its minimum each item is.
  const shown = rows.filter((r) => r.status === sel).sort((a, b) => a.onHand / Math.max(a.minStock, 1) - b.onHand / Math.max(b.minStock, 1));

  return (
    <>
      <Card className="space-y-3">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <span>
            <SectionTitle>Stock health</SectionTitle>
            <span className="block text-xs text-ink-3">{rows.length} stock items</span>
          </span>
          {canView(user, "stock") && (
            <Link href="/stock" className="flex items-center gap-1 text-[13px] font-semibold text-accent">
              Stores <ChevronRight size={18} aria-hidden />
            </Link>
          )}
        </div>
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
          <div
            tabIndex={0} role="region" aria-label="Stock list"
            className="max-h-[21rem] overflow-y-auto overscroll-contain rounded-xl border border-line px-3 [scrollbar-width:thin]"
          >
            {shown.map((r, i) => (
              <div key={r.itemId} className={`flex flex-col gap-1 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
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
                {stepsOf(r).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {stepsOf(r).map((st) => {
                      const to = linkOf(st);
                      const cls = `inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ${
                        st.todo ? "bg-accent text-white" : "bg-info-bg text-info-ink"
                      }`;
                      return to ? (
                        <Link key={st.kind} href={to} className={cls}>{st.label} <ChevronRight size={14} aria-hidden /></Link>
                      ) : (
                        <span key={st.kind} className={cls}>{st.label}</span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          {shown.length > 5 && <p className="pt-1.5 text-center text-[11px] text-ink-3">Showing the most urgent first · scroll for all {shown.length}</p>}
          {shown.length === 0 && (
            <p className="py-4 text-sm text-ink-3">Nothing {LABEL[sel].toLowerCase()} right now.</p>
          )}
          {canView(user, "stock") && (
            <Link href="/stock" className="flex min-h-11 items-center justify-center gap-1 border-t border-line text-sm font-semibold">
              See Stores · bin map <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      </Card>

      <p className="flex flex-wrap gap-4 text-sm font-semibold text-accent print:hidden">
        <DownloadLink href={"/api/v1/export/stock?format=xlsx"}>Download Excel</DownloadLink>
        <DownloadLink href={"/api/v1/export/stock?format=csv"}>Download CSV</DownloadLink>
        <span className="font-normal text-ink-3">For a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
      </p>
    </>
  );
}
