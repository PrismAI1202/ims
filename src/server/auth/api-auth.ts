import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/server/db";
import type { Role } from "./permissions";

export interface ApiUser {
  id: string;
  role: Role;
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
      include: { user: true },
    });
    if (!record || !record.user.active) return null;
    await db.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
    return { id: record.user.id, role: record.user.role as Role };
  }
  const session = await auth();
  return session?.user ? { id: session.user.id, role: session.user.role } : null;
}
