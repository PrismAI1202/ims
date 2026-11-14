import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { resolveAccess, type Permission } from "./permissions";
import type { ViewKey } from "@/lib/views";

export interface ApiUser {
  id: string;
  role: string;
  views: ViewKey[];
  permissions: Permission[];
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Issues a device token for a user. The plain token is returned once; only its hash is stored.
export async function createApiToken(userId: string, label: string) {
  const token = `ims_${randomBytes(24).toString("hex")}`;
  await db.apiToken.create({ data: { userId, label, tokenHash: hashToken(token) } });
  return token;
}

// Browser/PWA callers use the session cookie; a native app or scanner device sends a Bearer token.
export async function getApiUser(req: Request): Promise<ApiUser | null> {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const record = await db.apiToken.findUnique({
      where: { tokenHash: hashToken(header.slice(7).trim()) },
      include: { user: { include: { access: true } } },
    });
    if (!record || !record.user.active) return null;
    await db.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
    return { id: record.user.id, role: record.user.role, ...resolveAccess(record.user.access) };
  }
  const session = await auth();
  const u = session?.user;
  return u ? { id: u.id, role: u.role, views: u.views, permissions: u.permissions } : null;
}
