import { requireUser } from "@/server/auth/guard";
import { navFor, tabsFor } from "@/components/nav-data";
import { Badge, Eyebrow, ListRow, PageHeader } from "@/components/ui";

export const instant = false;

export default async function MorePage() {
  const user = await requireUser();
  const inTabs = new Set(tabsFor(user.views).map((t) => t.href));
  const groups = navFor(user.views)
    .map((g) => ({ ...g, items: g.items.filter((n) => !inTabs.has(n.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`PLANT 2 · ${user.roleName.toUpperCase()}`} title="More" />
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
                right={n.stub ? <Badge tone="info">Soon</Badge> : undefined}
              />
            ))}
          </div>
        </section>
      ))}
      <p className="text-center text-xs text-ink-3">The rest of your screens are in the tab bar.</p>
    </div>
  );
}
