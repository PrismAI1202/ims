import { describe, expect, it } from "vitest";
import { assertCan, can, canView, ForbiddenError, resolveAccess, SYSTEM_ROLES } from "./permissions";
import { normalize } from "@/server/services/roles";
import { tasksFor } from "@/server/services/inbox";
import { tabsFor } from "@/components/nav-data";
import { VIEW_KEYS } from "@/lib/views";

const role = (key: string) => resolveAccess(SYSTEM_ROLES.find((r) => r.key === key)!);

describe("default roles", () => {
  it("lets the store incharge receive, put away and issue but not inspect", () => {
    const store = role("STORE_INCHARGE");
    expect(can(store, "grn.create")).toBe(true);
    expect(can(store, "stock.issue")).toBe(true);
    expect(can(store, "stock.transfer")).toBe(true);
    expect(can(store, "qc.inspect")).toBe(false);
  });
  it("lets QA inspect and decide scrap but not issue stock", () => {
    const qa = role("QA_INSPECTOR");
    expect(can(qa, "qc.inspect")).toBe(true);
    expect(can(qa, "scrap.approve")).toBe(true);
    expect(can(qa, "stock.issue")).toBe(false);
  });
  it("lets production request, book and log downtime, not issue", () => {
    const prod = role("PRODUCTION_LEAD");
    for (const p of ["request.create", "production.book", "downtime.log", "fg.pack"] as const) expect(can(prod, p)).toBe(true);
    expect(can(prod, "stock.issue")).toBe(false);
  });
  it("keeps BOM editing with admin", () => {
    expect(can(role("ADMIN"), "bom.manage")).toBe(true);
    for (const r of ["STORE_INCHARGE", "QA_INSPECTOR", "PRODUCTION_LEAD", "DISPATCH_OFFICER", "PLANNER"]) expect(can(role(r), "bom.manage")).toBe(false);
  });
  it("trims menus: dispatch no longer sees planning, maintenance or equivalents, and QA no longer sees planning", () => {
    for (const v of ["planning", "maintenance", "equivalents", "process"]) expect(canView(role("DISPATCH_OFFICER"), v)).toBe(false);
    expect(canView(role("QA_INSPECTOR"), "planning")).toBe(false);
    for (const r of SYSTEM_ROLES.filter((x) => !x.allAccess)) expect(resolveAccess(r).views.length).toBeLessThanOrEqual(12);
  });
  it("gives the demo role every view and permission", () => {
    const demo = role("DEMO");
    expect(demo.views).toEqual(VIEW_KEYS);
    expect(can(demo, "users.manage")).toBe(true);
    expect(can(demo, "dispatch.manage")).toBe(true);
  });
  it("denies unauthenticated and throws on assert", () => {
    expect(can(undefined, "stock.view")).toBe(false);
    expect(canView(null, "qc")).toBe(false);
    expect(() => assertCan(role("DISPATCH_OFFICER"), "grn.create")).toThrow(ForbiddenError);
  });
});

describe("resolveAccess", () => {
  it("adds the permission each view needs, and stock reading for everyone", () => {
    const a = resolveAccess({ allAccess: false, views: ["grn"], permissions: [] });
    expect(a.permissions.sort()).toEqual(["grn.create", "stock.view"]);
  });
  it("drops unknown views and permissions and keeps the stored menu order", () => {
    const a = resolveAccess({ allAccess: false, views: ["qc", "nope", "grn", "qc"], permissions: ["god.mode", "reorder.view"] });
    expect(a.views).toEqual(["qc", "grn"]);
    expect(a.permissions).not.toContain("god.mode");
    expect(a.permissions).toContain("reorder.view");
  });
});

describe("normalize (saving a role)", () => {
  it("drops actions whose screen is not ticked", () => {
    const n = normalize({ views: ["production"], permissions: ["downtime.log", "plan.manage", "reorder.view"] });
    expect(n.permissions.sort()).toEqual(["downtime.log", "reorder.view"]);
  });
  it("keeps the existing order and appends newly ticked screens", () => {
    expect(normalize({ views: ["grn", "qc", "trace"], permissions: [] }, ["trace", "grn"]).views).toEqual(["trace", "grn", "qc"]);
  });
});

describe("role home and tabs", () => {
  it("puts the role's first three screens in the phone tab bar", () => {
    expect(tabsFor(role("QA_INSPECTOR").views).map((t) => t.label)).toEqual(["Home", "QC", "Scrap", "Trace", "More"]);
    expect(tabsFor(role("STORE_INCHARGE").views).map((t) => t.label)).toEqual(["Home", "Receive", "Stores", "Issue", "More"]);
  });
  it("routes each hand-over to the role that does the next step", () => {
    expect(tasksFor(role("STORE_INCHARGE"))).toEqual(expect.arrayContaining(["gate", "putaway", "issue", "release"]));
    expect(tasksFor(role("STORE_INCHARGE"))).not.toContain("qc");
    expect(tasksFor(role("QA_INSPECTOR"))).toEqual(expect.arrayContaining(["qc", "scrap", "grades"]));
    expect(tasksFor(role("PRODUCTION_LEAD"))).toEqual(expect.arrayContaining(["my-requests", "pm"]));
    expect(tasksFor(role("DISPATCH_OFFICER"))).toEqual(["loading", "fg-ready"]);
  });
});
