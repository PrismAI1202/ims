import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { can, canView, type Permission } from "./permissions";
import { viewDef, type ViewKey } from "@/lib/views";
import { INLINE_COOKIE, type ActionFailure } from "@/lib/action-result";
import { DomainError } from "@/server/services/inventory";

const DENIED = "/dashboard?error=" + encodeURIComponent("You don't have access to that.");

// Any signed-in user: Home, Account and Sync centre.
export async function requireUser() {
  await connection(); // session reads are request-time; keep Next from prerendering the caller
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user;
}

// A screen that several roles open for different reasons (Orders): the view, and the permission this page needs on it.
export async function requireViewWith(view: ViewKey, permission: Permission) {
  const user = await requireView(view);
  if (!can(user, permission)) redirect(DENIED);
  return user;
}

// Every server action calls this itself: layout-level auth does not cover server actions.
export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  if (!can(user, permission)) redirect(DENIED);
  return user;
}

// Pages call this: the user's role must include the screen, and the permission the screen cannot work without.
export async function requireView(view: ViewKey) {
  const user = await requireUser();
  const needs = viewDef(view)?.requires;
  if (!canView(user, view) || (needs && !can(user, needs))) redirect(DENIED);
  return user;
}

// Runs a server action body; domain errors come back to the page as ?error=..., success as ?ok=...
// `path` and `okMessage` may be functions so they can depend on what the action created (e.g. a new id).
// When `path` is a function, pass `errorPath` too, since there is nothing to fall back to if fn() throws first.

export async function runAction(
  path: string | (() => string), okMessage: string | (() => string), fn: () => Promise<void>,
  errorPath: string = typeof path === "string" ? path : "/dashboard",
): Promise<ActionFailure> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) {
      // A form on this site asks for the failure back, so the page (and everything typed on it) stays exactly as it is:
      // changing the URL would rebuild the page and empty the form. Anything else (old links, other clients) gets the redirect.
      if (await inline()) return { error: e.message, fields: e.fields };
      const back = withParam(await backTo(errorPath), "error", e.message);
      redirect(e.fields.length ? withParam(back, "field", e.fields.join(",")) : back);
    }
    throw e;
  }
  const target = typeof path === "function" ? path() : path;
  redirect(withParam(target, "ok", typeof okMessage === "function" ? okMessage() : okMessage));
}

async function inline(): Promise<boolean> {
  try { return (await cookies()).get(INLINE_COOKIE)?.value === "1"; } catch { return false; } // no request in scope (tests)
}

/**
 * Where to send the user when an action fails. When the form was on the page the action reports back to, that is the exact page
 * they were on (same selected PO, tab, open panel), not the bare path: the form must come back as they left it, with what they
 * typed still in it. Falls back to `errorPath` for any other origin.
 */
async function backTo(errorPath: string): Promise<string> {
  try {
    const ref = (await headers()).get("referer");
    if (!ref) return errorPath;
    const from = new URL(ref), want = new URL(errorPath, from.origin);
    if (from.host !== (await headers()).get("host") || from.pathname !== want.pathname) return errorPath;
    for (const k of ["error", "ok", "field"]) from.searchParams.delete(k);
    const qs = from.searchParams.toString();
    return from.pathname + (qs ? `?${qs}` : "");
  } catch {
    return errorPath; // no request in scope (tests), or an odd referer
  }
}

// Paths may already carry a query string (e.g. /masters?tab=items).
export function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}
