import { requirePermission, runAction } from "@/server/auth/guard";
import { changeOwnPassword } from "@/server/services/users";
import { DomainError } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Card, PageHeader } from "@/components/ui";

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
      <PageHeader eyebrow="DEVICE" title="My account" subtitle={`${user.name} · ${user.email}`} />
      <Flash error={error} ok={ok} />
      <Card className="max-w-md">
        <form action={change} className="space-y-3">
          <h2 className="font-display text-base font-bold">Change password</h2>
          <label className="block text-[13px]">Current password<input name="current" type="password" required autoComplete="current-password" className={inputCls} /></label>
          <label className="block text-[13px]">New password (at least 8 characters)<input name="next" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></label>
          <label className="block text-[13px]">Confirm new password<input name="confirm" type="password" required autoComplete="new-password" className={inputCls} /></label>
          <button className={`${btnCls} w-full`}>Change password</button>
        </form>
      </Card>
    </div>
  );
}
