import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db as defaultDb } from "@/server/db";
import { ADMIN_KEY, ADMIN_LOCKED_VIEWS, HOME_ACTIONS, isPermission, SYSTEM_ROLES, type Permission } from "@/server/auth/permissions";
import { hubTabs, isViewKey, levelOf, levelPermissions, VIEWS, viewActions, viewDef, type ViewKey } from "@/lib/views";
import { isHomeWidget } from "@/lib/home-widgets";
import { DomainError } from "./inventory";

type Db = PrismaClient;

// Roles an admin manages under Settings · Roles & access. A role is a list of views (screens) plus the optional actions
// shown under them; the permission each view cannot work without is added when the role is read (resolveAccess).

export interface RoleInput {
  name: string;
  description?: string;
  allAccess?: boolean;
  views: string[];
  permissions: string[];
  home?: string[]; // Home widgets in the order shown; left out, the role keeps what it has
}

const name = z.string().trim().min(2, "Give the role a name of at least 2 characters.").max(40, "Keep the role name under 40 characters.");
const description = z.string().trim().max(200, "Keep the description under 200 characters.");

/** The actions an admin can tick for a role holding these views: Home's, plus each view's optional extras. */
export function grantableActions(views: readonly ViewKey[]): Permission[] {
  return [...HOME_ACTIONS, ...views.flatMap((v) => { const d = viewDef(v); return d ? viewActions(d) : []; })];
}

// Keeps only known views and the actions that belong to them, so a role never carries a hidden permission for a
// screen it no longer has. `previous` keeps the role's existing menu order, with newly ticked views added at the end.
export function normalize(input: Pick<RoleInput, "views" | "permissions" | "home">, previous: readonly string[] = [], previousHome: readonly string[] = []) {
  const ticked = new Set(input.views.filter(isViewKey));
  const views = [...previous.filter((v): v is ViewKey => isViewKey(v) && ticked.has(v))];
  for (const v of VIEWS) if (ticked.has(v.key) && !views.includes(v.key)) views.push(v.key);
  const allowed = new Set(grantableActions(views));
  let permissions = [...new Set(input.permissions.filter(isPermission).filter((p) => allowed.has(p)))];
  // A laddered view is one setting: settle on the highest rung reached and grant everything up to it.
  for (const v of views) {
    const d = viewDef(v);
    if (!d?.levels) continue;
    const mine = new Set(d.levels.flatMap((l) => l.permissions));
    permissions = [...new Set([...permissions.filter((p) => !mine.has(p)), ...levelPermissions(d, levelOf(d, permissions))])];
  }
  // Widgets keep the order they were given in; whether one actually shows depends on the role's screens (resolveAccess).
  const home = input.home ? [...new Set(input.home.filter(isHomeWidget))] : [...previousHome];
  return { views, permissions, home };
}

// Role keys are stable ids (users point at them), made once from the name: "Shift Supervisor" -> SHIFT_SUPERVISOR.
function keyFrom(n: string) {
  return n.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "ROLE";
}

// A hub screen with no tab ticked would open to nothing, so it has to be unticked or given a tab.
function needTabs(a: { views: string[]; permissions: string[] }) {
  for (const key of a.views) {
    const d = viewDef(key);
    if (d?.tabs && hubTabs(d, a.permissions).length === 0) throw new DomainError(`${d.name} needs at least one of its tabs ticked, or the screen unticked.`);
  }
}

function parse(input: RoleInput) {
  const p = z.object({ name, description }).safeParse({ name: input.name, description: input.description ?? "" });
  if (!p.success) throw new DomainError(p.error.issues[0].message);
  return p.data;
}

function nameTaken(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("A role with that name already exists.");
  throw e;
}

export async function listRoles(db: Db = defaultDb) {
  const roles = await db.accessRole.findMany({ include: { _count: { select: { users: { where: { active: true } } } } } });
  const order = (k: string) => { const i = SYSTEM_ROLES.findIndex((r) => r.key === k); return i < 0 ? SYSTEM_ROLES.length : i; };
  return roles
    .sort((a, b) => order(a.key) - order(b.key) || a.name.localeCompare(b.name))
    .map(({ _count, ...r }) => ({ ...r, activeUsers: _count.users }));
}

export async function createRole(input: RoleInput, db: Db = defaultDb) {
  const data = parse(input);
  const access = normalize(input);
  if (!input.allAccess && access.views.length === 0) throw new DomainError("Give the role at least one screen.");
  if (!input.allAccess) needTabs(access);
  const base = keyFrom(data.name);
  let key = base;
  for (let i = 2; await db.accessRole.findUnique({ where: { key } }); i++) key = `${base}_${i}`;
  try {
    return await db.accessRole.create({ data: { key, ...data, allAccess: !!input.allAccess, ...access } });
  } catch (e) {
    nameTaken(e);
  }
}

export async function updateRole(key: string, input: RoleInput, db: Db = defaultDb) {
  const role = await db.accessRole.findUnique({ where: { key } });
  if (!role) throw new DomainError("Unknown role.");
  const data = parse(input);
  const access = normalize(input, role.views, role.home);
  if (!input.allAccess && access.views.length === 0) throw new DomainError("Give the role at least one screen.");
  if (!input.allAccess) needTabs(access);
  if (key === ADMIN_KEY && !input.allAccess && ADMIN_LOCKED_VIEWS.some((v) => !access.views.includes(v))) {
    throw new DomainError("Admin must keep Settings, or nobody could manage roles and users.");
  }
  try {
    return await db.accessRole.update({ where: { key }, data: { ...data, allAccess: !!input.allAccess, ...access } });
  } catch (e) {
    nameTaken(e);
  }
}

/** Puts a system role back to the defaults it shipped with. */
export async function resetRole(key: string, db: Db = defaultDb) {
  const def = SYSTEM_ROLES.find((r) => r.key === key);
  if (!def) throw new DomainError("Only built-in roles have defaults to reset to.");
  const { name, description, allAccess, views, permissions, home } = def;
  try {
    return await db.accessRole.update({ where: { key }, data: { name, description, allAccess, views, permissions, home, system: true } });
  } catch (e) {
    nameTaken(e);
  }
}

/** Custom roles can be removed once nobody holds them; built-in ones stay. */
export async function deleteRole(key: string, db: Db = defaultDb) {
  const role = await db.accessRole.findUnique({ where: { key }, include: { _count: { select: { users: true } } } });
  if (!role) throw new DomainError("Unknown role.");
  if (role.system) throw new DomainError("Built-in roles can't be deleted. Change their screens instead, or reset them.");
  if (role._count.users > 0) {
    throw new DomainError(`${role._count.users} user${role._count.users === 1 ? " still has" : "s still have"} this role. Move them to another role first.`);
  }
  await db.accessRole.delete({ where: { key } });
}
