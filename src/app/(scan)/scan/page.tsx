import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePermission } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";

export const instant = false;

export default async function ScanHome() {
  const user = await requirePermission("stock.view");
  const tiles = [
    { href: "/scan/issue", label: "Issue to shop floor", sub: "FIFO lot scan", perm: "stock.issue" as const },
    { href: "/scan/transfer", label: "Bin transfer / put-away", sub: "Move between bins", perm: "stock.transfer" as const },
    { href: "/scan/dispatch", label: "Load a dispatch", sub: "Scan boxes", perm: "dispatch.manage" as const },
  ].filter((t) => can(user.role, t.perm));

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">Scan with a handheld or the phone camera. Scans made offline are saved here and sent when you reconnect.</p>
      {tiles.length === 0 && <p className="text-sm text-ink-3">Your role has no scanner actions.</p>}
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t, i) => (
          <Link key={t.href} href={t.href}
            className={`flex min-h-24 flex-col justify-between gap-1.5 rounded-xl px-3.5 py-3 ${i === 0 ? "bg-accent text-white" : "bg-white text-ink"}`}>
            <span className="text-[15px] font-semibold">{t.label}</span>
            <span className="flex items-center justify-between text-xs opacity-85">{t.sub} <ChevronRight size={16} aria-hidden /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
