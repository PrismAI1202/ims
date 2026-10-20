import { describe, expect, it } from "vitest";
import { refreshToken } from "./session-refresh";

describe("refreshToken", () => {
  const live = async () => ({ active: true, role: "QA_INSPECTOR" as const });

  it("picks up a changed role straight away", async () => {
    const t = await refreshToken({ id: "u1", role: "ADMIN" }, live);
    expect(t?.role).toBe("QA_INSPECTOR");
  });
  it("ends the session for a deactivated user", async () => {
    expect(await refreshToken({ id: "u1", role: "ADMIN" }, async () => ({ active: false, role: "ADMIN" }))).toBeNull();
  });
  it("ends the session for a user that no longer exists", async () => {
    expect(await refreshToken({ id: "ghost", role: "ADMIN" }, async () => null)).toBeNull();
  });
  it("leaves other token fields alone and does not look anyone up at first sign-in", async () => {
    let calls = 0;
    const t = await refreshToken({ role: "ADMIN", name: "x" }, async () => { calls++; return null; });
    expect(t).toMatchObject({ role: "ADMIN", name: "x" });
    expect(calls).toBe(0);
    expect((await refreshToken({ id: "u1", name: "x" }, live))?.name).toBe("x");
  });
});
