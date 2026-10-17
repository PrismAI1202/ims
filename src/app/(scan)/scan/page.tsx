import Link from "next/link";
import { requirePermission } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";

export const instant = false;

export default async function ScanHome() {
  const user = await requirePermission("stock.view");
  const tiles = [
    { href: "/scan/issue", label: "Issue to shop floor", perm: "stock.issue" as const },
    { href: "/scan/transfer", label: "Bin transfer / put-away", perm: "stock.transfer" as const },
  ].filter((t) => can(user.role, t.perm));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Scan with a handheld or the phone camera. Scans made offline are saved here and sent when you reconnect.</p>
      {tiles.length === 0 && <p className="text-sm text-slate-500">Your role has no scanner actions.</p>}
      {tiles.map((t) => (
        <Link key={t.href} href={t.href} className="block rounded-lg border bg-white p-5 text-base font-medium shadow-sm">{t.label}</Link>
      ))}
    </div>
  );
}
