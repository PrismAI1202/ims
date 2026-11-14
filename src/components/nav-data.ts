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

/**
 * What goes in the menus. Material requests and Gate entry & GRN are tabs of Stores, so a role that has Stores reaches them from there
 * and does not get a second menu entry; a role without Stores (Production for requests) still gets the entry, or it could not reach it.
 */
const STORES_TABS = ["requests", "grn"];
// The scanner is never a menu entry: the camera is a button inside the steps that need it (searches, issue, transfer, loading).
// The offline scanner screens at /scan are reached from those steps, and the view still controls who may use them.
const NEVER_IN_MENUS = ["scan"];
export function menuViews<T extends string>(views: readonly T[]): T[] {
  return views.filter((v) => !NEVER_IN_MENUS.includes(v) && !(STORES_TABS.includes(v) && views.includes("stock" as T)));
}

/** A page that has no menu entry of its own lights the entry of the screen it lives in. */
export const NAV_PARENT: Record<string, string> = { "/requests": "/stock", "/grn": "/stock" };
export const litPath = (pathname: string, hrefs: readonly string[]) =>
  [...hrefs].filter((h) => pathname.startsWith(h)).sort((a, b) => b.length - a.length)[0]
  ?? hrefs.find((h) => Object.entries(NAV_PARENT).some(([child, parent]) => pathname.startsWith(child) && h === parent));

/** The groups and items a user's views allow. */
export function navFor(allViews: readonly string[]): NavGroup[] {
  const views = menuViews(allViews);
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => !n.view || views.includes(n.view)) })).filter((g) => g.items.length > 0);
}

export type Tab = { href: string; label: string; view?: ViewKey };

const TAB_LABEL: Partial<Record<ViewKey, string>> = {
  masters: "Masters", settings: "Settings", partners: "Partners", demand: "Demand",
  mrp: "MRP", grn: "Receive", quality: "Quality", stock: "Stores", requests: "Requests", bom: "BOMs", production: "Book", fg: "Goods",
  maintenance: "Maint.", trace: "Trace", scan: "Scan",
};

/** Phone tab bar: Home, the first three screens of the user's role (in the role's own order), then More. */
export function tabsFor(allViews: readonly ViewKey[]): Tab[] {
  const picks = menuViews(allViews).slice(0, 3).map((key) => {
    const v = VIEWS.find((x) => x.key === key)!;
    return { href: v.href, label: TAB_LABEL[key] ?? v.name, view: key };
  });
  return [{ href: "/dashboard", label: "Home" }, ...picks, { href: "/more", label: "More" }];
}
