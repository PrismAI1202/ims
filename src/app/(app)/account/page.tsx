import { requirePermission, runAction } from "@/server/auth/guard";
import { changeOwnPassword } from "@/server/services/users";
import { DomainError } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function change(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.view"); // any signed-in role
  await runAction("/account", "Password changed.", async () => {
    const next = String(formData.get("next") || "");
    if (next !== String(formData.get("confirm") || "")) throw new DomainError("The new passwords don't match.");
    await changeOwnPassword(user.id, String(formData.get("current") || ""), next);
  });
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requirePermission("stock.view");
  const { error, ok } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My account</h1>
      <p className="text-sm text-slate-600">{user.name} · {user.email}</p>
      <Flash error={error} ok={ok} />
      <form action={change} className="max-w-md space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-medium">Change password</h2>
        <label className="block text-sm">Current password<input name="current" type="password" required autoComplete="current-password" className={inputCls} /></label>
        <label className="block text-sm">New password (at least 8 characters)<input name="next" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></label>
        <label className="block text-sm">Confirm new password<input name="confirm" type="password" required autoComplete="new-password" className={inputCls} /></label>
        <button className={btnCls}>Change password</button>
      </form>
    </div>
  );
}
