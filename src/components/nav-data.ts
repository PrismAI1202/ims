import { VIEW_GROUPS, VIEWS, type ViewKey } from "@/lib/views";

export type NavItem = {
  href: string;
  name: string;
  what: string;
  bar: string;
  view?: ViewKey; // omitted: open to every signed-in user
  stub?: boolean; // not built yet
};

export type NavGroup = { name: string; items: NavItem[] };

/** Module groups from the design's "More" screen, built from the view catalog. */
export const NAV_GROUPS: NavGroup[] = [
  ...VIEW_GROUPS.map((g) => ({
    name: g,
    items: VIEWS.filter((v) => v.group === g).map((v) => ({ href: v.href, name: v.name, what: v.what, bar: v.bar, view: v.key })),
  })),
  {
    name: "DEVICE",
    items: [
      { href: "/account", name: "Account", what: "Password, notifications and offline sync for this device", bar: "#585C63" },
    ],
  },
];

/** The groups and items a user's views allow. */
export function navFor(views: readonly string[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => !n.view || views.includes(n.view)) })).filter((g) => g.items.length > 0);
}

export type Tab = { href: string; label: string; view?: ViewKey };

const TAB_LABEL: Partial<Record<ViewKey, string>> = {
  masters: "Masters", settings: "Settings", partners: "Partners", equivalents: "Grades", demand: "Demand",
  mrp: "MRP", grn: "Receive", quality: "Quality", issue: "Issue", stock: "Stores", requests: "Requests", production: "Book", fg: "Pack",
  maintenance: "Maint.", returnables: "Crates", trace: "Trace", variance: "Variance", scan: "Scan",
};

/** Phone tab bar: Home, the first three screens of the user's role (in the role's own order), then More. */
export function tabsFor(views: readonly ViewKey[]): Tab[] {
  const picks = views.slice(0, 3).map((key) => {
    const v = VIEWS.find((x) => x.key === key)!;
    return { href: v.href, label: TAB_LABEL[key] ?? v.name, view: key };
  });
  return [{ href: "/dashboard", label: "Home" }, ...picks, { href: "/more", label: "More" }];
}
