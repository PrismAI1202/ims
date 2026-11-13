import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { createRole, deleteRole, listRoles, resetRole, updateRole } from "./roles";
import { createUser } from "./users";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });

// The migration seeds the system roles; each test starts from those defaults with no custom roles. Other test files
// share this database and rely on the defaults, so put them back at the end too.
async function restore() {
  for (const t of ["ApiToken", "User"]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  await db.accessRole.deleteMany({ where: { system: false } });
  for (const r of SYSTEM_ROLES) await resetRole(r.key, db);
}
beforeEach(async () => {
  expect(url).toContain("ims_test");
  await restore();
});
afterAll(async () => {
  await restore();
  await db.$disconnect();
});

const shiftSup = { name: "Shift Supervisor", description: "Runs a shift", views: ["production", "planning", "nope"], permissions: ["plan.manage", "dispatch.manage"] };

describe("roles", () => {
  it("creates a custom role with a key from its name, dropping unknown screens and stray actions", async () => {
    const r = await createRole(shiftSup, db);
    expect(r).toMatchObject({ key: "SHIFT_SUPERVISOR", system: false, views: ["production", "planning"], permissions: ["plan.manage"] });
    await expect(createRole(shiftSup, db)).rejects.toThrow(/already exists/);
    await expect(createRole({ ...shiftSup, name: "X" }, db)).rejects.toThrow(/at least 2/);
    await expect(createRole({ ...shiftSup, name: "Empty", views: [] }, db)).rejects.toThrow(/at least one screen/);
  });

  it("lets a user hold a custom role, and only deletes it once nobody does", async () => {
    await createRole(shiftSup, db);
    const u = await createUser({ email: "sup@plant.local", name: "Sup", role: "SHIFT_SUPERVISOR", password: "Blue-Mould-42!" }, db);
    expect((await listRoles(db)).find((r) => r.key === "SHIFT_SUPERVISOR")?.activeUsers).toBe(1);
    await expect(deleteRole("SHIFT_SUPERVISOR", db)).rejects.toThrow(/still has this role/);
    await db.user.delete({ where: { id: u.id } });
    await deleteRole("SHIFT_SUPERVISOR", db);
    expect(await db.accessRole.findUnique({ where: { key: "SHIFT_SUPERVISOR" } })).toBeNull();
  });

  it("never deletes a built-in role and resets it to its defaults", async () => {
    await expect(deleteRole("QA_INSPECTOR", db)).rejects.toThrow(/Built-in/);
    await updateRole("QA_INSPECTOR", { name: "QA", views: ["quality"], permissions: ["qc.inspect"] }, db);
    expect(await db.accessRole.findUniqueOrThrow({ where: { key: "QA_INSPECTOR" } })).toMatchObject({ name: "QA", views: ["quality"] });
    await resetRole("QA_INSPECTOR", db);
    expect(await db.accessRole.findUniqueOrThrow({ where: { key: "QA_INSPECTOR" } })).toMatchObject({ name: "QA Inspector", views: ["quality", "trace", "equivalents"], home: ["qc-queue", "needs-you"] });
  });

  it("refuses a role that holds the Quality hub with none of its tabs", async () => {
    await expect(updateRole("QA_INSPECTOR", { name: "QA", views: ["quality"], permissions: [] }, db)).rejects.toThrow(/at least one of its tabs/);
    await expect(updateRole("QA_INSPECTOR", { name: "QA", views: ["quality"], permissions: ["rtv.manage"] }, db)).resolves.toBeTruthy();
  });

  it("keeps admin able to manage access", async () => {
    await expect(updateRole("ADMIN", { name: "Admin", views: ["masters"], permissions: [] }, db)).rejects.toThrow(/must keep Settings/);
    await updateRole("ADMIN", { name: "Admin", views: ["masters", "settings"], permissions: [] }, db);
  });

  it("keeps a role's menu order when screens are added", async () => {
    await updateRole("STORE_INCHARGE", { name: "Store Incharge", views: ["mrp", "grn", "stock", "issue", "trace"], permissions: [] }, db);
    expect((await db.accessRole.findUniqueOrThrow({ where: { key: "STORE_INCHARGE" } })).views).toEqual(["grn", "stock", "issue", "mrp", "trace"]);
  });
});
