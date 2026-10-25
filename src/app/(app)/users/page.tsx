import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createUser, resetPassword, ROLES, updateUser } from "@/server/services/users";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Eyebrow, PageHeader } from "@/components/ui";

export const instant = false;

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin", STORE_INCHARGE: "Store Incharge", QA_INSPECTOR: "QA Inspector", PRODUCTION_LEAD: "Production Lead", DISPATCH_OFFICER: "Dispatch Officer",
};

async function create(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  await runAction("/users", "User created. Share the password with them securely and ask them to change it.", async () => {
    await createUser({
      email: String(formData.get("email") || ""), name: String(formData.get("name") || ""),
      role: String(formData.get("role") || ""), password: String(formData.get("password") || ""),
    });
  });
}

async function save(formData: FormData) {
  "use server";
  const actor = await requirePermission("users.manage");
  await runAction("/users", "User updated.", async () => {
    await updateUser(String(formData.get("id")), actor.id, {
      name: String(formData.get("name") || ""), role: String(formData.get("role") || ""), active: formData.get("active") === "on",
    });
  });
}

async function reset(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  await runAction("/users", "Password reset. That user's scanner tokens were revoked.", async () => {
    await resetPassword(String(formData.get("id")), String(formData.get("password") || ""));
  });
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string }> }) {
  const me = await requirePermission("users.manage");
  const { error, ok, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const everyone = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const users = everyone.filter((u) => matches(q, u.name, u.email, ROLE_LABEL[u.role]));

  return (
    <CreateProvider>
    <div className="space-y-4">
      <PageHeader right={<CreateButton label="New user" />} eyebrow="ADMIN" title="Users & roles" subtitle={`${everyone.filter((u) => u.active).length} active · ${everyone.filter((u) => !u.active).length} inactive`} />
      <p className="max-w-3xl text-sm text-ink-2">Create logins for plant staff and set their role. Users are deactivated, never deleted, so history keeps its names. There must always be one active admin.</p>
      <Flash error={error} ok={ok} />
      <CreatePanel>
        <Card className="space-y-3">
          <Eyebrow>NEW USER</Eyebrow>
          <form action={create} className="grid gap-3 md:grid-cols-5">
            <label className="text-[13px]">Name<input name="name" required className={inputCls} /></label>
            <label className="text-[13px]">Email<input name="email" type="email" required autoComplete="off" className={inputCls} /></label>
            <label className="text-[13px]">Role
              <select name="role" className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            </label>
            <label className="text-[13px]">Initial password<input name="password" type="text" required minLength={8} autoComplete="off" className={inputCls} /></label>
            <div className="flex items-end"><button className={`${btnCls} w-full`}>Add user</button></div>
          </form>
        </Card>
      </CreatePanel>


      <SearchBar q={q} placeholder="Search name, email or role" clearHref="/users" />
      <div className="grid gap-3 lg:grid-cols-2">
        {users.map((u) => (
          <article key={u.id} className={`rounded-[14px] bg-white p-4 ${u.active ? "" : "opacity-60"}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-col"><span className="font-semibold">{u.name}</span><span className="truncate text-xs text-ink-3">{u.email}</span></span>
              <Badge tone={u.active ? "ok" : "neutral"}>{u.active ? ROLE_LABEL[u.role] : "Inactive"}</Badge>
            </div>
            <form action={save} className="grid items-end gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={u.id} />
              <label className="text-[13px]">Name<input name="name" defaultValue={u.name} className={inputCls} /></label>
              <label className="text-[13px]">Role
                <select name="role" defaultValue={u.role} className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={u.active} className="size-5 accent-[#c2410c]" /> Active{u.id === me.id && " (you)"}</label>
              <div><button className={`${btnCls} w-full`}>Save</button></div>
            </form>
            <form action={reset} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <input type="hidden" name="id" value={u.id} />
              <label className="text-xs text-ink-2">Reset password<input name="password" type="text" minLength={8} autoComplete="off" placeholder="new password" className="ml-2 min-h-10 rounded-lg border border-border px-2 text-sm" /></label>
              <button className="min-h-10 cursor-pointer text-xs font-semibold text-accent">Reset</button>
            </form>
          </article>
        ))}
      </div>
    </div>
    </CreateProvider>
  );
}
