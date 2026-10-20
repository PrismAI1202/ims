"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, GitBranch, Home, LayoutGrid } from "lucide-react";
import { TABS } from "./nav-data";

const ICONS = { home: Home, process: GitBranch, orders: FileText, metrics: BarChart3, more: LayoutGrid };

/** Phone-only 5-tab bar. "More" also covers every module screen not in the other four tabs. */
export function BottomNav() {
  const pathname = usePathname();
  const direct = TABS.filter((t) => t.icon !== "more").map((t) => t.href);
  const isActive = (href: string) =>
    href === "/more" ? !direct.some((d) => pathname.startsWith(d)) : pathname.startsWith(href);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-white px-1 pb-5 pt-1.5 md:hidden"
    >
      {TABS.map((t) => {
        const Icon = ICONS[t.icon];
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
