// Decides whether a request must be sent to the login page before any page code runs.
// This is only a fast first gate: it checks that a session cookie EXISTS. Pages and actions still validate the session
// fully (signature, user still active, role), so a forged cookie gets past here but no further.

const PUBLIC_PAGES = new Set(["/login", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/favicon.ico"]);

export const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function hasSessionCookie(cookieNames: string[]): boolean {
  // Large sessions are split into numbered chunks: authjs.session-token.0, .1 …
  return cookieNames.some((n) => SESSION_COOKIES.some((c) => n === c || n.startsWith(`${c}.`)));
}

export function needsLogin(pathname: string, cookieNames: string[]): boolean {
  if (PUBLIC_PAGES.has(pathname)) return false;
  // API routes answer for themselves with JSON 401/403; device tokens arrive as headers, with no cookie at all.
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  return !hasSessionCookie(cookieNames);
}
