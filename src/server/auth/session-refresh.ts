import type { Role } from "./permissions";

export interface SessionToken { id?: string; role?: Role; [k: string]: unknown }
export type UserLookup = (id: string) => Promise<{ active: boolean; role: Role } | null>;

// Called every time the session is read. A signed token alone isn't enough: if the user was deactivated or
// deleted the session ends at once (null), and a changed role takes effect immediately instead of at token expiry.
export async function refreshToken(token: SessionToken, lookup: UserLookup): Promise<SessionToken | null> {
  if (!token.id) return token; // first sign-in: the jwt callback has just filled it in
  const u = await lookup(token.id);
  if (!u || !u.active) return null;
  return { ...token, role: u.role };
}
