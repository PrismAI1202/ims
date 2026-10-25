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
// `path` and `okMessage` may be functions so they can depend on what the action created (e.g. a new id).
// When `path` is a function, pass `errorPath` too, since there is nothing to fall back to if fn() throws first.
export async function runAction(
  path: string | (() => string), okMessage: string | (() => string), fn: () => Promise<void>,
  errorPath: string = typeof path === "string" ? path : "/dashboard",
): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) redirect(withParam(errorPath, "error", e.message));
    throw e;
  }
  const target = typeof path === "function" ? path() : path;
  redirect(withParam(target, "ok", typeof okMessage === "function" ? okMessage() : okMessage));
}

// Paths may already carry a query string (e.g. /masters?tab=items).
export function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}
