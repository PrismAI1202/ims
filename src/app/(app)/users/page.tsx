import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { createUser, resetPassword, ROLES, updateUser } from "@/server/services/users";
import { btnCls, Flash, inputCls } from "@/components/flash";

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

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requirePermission("users.manage");
  const { error, ok } = await searchParams;
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="max-w-3xl text-sm text-slate-600">Create logins for plant staff and set their role. Users are deactivated, never deleted, so history keeps its names. There must always be one active admin.</p>
      <Flash error={error} ok={ok} />

      <form action={create} className="grid max-w-4xl gap-3 rounded-lg border bg-white p-4 md:grid-cols-5">
        <label className="text-sm">Name<input name="name" required className={inputCls} /></label>
        <label className="text-sm">Email<input name="email" type="email" required autoComplete="off" className={inputCls} /></label>
        <label className="text-sm">Role
          <select name="role" className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </label>
        <label className="text-sm">Initial password<input name="password" type="text" required minLength={8} autoComplete="off" className={inputCls} /></label>
        <div className="flex items-end"><button className={btnCls}>Add user</button></div>
      </form>

      <div className="space-y-3">
        {users.map((u) => (
          <div key={u.id} className={`max-w-4xl rounded-lg border bg-white p-4 ${u.active ? "" : "opacity-60"}`}>
            <form action={save} className="grid items-end gap-3 md:grid-cols-5">
              <input type="hidden" name="id" value={u.id} />
              <label className="text-sm">Name<input name="name" defaultValue={u.name} className={inputCls} /></label>
              <div className="text-sm"><div className="text-xs text-slate-500">Email</div><div className="py-2">{u.email}</div></div>
              <label className="text-sm">Role
                <select name="role" defaultValue={u.role} className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm"><input name="active" type="checkbox" defaultChecked={u.active} className="h-4 w-4" /> Active{u.id === me.id && " (you)"}</label>
              <div><button className={btnCls}>Save</button></div>
            </form>
            <form action={reset} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
              <input type="hidden" name="id" value={u.id} />
              <label className="text-xs text-slate-600">Reset password<input name="password" type="text" minLength={8} autoComplete="off" placeholder="new password" className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm" /></label>
              <button className="text-xs underline">Reset</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
