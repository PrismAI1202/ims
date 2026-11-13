import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can, canView, type Permission } from "@/server/auth/permissions";
import type { ViewKey } from "@/lib/views";
import { Eyebrow } from "@/components/ui";
import type { HomeProps } from "./types";

const ACTIONS: { href: string; label: string; sub: string; view: ViewKey; perm?: Permission }[] = [
  { href: "/grn", label: "Gate entry / GRN", sub: "Inward", view: "grn" },
  { href: "/issue", label: "Issue to shop floor", sub: "FIFO lot", view: "issue" },
  { href: "/quality?tab=inward", label: "QC queue", sub: "Hold / release", view: "quality", perm: "qc.inspect" },
  { href: "/production", label: "Book production", sub: "Shots, rejects, downtime", view: "production" },
  { href: "/requests", label: "Request material", sub: "To stores", view: "requests" },
  { href: "/fg", label: "Pack & label", sub: "FG boxes", view: "fg" },
  { href: "/orders?new=dispatch", label: "Dispatch", sub: "Pick, load, DC", view: "orders", perm: "dispatch.manage" },
  { href: "/orders?new=po", label: "Supplier PO", sub: "Raise / receive", view: "orders", perm: "po.manage" },
  { href: "/stock", label: "Bin transfer", sub: "Move between bins", view: "stock" },
  { href: "/scan", label: "Scanner", sub: "Works offline", view: "scan" },
];

export function QuickActions({ user }: HomeProps) {
  const actions = ACTIONS.filter((a) => canView(user, a.view) && (!a.perm || can(user, a.perm))).slice(0, 4);
  if (actions.length === 0) return null;
  return (
    <section className="space-y-2">
      <Eyebrow>Quick actions</Eyebrow>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {actions.map((a, i) => (
          <Link key={a.href} href={a.href}
            className={`flex min-h-16 flex-col justify-between gap-1.5 rounded-xl px-3.5 py-3 ${i === 0 ? "bg-accent text-white" : "bg-white text-ink"}`}>
            <span className="text-[15px] font-semibold">{a.label}</span>
            <span className="flex items-center justify-between text-xs opacity-85">{a.sub} <ChevronRight size={16} aria-hidden /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}
