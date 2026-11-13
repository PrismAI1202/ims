import { ReasonButton } from "@/components/notice";
import { Form } from "@/components/form";
import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, requireView, runAction } from "@/server/auth/guard";
import { HOME_ACTIONS, PERMISSION_LABELS, resolveAccess, SYSTEM_ROLES, type Permission } from "@/server/auth/permissions";
import { createRole, deleteRole, listRoles, resetRole, updateRole, type RoleInput } from "@/server/services/roles";
import { createUser, resetPassword, updateUser } from "@/server/services/users";
import { hubTabs, levelOf, levelPermissions, VIEW_GROUPS, VIEWS } from "@/lib/views";
import { HOME_WIDGETS } from "@/lib/home-widgets";
import { getRule, PLANT_RULES, setRule, type PlantRule } from "@/server/services/settings";
import { btnCls, btnDangerCls, btnSecondaryCls, Flash, inputCls } from "@/components/flash";
import { CreateButton, CreatePanel, CreateProvider } from "@/components/new-panel";
import { Badge, Card, Chips, Eyebrow, PageHeader } from "@/components/ui";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { ViewAccessRow } from "@/components/view-access-row";
import { HubAccessRow } from "@/components/hub-access-row";

export const instant = false;

type Tab = "access" | "people";
const at = (key: string, tab: Tab = "access") => `/settings?role=${encodeURIComponent(key)}${tab === "people" ? "&tab=people" : ""}`;

// Ticked Home widgets, ordered by the position typed next to each (ties and blanks keep the list's own order).
function readHome(formData: FormData): string[] {
  return formData.getAll("home").map(String)
    .map((key, i) => ({ key, i, pos: Number(formData.get(`pos_${key}`)) || 1000 }))
    .sort((a, b) => a.pos - b.pos || a.i - b.i)
    .map((w) => w.key);
}

// What a role does in each hub screen (Quality, Material requests, Finished goods), for its card in the role list.
function hubLines(r: NonNullable<Parameters<typeof resolveAccess>[0]>): string[] {
  const a = resolveAccess(r);
  return VIEWS.filter((v) => v.tabs && a.views.includes(v.key)).map((v) => {
    const slugs = hubTabs(v, a.permissions);
    return `${v.name}: ${r.allAccess ? "everything" : slugs.map((s) => v.tabs!.find((t) => t.tab === s)!.label).join(" · ")}`;
  });
}

const read = (formData: FormData): RoleInput => ({
  name: String(formData.get("name") || ""),
  description: String(formData.get("description") || ""),
  allAccess: formData.get("allAccess") === "on",
  views: formData.getAll("views").map(String),
  // Screens granted as a ladder (Stores) post their rung as `level_<screen>`; it adds the permissions for that rung.
  permissions: [
    ...formData.getAll("permissions").map(String),
    ...VIEWS.filter((v) => v.levels).flatMap((v) => levelPermissions(v, Number(formData.get(`level_${v.key}`)) || 0)),
  ],
  home: readHome(formData),
});

async function saveRules(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  return runAction("/settings", "Plant rules saved.", async () => {
    for (const rule of Object.keys(PLANT_RULES) as PlantRule[]) await setRule(rule, formData.get(rule) === "on");
  });
}

async function create(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  let key = "";
  return runAction(() => at(key), "Role created. Tick the screens it needs, then save.", async () => {
    // "Start from" copies another role's screens so a new role is a small edit rather than a blank sheet.
    const from = (await listRoles()).find((r) => r.key === String(formData.get("from") || ""));
    const role = await createRole({
      ...read(formData), allAccess: false,
      views: from ? resolveAccess(from).views : ["trace"], permissions: from?.permissions ?? [], home: from?.home ?? ["needs-you"],
    });
    key = role.key;
  }, "/settings");
}

async function save(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const key = String(formData.get("key"));
  return runAction(at(key), "Role saved. Its users see the change on their next page load.", async () => {
    await updateRole(key, read(formData));
  });
}

async function reset(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const key = String(formData.get("key"));
  return runAction(at(key), "Role reset to its defaults.", async () => {
    await resetRole(key);
  });
}

async function remove(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const key = String(formData.get("key"));
  return runAction("/settings", "Role deleted.", async () => {
    await deleteRole(key);
  }, at(key));
}

// People: the users in a role. Adding, editing and password resets used to be a separate Users screen.
async function addUser(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  const role = String(formData.get("role") || "");
  return runAction(at(role, "people"), "User added. Share the password securely and ask them to change it from Account.", async () => {
    await createUser({
      email: String(formData.get("email") || ""), name: String(formData.get("name") || ""),
      role, password: String(formData.get("password") || ""),
    });
  });
}

async function saveUser(formData: FormData) {
  "use server";
  const actor = await requirePermission("users.manage");
  const from = String(formData.get("from") || "");
  const to = String(formData.get("role") || "");
  return runAction(at(from, "people"), to === from ? "User updated." : "User updated and moved to the other role.", async () => {
    await updateUser(String(formData.get("id")), actor.id, {
      name: String(formData.get("name") || ""), role: to, active: formData.get("active") === "on",
    });
  });
}

async function resetUserPassword(formData: FormData) {
  "use server";
  await requirePermission("users.manage");
  return runAction(at(String(formData.get("from") || ""), "people"), "Password reset. That user's scanner tokens were revoked.", async () => {
    await resetPassword(String(formData.get("id")), String(formData.get("password") || ""));
  });
}

function Tick({ name, value, checked, disabled, children }: { name: string; value: string; checked: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex min-h-10 items-center gap-2.5 text-sm ${disabled ? "text-ink-3" : ""}`}>
      <input type="checkbox" name={name} value={value} defaultChecked={checked} disabled={disabled} className="size-5 flex-none accent-[#c2410c]" />
      <span>{children}</span>
    </label>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ role?: string; tab?: string; q?: string; error?: string; ok?: string }> }) {
  const me = await requireView("settings");
  const { role: sel, tab: rawTab, q: rawQ, error, ok } = await searchParams;
  const tab: Tab = rawTab === "people" ? "people" : "access";
  const q = rawQ?.trim() || undefined;
  const [roles, rules] = await Promise.all([listRoles(), Promise.all((Object.keys(PLANT_RULES) as PlantRule[]).map(async (r) => [r, await getRule(r)] as const))]);
  const role = roles.find((r) => r.key === sel) ?? roles[0];
  const has = (p: Permission) => role.permissions.includes(p);
  const isDefault = SYSTEM_ROLES.some((r) => r.key === role.key);
  const people = tab === "people" ? await db.user.findMany({ where: { role: role.key }, orderBy: [{ active: "desc" }, { name: "asc" }] }) : [];
  const shownPeople = people.filter((u) => matches(q, u.name, u.email));

  return (
    <CreateProvider>
      <div className="space-y-4">
        <PageHeader right={<CreateButton label="New role" />} eyebrow="SETTINGS" title="Roles & users"
          subtitle={`${roles.length} roles · each decides the menu, the Home tasks and the actions of the people in it`} />
        <p className="max-w-3xl text-sm text-ink-2">
          Tick the screens a role needs for its shift and nothing else: the menu, the phone tab bar and the Home inbox follow from it.
          A screen brings the permission it can&apos;t work without; the indented boxes are optional extras.
          The first three screens, in the order they were added, become the role&apos;s phone tabs. Several people can share a role: add them, change their role and reset passwords on the People tab.
        </p>
        <Flash error={error} ok={ok} />

        <Card className="space-y-2">
          <Eyebrow>PLANT RULES</Eyebrow>
          <Form action={saveRules} className="space-y-1">
            {rules.map(([rule, on]) => <Tick key={rule} name={rule} value="on" checked={on}>{PLANT_RULES[rule].label}</Tick>)}
            <button className={`${btnSecondaryCls} mt-1`}>Save rules</button>
          </Form>
        </Card>

        <CreatePanel>
          <Card className="space-y-3">
            <Eyebrow>NEW ROLE</Eyebrow>
            <Form action={create} className="grid gap-3 md:grid-cols-4">
              <label className="text-[13px]">Name<input name="name" required minLength={2} maxLength={40} placeholder="e.g. Shift Supervisor" className={inputCls} /></label>
              <label className="text-[13px] md:col-span-2">What this role does<input name="description" maxLength={200} className={inputCls} /></label>
              <label className="text-[13px]">Start from
                <select name="from" className={inputCls} defaultValue="">
                  <option value="">Blank (Traceability only)</option>
                  {roles.filter((r) => !r.allAccess).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
              </label>
              <div className="md:col-span-4"><button className={btnCls}>Create role</button></div>
            </Form>
          </Card>
        </CreatePanel>

        {/* Phones: one swipeable row of role filters, so the editor sits right under it instead of below a long list. */}
        <nav aria-label="Roles" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden">
          <div className="flex w-max gap-1.5">
            {roles.map((r) => {
              const on = r.key === role.key;
              return (
                <Link key={r.key} href={at(r.key, tab)} scroll={false} aria-current={on ? "page" : undefined}
                  className={`flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold ${
                    on ? "border-ink bg-ink text-white" : "border-border bg-white text-ink"
                  }`}>
                  {r.name}
                  <span className="font-mono text-[11px] opacity-70">{r.activeUsers}</span>
                </Link>
              );
            })}
          </div>
        </nav>
        <p className="text-xs text-ink-3 lg:hidden">
          {role.allAccess ? "Every screen" : `${resolveAccess(role).views.length} screens`} · {role.activeUsers} active user{role.activeUsers === 1 ? "" : "s"}
          {!role.system && " · Custom"}
        </p>
        {hubLines(role).map((l) => <p key={l} className="text-xs text-ink-2 lg:hidden">{l}</p>)}

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Roles" className="hidden flex-col gap-1.5 self-start lg:flex">
            {roles.map((r) => (
              <Link key={r.key} href={at(r.key, tab)} aria-current={r.key === role.key ? "page" : undefined}
                className={`flex flex-col gap-0.5 rounded-xl border-2 px-3.5 py-2.5 ${r.key === role.key ? "border-accent bg-white" : "border-transparent bg-white hover:border-line"}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.name}</span>
                  {!r.system && <Badge tone="info">Custom</Badge>}
                </span>
                <span className="text-xs text-ink-3">
                  {r.allAccess ? "Every screen" : `${resolveAccess(r).views.length} screens`} · {r.activeUsers} active user{r.activeUsers === 1 ? "" : "s"}
                </span>
                {hubLines(r).map((l) => <span key={l} className="text-xs text-ink-2">{l}</span>)}
              </Link>
            ))}
          </nav>

          <div className="min-w-0 space-y-3">
          <Chips chips={[
            { href: at(role.key), label: "Access & Home", active: tab === "access" },
            { href: at(role.key, "people"), label: "People", n: role.activeUsers, active: tab === "people" },
          ]} />
          {tab === "people" ? (
            <Card className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-bold">People in {role.name}</h2>
                  <p className="text-xs text-ink-3">{role.activeUsers} active · {people.filter((u) => !u.active).length} inactive. Users are deactivated, never deleted, so history keeps their names. There must always be one active admin.</p>
                </div>
              </div>

              <Form action={addUser} className="grid gap-3 rounded-xl border-2 border-dashed border-border p-3 md:grid-cols-5">
                <input type="hidden" name="role" value={role.key} />
                <p className="text-[13px] font-semibold md:col-span-5">Add someone to {role.name}</p>
                <label className="text-[13px]">Name<input name="name" required className={inputCls} /></label>
                <label className="text-[13px] md:col-span-2">Email<input name="email" type="email" required autoComplete="off" className={inputCls} /></label>
                <label className="text-[13px]">Initial password<input name="password" type="text" required minLength={8} autoComplete="off" className={inputCls} /></label>
                <div className="flex items-end"><button className={`${btnCls} w-full`}>Add user</button></div>
              </Form>

              {people.length > 6 && <SearchBar q={q} placeholder="Search name or email" keep={{ role: role.key, tab: "people" }} clearHref={at(role.key, "people")} />}
              {shownPeople.length === 0 && <p className="text-sm text-ink-3">{people.length === 0 ? "Nobody has this role yet." : "No one matches that search."}</p>}
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {shownPeople.map((u) => (
                  <li key={u.id} className={u.active ? "" : "bg-canvas opacity-70"}>
                    <details className="group">
                      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 [&::-webkit-details-marker]:hidden">
                        <span className="flex min-w-0 flex-col"><span className="truncate font-semibold">{u.name}{u.id === me.id && <span className="font-normal text-ink-3"> (you)</span>}</span><span className="truncate text-xs text-ink-3">{u.email}</span></span>
                        <span className="flex flex-none items-center gap-2">{!u.active && <Badge tone="neutral">Inactive</Badge>}<span className="text-xs font-semibold text-accent group-open:hidden">Edit</span><span className="hidden text-xs font-semibold text-ink-3 group-open:inline">Close ✕</span></span>
                      </summary>
                      <div className="space-y-3 border-t border-line bg-canvas p-3.5">
                        <Form action={saveUser} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="from" value={role.key} />
                          <label className="text-[13px]">Name<input name="name" defaultValue={u.name} required className={inputCls} /></label>
                          <label className="text-[13px]">Role
                            <select name="role" defaultValue={u.role} className={inputCls}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
                          </label>
                          <label className="flex min-h-12 items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={u.active} className="size-5 accent-[#c2410c]" /> Active</label>
                          <button className={btnCls}>Save</button>
                        </Form>
                        <Form action={resetUserPassword} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="from" value={role.key} />
                          <label className="text-xs text-ink-2">Reset password<input name="password" type="text" minLength={8} required autoComplete="off" placeholder="new password" className="ml-2 min-h-10 rounded-lg border border-border px-2 text-sm" /></label>
                          <button className="min-h-10 cursor-pointer text-xs font-semibold text-accent">Reset</button>
                        </Form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
          <Card>
            {/* Inputs are uncontrolled (defaultValue/defaultChecked); keying by role remounts them when another role is picked. */}
            <Form key={`${role.key}:${role.updatedAt.getTime()}`} action={save} intents={{ reset, remove }} className="space-y-5">
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
                <p className="text-xs text-ink-3">Home and Account are open to everyone. Home shows the role&apos;s task inbox.</p>
                {HOME_ACTIONS.map((p) => <Tick key={p} name="permissions" value={p} checked={has(p)}>{PERMISSION_LABELS[p]}</Tick>)}
              </section>

              <section className="space-y-1">
                <Eyebrow>HOME PAGE</Eyebrow>
                <p className="text-xs text-ink-3">
                  The blocks on this role&apos;s Home, top to bottom. Type a position to reorder. A block only shows when the role also has the screen it draws on.
                </p>
                <ul className="grid gap-x-6 md:grid-cols-2">
                  {HOME_WIDGETS.map((w) => {
                    const at = role.home.indexOf(w.key);
                    return (
                      <li key={w.key} className="flex items-center gap-2 border-t border-line py-1.5">
                        <div className="min-w-0 flex-1">
                          <Tick name="home" value={w.key} checked={at >= 0}>
                            <span className="font-semibold">{w.name}</span>
                            <span className="block text-xs text-ink-3">{w.what}</span>
                          </Tick>
                        </div>
                        <input name={`pos_${w.key}`} type="number" min={1} max={20} defaultValue={at >= 0 ? at + 1 : ""} aria-label={`${w.name} position`}
                          className="min-h-10 w-14 flex-none rounded-lg border border-border px-2 text-center text-sm" />
                      </li>
                    );
                  })}
                </ul>
              </section>

              {VIEW_GROUPS.map((g) => (
                <section key={g} className="space-y-1">
                  <Eyebrow>{g}</Eyebrow>
                  <ul className="grid gap-x-6 md:grid-cols-2">
                    {VIEWS.filter((v) => v.group === g).map((v) => (
                      <li key={v.key} className="border-t border-line py-1.5">
                        {v.tabs ? (
                          <HubAccessRow viewKey={v.key} name={v.name} note={v.hubNote} tabs={v.tabs}
                            defaultOn={role.allAccess || role.views.includes(v.key)} defaultPerms={v.tabs.filter((t) => role.allAccess || has(t.permission)).map((t) => t.permission)} />
                        ) : v.levels ? (
                          <ViewAccessRow viewKey={v.key} name={v.name} note={v.requires ? `Includes: ${PERMISSION_LABELS[v.requires].toLowerCase()}` : undefined}
                            levels={v.levels.map((l) => l.label)} defaultOn={role.allAccess || role.views.includes(v.key)} defaultLevel={role.allAccess ? v.levels.length - 1 : levelOf(v, role.permissions)} />
                        ) : (
                          <Tick name="views" value={v.key} checked={role.views.includes(v.key)}>
                            <span className="font-semibold">{v.name}</span>
                            {v.requires && <span className="block text-xs text-ink-3">Includes: {PERMISSION_LABELS[v.requires].toLowerCase()}</span>}
                          </Tick>
                        )}
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
                {isDefault && <button name="intent" value="reset" formNoValidate className={btnSecondaryCls}>Reset to default</button>}
                {!role.system && (
                  <ReasonButton name="intent" value="remove" formNoValidate why={role.activeUsers > 0 && `${role.activeUsers} active ${role.activeUsers === 1 ? "person has" : "people have"} this role. Move them to another role on the People tab first.`} className={`${btnDangerCls} aria-disabled:opacity-50`}>
                    Delete role
                  </ReasonButton>
                )}
              </div>
              {!role.system && role.activeUsers > 0 && <p className="text-xs text-ink-3">Move this role&apos;s people to another role on the People tab before deleting it.</p>}
            </Form>
          </Card>
          )}
          </div>
        </div>
      </div>
    </CreateProvider>
  );
}
