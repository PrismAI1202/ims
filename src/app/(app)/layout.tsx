import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signOut } from "@/auth";
import { can, type Permission } from "@/server/auth/permissions";

export const instant = false;

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/dashboard", label: "Stock Dashboard", perm: "stock.view" },
  { href: "/masters", label: "Masters", perm: "masters.manage" },
  { href: "/purchase", label: "Purchase Orders", perm: "po.manage" },
  { href: "/grn", label: "Gate Entry & GRN", perm: "grn.create" },
  { href: "/qc", label: "QC Queue", perm: "qc.inspect" },
  { href: "/stock", label: "Stock & Bins", perm: "stock.view" },
  { href: "/requests", label: "Material Requests", perm: "request.create" },
  { href: "/issue", label: "Issue to Shop Floor", perm: "stock.issue" },
  { href: "/bom", label: "Moulding BOM", perm: "bom.manage" },
  { href: "/production", label: "Production Booking", perm: "production.book" },
  { href: "/fg", label: "FG & Box Labels", perm: "fg.pack" },
  { href: "/dispatch", label: "Dispatch", perm: "dispatch.manage" },
  { href: "/returnables", label: "Returnable Ledger", perm: "dispatch.manage" },
  { href: "/reports/variance", label: "BOM Variance", perm: "reports.view" },
  { href: "/scan", label: "Scanner", perm: "stock.transfer" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection(); // session reads are request-time; opt out of prerendering
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;

  return (
    <div className="min-h-screen md:flex bg-slate-50">
      <aside className="md:w-60 bg-slate-900 text-slate-100 p-4 md:min-h-screen">
        <div className="font-semibold mb-4">IMS · Moulding</div>
        <nav className="flex md:flex-col gap-1 overflow-x-auto text-sm">
          {NAV.filter((n) => can(role, n.perm)).map((n) => (
            <Link key={n.href} href={n.href}
              className="px-3 py-2 rounded hover:bg-slate-800 whitespace-nowrap">
              {n.label}
            </Link>
          ))}
        </nav>
        <form
          className="mt-6 text-xs text-slate-400"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <div>{session.user.name}</div>
          <div className="mb-2">{role.replace("_", " ")}</div>
          <button className="underline">Sign out</button>
        </form>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
