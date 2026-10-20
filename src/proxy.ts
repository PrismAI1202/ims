import { NextResponse, type NextRequest } from "next/server";
import { needsLogin } from "@/lib/auth-gate";

// Sends visitors without a session cookie to the login page with a real 307, before any page renders.
// (Page code still checks the session itself; see src/lib/auth-gate.ts.)
export function proxy(request: NextRequest) {
  const names = request.cookies.getAll().map((c) => c.name);
  if (needsLogin(request.nextUrl.pathname, names)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's own static files and image optimiser.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
