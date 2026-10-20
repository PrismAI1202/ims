import { describe, expect, it } from "vitest";
import { hasSessionCookie, needsLogin } from "./auth-gate";

const SESSION = ["authjs.session-token"];

describe("hasSessionCookie", () => {
  it("recognises the plain, secure and chunked session cookies", () => {
    expect(hasSessionCookie(["authjs.session-token"])).toBe(true);
    expect(hasSessionCookie(["__Secure-authjs.session-token"])).toBe(true);
    expect(hasSessionCookie(["a", "authjs.session-token.0", "authjs.session-token.1"])).toBe(true);
  });
  it("ignores unrelated and look-alike cookies", () => {
    expect(hasSessionCookie([])).toBe(false);
    expect(hasSessionCookie(["authjs.csrf-token", "authjs.callback-url"])).toBe(false);
    expect(hasSessionCookie(["authjs.session-token-evil"])).toBe(false);
    expect(hasSessionCookie(["x-authjs.session-token"])).toBe(false);
  });
});

describe("needsLogin", () => {
  it("sends app pages to login when there is no session cookie", () => {
    for (const p of ["/", "/dashboard", "/masters", "/purchase/abc", "/scan", "/scan/issue", "/users", "/qc/tag/xyz", "/fg/labels"]) {
      expect(needsLogin(p, [])).toBe(true);
    }
  });
  it("lets signed-in requests through", () => {
    expect(needsLogin("/dashboard", SESSION)).toBe(false);
    expect(needsLogin("/scan/issue", SESSION)).toBe(false);
  });
  it("never blocks the login page or the files the PWA needs to install", () => {
    for (const p of ["/login", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/favicon.ico"]) expect(needsLogin(p, [])).toBe(false);
  });
  it("leaves API routes to answer for themselves, since devices use Bearer tokens and send no cookie", () => {
    for (const p of ["/api/v1/sync", "/api/health", "/api/auth/signin", "/api/v1/export/stock", "/api"]) expect(needsLogin(p, [])).toBe(false);
  });
  it("does not treat page paths that merely start with 'api' as API routes", () => {
    expect(needsLogin("/apiary", [])).toBe(true);
    expect(needsLogin("/login/extra", [])).toBe(true);
  });
});
