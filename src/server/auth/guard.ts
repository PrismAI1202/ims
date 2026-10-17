import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { can, type Permission } from "./permissions";
import { DomainError } from "@/server/services/inventory";

// Every page and server action calls this itself: layout-level auth does not cover server actions.
export async function requirePermission(permission: Permission) {
  await connection(); // session reads are request-time; keep Next from prerendering the caller
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, permission)) redirect("/dashboard?error=" + encodeURIComponent("You don't have access to that."));
  return session.user;
}

// Runs a server action body; domain errors come back to the page as ?error=..., success as ?ok=...
export async function runAction(path: string, okMessage: string, fn: () => Promise<void>): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) redirect(`${path}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`${path}?ok=${encodeURIComponent(okMessage)}`);
}
