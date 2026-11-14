import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/services/inventory";

// runAction answers a broken rule in place when a <Form> asked for that (the ims-inline cookie), and by redirect otherwise.
const jar = new Map<string, string>(); const hdrs = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined) }),
  headers: async () => ({ get: (k: string) => hdrs.get(k) ?? null }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next/server", () => ({ connection: async () => {} }));

const { runAction } = await import("./guard");
const broken = async () => { throw new DomainError("Enter the lot number.", ["lot_1"]); };

beforeEach(() => { jar.clear(); hdrs.clear(); });

describe("runAction", () => {
  it("returns the message and the field names when the form asked for an in-place answer", async () => {
    jar.set("ims-inline", "1");
    await expect(runAction("/grn", "Done.", broken)).resolves.toEqual({ error: "Enter the lot number.", fields: ["lot_1"] });
  });
  it("redirects back to the exact page the form was on otherwise, keeping its query and naming the fields", async () => {
    hdrs.set("referer", "http://localhost:3000/grn?po=abc&error=old"); hdrs.set("host", "localhost:3000");
    await expect(runAction("/grn", "Done.", broken)).rejects.toMatchObject({ to: "/grn?po=abc&error=Enter%20the%20lot%20number.&field=lot_1" });
  });
  it("falls back to the given path for a referer on another page or host", async () => {
    hdrs.set("referer", "http://evil.example/grn?po=abc"); hdrs.set("host", "localhost:3000");
    await expect(runAction("/grn", "Done.", broken)).rejects.toMatchObject({ to: "/grn?error=Enter%20the%20lot%20number.&field=lot_1" });
  });
  it("redirects with the ok message on success, and re-throws anything that is not a rule violation", async () => {
    jar.set("ims-inline", "1");
    await expect(runAction("/grn", "Done.", async () => {})).rejects.toMatchObject({ to: "/grn?ok=Done." });
    await expect(runAction("/grn", "Done.", async () => { throw new Error("db down"); })).rejects.toThrow("db down");
  });
});
