import { requirePermission } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { NAV_GROUPS } from "@/components/nav-data";
import { Badge, Eyebrow, ListRow, PageHeader } from "@/components/ui";

export const instant = false;

export default async function MorePage() {
  const user = await requirePermission("stock.view");
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => !n.perm || can(user.role, n.perm)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="PLANT 2 · MOULDING SHOP" title="More" />
      {groups.map((g) => (
        <section key={g.name} className="space-y-1.5">
          <Eyebrow>{g.name}</Eyebrow>
          <div className="overflow-hidden rounded-[14px] bg-white">
            {g.items.map((n) => (
              <ListRow
                key={n.href}
                href={n.href}
                bar={n.bar}
                title={n.name}
                sub={n.what}
                right={n.stub ? <Badge tone="info">Soon</Badge> : n.sample ? <Badge tone="neutral">Sample</Badge> : undefined}
              />
            ))}
          </div>
        </section>
      ))}
      <p className="text-center text-xs text-ink-3">Home, Process, Orders and Metrics are in the tab bar.</p>
    </div>
  );
}
