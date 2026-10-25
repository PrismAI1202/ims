import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, signOut } from "@/auth";
import { can } from "@/server/auth/permissions";
import { BottomNav } from "@/components/bottom-nav";
import { SideNav } from "@/components/side-nav";
import { NAV_GROUPS } from "@/components/nav-data";
import { roleLabel } from "@/components/ui";

export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection(); // session reads are request-time; opt out of prerendering
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => !n.perm || can(role, n.perm)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-canvas md:flex">
      <aside className="hidden bg-shell p-4 text-on-shell md:block md:min-h-screen md:w-64 md:flex-none">
        <div className="font-mono text-xs tracking-[0.06em] text-on-shell-2">PLANT 2 · MOULDING SHOP</div>
        <div className="font-display text-xl font-extrabold">IMS · Moulding</div>
        <SideNav groups={groups} />
        <form
          className="mt-6 border-t border-shell-line pt-4 text-xs text-on-shell-2"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <div className="text-sm text-on-shell">{session.user.name}</div>
          <div className="mb-2">{roleLabel(role)}</div>
          <button className="min-h-9 rounded-lg bg-on-shell px-3 font-semibold text-ink">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-4 pb-28 md:p-8 md:pb-8">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
