import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import { resolveAccess } from "@/server/auth/permissions";
import { refreshToken, type SessionAccess, type SessionToken } from "@/server/auth/session-refresh";

declare module "next-auth" {
  interface User {
    role: SessionAccess["role"];
    roleName: SessionAccess["roleName"];
    views: SessionAccess["views"];
    permissions: SessionAccess["permissions"];
  }
  interface Session {
    user: { id: string; name: string; email: string } & SessionAccess;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// The user's role and what it grants. Read on every session check, so edits under Settings apply at once.
async function accessOf(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { active: true, role: true, access: true } });
  return u ? { active: u.active, role: u.role, roleName: u.access.name, ...resolveAccess(u.access) } : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, include: { access: true } });
        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role, roleName: user.access.name, ...resolveAccess(user.access) };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        return { ...token, id: user.id, role: user.role, roleName: user.roleName, views: user.views, permissions: user.permissions };
      }
      // Every later read re-checks the user, so deactivation and role changes apply immediately.
      const fresh = await refreshToken(token as SessionToken, accessOf);
      return fresh as typeof token | null;
    },
    session({ session, token }) {
      const t = token as SessionToken;
      session.user.id = t.id as string;
      session.user.role = t.role ?? "";
      session.user.roleName = t.roleName ?? "";
      session.user.views = t.views ?? [];
      session.user.permissions = t.permissions ?? [];
      return session;
    },
  },
});
