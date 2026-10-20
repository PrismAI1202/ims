import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db as defaultDb } from "@/server/db";
import { DomainError } from "./inventory";

type Db = PrismaClient;

export const ROLES = ["ADMIN", "STORE_INCHARGE", "QA_INSPECTOR", "PRODUCTION_LEAD", "DISPATCH_OFFICER"] as const;

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(120);
const name = z.string().trim().min(2, "Name is required.").max(80);
const role = z.enum(ROLES, { message: "Choose a role." });

// Deliberately simple, since this is an internal plant tool: length is what matters most, plus a basic guard against the obvious.
export function checkPassword(pw: string, userEmail?: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 100) return "Password is too long.";
  if (/^(.)\1+$/.test(pw)) return "Password can't be one repeated character.";
  if (["password", "password1", "password123", "12345678", "qwertyui"].includes(pw.toLowerCase())) return "That password is too common. Pick another.";
  if (userEmail && pw.toLowerCase() === userEmail.toLowerCase()) return "Password can't be the same as the email.";
  return null;
}

function first(r: { error: z.ZodError }): never {
  throw new DomainError(r.error.issues[0].message);
}

export async function createUser(input: { email: string; name: string; role: string; password: string }, db: Db = defaultDb) {
  const p = z.object({ email, name, role }).safeParse(input);
  if (!p.success) first(p);
  const bad = checkPassword(input.password, p.data.email);
  if (bad) throw new DomainError(bad);
  try {
    const u = await db.user.create({ data: { ...p.data, passwordHash: await bcrypt.hash(input.password, 10) } });
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError("A user with that email already exists.");
    throw e;
  }
}

async function activeAdmins(db: Db, excludingId?: string) {
  return db.user.count({ where: { role: "ADMIN", active: true, ...(excludingId ? { id: { not: excludingId } } : {}) } });
}

// Changes name, role and active flag. `actorId` is the admin making the change.
export async function updateUser(
  id: string, actorId: string, input: { name: string; role: string; active: boolean }, db: Db = defaultDb,
) {
  const p = z.object({ name, role }).safeParse(input);
  if (!p.success) first(p);
  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw new DomainError("Unknown user.");

  if (id === actorId && !input.active) throw new DomainError("You can't deactivate your own account.");
  const losesAdmin = target.role === "ADMIN" && target.active && (p.data.role !== "ADMIN" || !input.active);
  if (losesAdmin && (await activeAdmins(db, id)) === 0) throw new DomainError("There must always be at least one active admin.");

  await db.user.update({ where: { id }, data: { ...p.data, active: input.active } });
}

export async function resetPassword(id: string, newPassword: string, db: Db = defaultDb) {
  const u = await db.user.findUnique({ where: { id } });
  if (!u) throw new DomainError("Unknown user.");
  const bad = checkPassword(newPassword, u.email);
  if (bad) throw new DomainError(bad);
  await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
  // Device tokens belong to the old credentials; revoke them so a reset really locks out whoever had access.
  await db.apiToken.deleteMany({ where: { userId: id } });
}

export async function changeOwnPassword(id: string, current: string, next: string, db: Db = defaultDb) {
  const u = await db.user.findUnique({ where: { id } });
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new DomainError("Your current password is wrong.");
  if (current === next) throw new DomainError("Choose a different password from the current one.");
  const bad = checkPassword(next, u.email);
  if (bad) throw new DomainError(bad);
  await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
}
