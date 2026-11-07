"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Boxes, ClipboardList, Factory, FileText, FlaskConical, GitBranch, Home, LayoutGrid, PackageCheck, PackageOpen,
  Route, ScanLine, Settings, ShoppingCart, Trash2, Truck, Users, Wrench, type LucideIcon,
} from "lucide-react";
import type { Tab } from "./nav-data";
import type { ViewKey } from "@/lib/views";

const ICONS: Partial<Record<ViewKey, LucideIcon>> = {
  process: GitBranch, orders: FileText, metrics: BarChart3, masters: Settings, users: Users, settings: Settings,
  partners: Users, bom: ClipboardList, equivalents: FlaskConical, demand: ClipboardList, mrp: ClipboardList, purchase: ShoppingCart,
  grn: PackageOpen, qc: FlaskConical, scrap: Trash2, stock: Boxes, requests: ClipboardList, issue: PackageCheck, scan: ScanLine,
  production: Factory, fg: PackageCheck, planning: ClipboardList, maintenance: Wrench, dispatch: Truck, returnables: Truck,
  trace: Route, variance: BarChart3,
};

/** Phone-only tab bar; the tabs depend on the user's role. "More" also covers every screen not in the other tabs. */
export function BottomNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const direct = tabs.filter((t) => t.href !== "/more").map((t) => t.href);
  // The longest matching tab wins, so /qc/scrap lights Scrap rather than QC.
  const best = direct.filter((d) => pathname.startsWith(d)).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => (href === "/more" ? !best : href === best);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-border bg-white px-1 pb-5 pt-1.5 md:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => {
        const Icon = t.href === "/dashboard" ? Home : t.href === "/more" ? LayoutGrid : (t.view && ICONS[t.view]) || LayoutGrid;
        const on = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-13 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${on ? "text-accent" : "text-ink-3"}`}
          >
            <Icon size={22} strokeWidth={2} aria-hidden />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
