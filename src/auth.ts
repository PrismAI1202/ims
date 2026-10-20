import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import type { Role } from "@/server/auth/permissions";
import { refreshToken, type SessionToken } from "@/server/auth/session-refresh";

declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: { id: string; name: string; email: string; role: Role };
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role as Role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        return token;
      }
      // Every later read re-checks the user, so deactivation and role changes apply immediately.
      const fresh = await refreshToken(token as SessionToken, async (id) => {
        const u = await db.user.findUnique({ where: { id }, select: { active: true, role: true } });
        return u ? { active: u.active, role: u.role as Role } : null;
      });
      return fresh as typeof token | null;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      return session;
    },
  },
});
