"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "./nav-data";

/** Desktop sidebar; groups arrive already filtered by permission. */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Modules" className="mt-5 flex flex-col gap-4 text-sm">
      <Link
        href="/dashboard"
        className={`rounded-lg px-3 py-2 font-semibold ${pathname.startsWith("/dashboard") ? "bg-shell-2 text-accent" : "text-on-shell hover:bg-shell-2"}`}
      >
        Home · Stock health
      </Link>
      <div className="flex flex-col gap-0.5">
        <div className="px-3 pb-1 font-mono text-[11px] tracking-[0.08em] text-on-shell-2">OVERVIEW</div>
        {[
          { href: "/process", name: "Process", bar: "#C2410C" },
          { href: "/trace", name: "Orders & traceability", bar: "#1D4ED8" },
          { href: "/metrics", name: "Metrics", bar: "#1E7A46" },
        ].map((n) => (
          <Link key={n.href} href={n.href}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 ${pathname.startsWith(n.href) ? "bg-shell-2 font-semibold text-accent" : "text-on-shell hover:bg-shell-2"}`}>
            <span className="h-4 w-1 flex-none rounded-sm" style={{ background: n.bar }} />
            <span className="flex-1">{n.name}</span>
          </Link>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.name} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 font-mono text-[11px] tracking-[0.08em] text-on-shell-2">{g.name}</div>
          {g.items.map((n) => {
            const on = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 ${on ? "bg-shell-2 font-semibold text-accent" : "text-on-shell hover:bg-shell-2"}`}
              >
                <span className="h-4 w-1 flex-none rounded-sm" style={{ background: n.bar }} />
                <span className="flex-1">{n.name}</span>
                {n.stub && <span className="text-[10px] text-on-shell-2">Soon</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
