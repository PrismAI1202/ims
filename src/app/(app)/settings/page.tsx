import Link from "next/link";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { HOME_ACTIONS, PERMISSION_LABELS, resolveAccess, SYSTEM_ROLES, type Permission } from "@/server/auth/permissions";
import { createRole, deleteRole, listRoles, resetRole, updateRole, type RoleInput } from "@/server/services/roles";
import { VIEW_GROUPS, VIEWS } from "@/lib/views";
import { btnCls, btnDangerCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Eyebrow, PageHeader } from "@/components/ui";

export const instant = false;

const at = (key: string) => `/settings?role=${encodeURIComponent(key)}`;

const read = (formData: FormData): RoleInput => ({
  name: String(formData.get("name") || ""),
  description: String(formData.get("description") || ""),
  allAccess: formData.get("allAccess") === "on",
  views: formData.getAll("views").map(String),
  permissions: formData.getAll("permissions").map(String),
});

async function create(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  let key = "";
  await runAction(() => at(key), "Role created. Tick the screens it needs, then save.", async () => {
    // "Start from" copies another role's screens so a new role is a small edit rather than a blank sheet.
    const from = (await listRoles()).find((r) => r.key === String(formData.get("from") || ""));
    const role = await createRole({
      ...read(formData), allAccess: false,
      views: from ? resolveAccess(from).views : ["trace"], permissions: from?.permissions ?? [],
    });
    key = role.key;
  }, "/settings");
}

async function save(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const key = String(formData.get("key"));
  await runAction(at(key), "Role saved. Its users see the change on their next page load.", async () => {
    await updateRole(key, read(formData));
  });
}

async function reset(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const key = String(formData.get("key"));
  await runAction(at(key), "Role reset to its defaults.", async () => {
    await resetRole(key);
  });
}

async function remove(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const key = String(formData.get("key"));
  await runAction("/settings", "Role deleted.", async () => {
    await deleteRole(key);
  }, at(key));
}

function Tick({ name, value, checked, disabled, children }: { name: string; value: string; checked: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex min-h-10 items-center gap-2.5 text-sm ${disabled ? "text-ink-3" : ""}`}>
      <input type="checkbox" name={name} value={value} defaultChecked={checked} disabled={disabled} className="size-5 flex-none accent-[#c2410c]" />
      <span>{children}</span>
    </label>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ role?: string; error?: string; ok?: string }> }) {
  await requireView("settings");
  const { role: sel, error, ok } = await searchParams;
  const roles = await listRoles();
  const role = roles.find((r) => r.key === sel) ?? roles[0];
  const has = (p: Permission) => role.permissions.includes(p);
  const isDefault = SYSTEM_ROLES.some((r) => r.key === role.key);

  return (
    <CreateProvider>
      <div className="space-y-4">
        <PageHeader right={<CreateButton label="New role" />} eyebrow="SETTINGS" title="Roles & access"
          subtitle={`${roles.length} roles · each one decides the menu, the Home tasks and the actions of its users`} />
        <p className="max-w-3xl text-sm text-ink-2">
          Tick the screens a role needs for its shift and nothing else: the menu, the phone tab bar and the Home inbox follow from it.
          A screen brings the permission it can&apos;t work without; the indented boxes are optional extras.
          The first three screens, in the order they were added, become the role&apos;s phone tabs.
        </p>
        <Flash error={error} ok={ok} />

        <CreatePanel>
          <Card className="space-y-3">
            <Eyebrow>NEW ROLE</Eyebrow>
            <form action={create} className="grid gap-3 md:grid-cols-4">
              <label className="text-[13px]">Name<input name="name" required minLength={2} maxLength={40} placeholder="e.g. Shift Supervisor" className={inputCls} /></label>
              <label className="text-[13px] md:col-span-2">What this role does<input name="description" maxLength={200} className={inputCls} /></label>
              <label className="text-[13px]">Start from
                <select name="from" className={inputCls} defaultValue="">
                  <option value="">Blank (Traceability only)</option>
                  {roles.filter((r) => !r.allAccess).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
              </label>
              <div className="md:col-span-4"><button className={btnCls}>Create role</button></div>
            </form>
          </Card>
        </CreatePanel>

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Roles" className="flex flex-col gap-1.5 self-start">
            {roles.map((r) => (
              <Link key={r.key} href={at(r.key)} aria-current={r.key === role.key ? "page" : undefined}
                className={`flex flex-col gap-0.5 rounded-xl border-2 px-3.5 py-2.5 ${r.key === role.key ? "border-accent bg-white" : "border-transparent bg-white hover:border-line"}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.name}</span>
                  {!r.system && <Badge tone="info">Custom</Badge>}
                </span>
                <span className="text-xs text-ink-3">
                  {r.allAccess ? "Every screen" : `${resolveAccess(r).views.length} screens`} · {r.activeUsers} active user{r.activeUsers === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </nav>

          <Card>
            <form action={save} className="space-y-5">
              <input type="hidden" name="key" value={role.key} />
              <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
                <label className="text-[13px]">Name<input name="name" defaultValue={role.name} required minLength={2} maxLength={40} className={inputCls} /></label>
                <label className="text-[13px]">What this role does<input name="description" defaultValue={role.description} maxLength={200} className={inputCls} /></label>
              </div>

              <div className="rounded-xl bg-canvas px-3.5 py-2">
                <Tick name="allAccess" value="on" checked={role.allAccess}>
                  <b>Full access</b> <span className="text-ink-3">· every screen and action, including ones added later (the boxes below are ignored)</span>
                </Tick>
              </div>

              <section className="space-y-1">
                <Eyebrow>HOME</Eyebrow>
                <p className="text-xs text-ink-3">Home, Account and Sync centre are open to everyone. Home shows the role&apos;s task inbox.</p>
                {HOME_ACTIONS.map((p) => <Tick key={p} name="permissions" value={p} checked={has(p)}>{PERMISSION_LABELS[p]}</Tick>)}
              </section>

              {VIEW_GROUPS.map((g) => (
                <section key={g} className="space-y-1">
                  <Eyebrow>{g}</Eyebrow>
                  <ul className="grid gap-x-6 md:grid-cols-2">
                    {VIEWS.filter((v) => v.group === g).map((v) => (
                      <li key={v.key} className="border-t border-line py-1.5">
                        <Tick name="views" value={v.key} checked={role.views.includes(v.key)}>
                          <span className="font-semibold">{v.name}</span>
                          {v.requires && <span className="block text-xs text-ink-3">Includes: {PERMISSION_LABELS[v.requires].toLowerCase()}</span>}
                        </Tick>
                        {(v.actions ?? []).map((p) => (
                          <div key={p} className="pl-7">
                            <Tick name="permissions" value={p} checked={has(p)}><span className="text-[13px]">{PERMISSION_LABELS[p]}</span></Tick>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                <button className={btnCls}>Save role</button>
                {isDefault && <button formAction={reset} formNoValidate className={btnSecondaryCls}>Reset to default</button>}
                {!role.system && (
                  <button formAction={remove} formNoValidate disabled={role.activeUsers > 0} className={`${btnDangerCls} disabled:cursor-not-allowed disabled:opacity-50`}>
                    Delete role
                  </button>
                )}
              </div>
              {!role.system && role.activeUsers > 0 && <p className="text-xs text-ink-3">Move this role&apos;s users to another role on the Users screen before deleting it.</p>}
            </form>
          </Card>
        </div>
      </div>
    </CreateProvider>
  );
}
