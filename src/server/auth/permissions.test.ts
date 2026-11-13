import { qualityTabs } from "@/lib/quality-tabs";
import { describe, expect, it } from "vitest";
import { assertCan, can, canView, ForbiddenError, resolveAccess, SYSTEM_ROLES } from "./permissions";
import { normalize } from "@/server/services/roles";
import { hubTabs, levelOf, levelPermissions, VIEW_KEYS, viewDef } from "@/lib/views";
import { tasksFor } from "@/server/services/inbox";
import { tabsFor } from "@/components/nav-data";


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
    for (const r of SYSTEM_ROLES.filter((x) => !x.allAccess)) expect(resolveAccess(r).views.length).toBeLessThanOrEqual(14);
  });
  it("gives the demo role every view and permission", () => {
    const demo = role("DEMO");
    expect(demo.views).toEqual(VIEW_KEYS);
    expect(can(demo, "users.manage")).toBe(true);
    expect(can(demo, "dispatch.manage")).toBe(true);
  });
  it("denies unauthenticated and throws on assert", () => {
    expect(can(undefined, "stock.view")).toBe(false);
    expect(canView(null, "quality")).toBe(false);
    expect(() => assertCan(role("DISPATCH_OFFICER"), "grn.create")).toThrow(ForbiddenError);
  });
});

describe("resolveAccess", () => {
  it("adds the permission each view needs, and stock reading for everyone", () => {
    const a = resolveAccess({ allAccess: false, views: ["grn"], permissions: [], home: [] });
    expect(a.permissions.sort()).toEqual(["grn.create", "stock.view"]);
  });
  it("drops unknown views and permissions and keeps the stored menu order", () => {
    const a = resolveAccess({ allAccess: false, views: ["trace", "nope", "grn", "trace"], permissions: ["god.mode", "reorder.view"], home: [] });
    expect(a.views).toEqual(["trace", "grn"]);
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
    expect(normalize({ views: ["grn", "demand", "trace"], permissions: [] }, ["trace", "grn"]).views).toEqual(["trace", "grn", "demand"]);
  });
});

describe("role home and tabs", () => {
  it("puts the role's first three screens in the phone tab bar", () => {
    expect(tabsFor(role("QA_INSPECTOR").views).map((t) => t.label)).toEqual(["Home", "Quality", "Trace", "BOMs", "More"]);
    expect(tabsFor(role("STORE_INCHARGE").views).map((t) => t.label)).toEqual(["Home", "Receive", "Stores", "Requests", "More"]);
  });
  it("routes each hand-over to the role that does the next step", () => {
    expect(tasksFor(role("STORE_INCHARGE"))).toEqual(expect.arrayContaining(["gate", "putaway", "issue", "to-buy"]));
    expect(tasksFor(role("PLANNER"))).toEqual(expect.arrayContaining(["demand-due", "to-buy", "to-plan"]));
    expect(tasksFor(role("PRODUCTION_LEAD"))).not.toContain("to-plan"); // sees the plan but can't edit it
    expect(tasksFor(role("STORE_INCHARGE"))).not.toContain("qc");
    expect(tasksFor(role("QA_INSPECTOR"))).toEqual(expect.arrayContaining(["qc", "scrap", "grades"]));
    expect(tasksFor(role("PRODUCTION_LEAD"))).toEqual(expect.arrayContaining(["my-requests", "pm"]));
    expect(tasksFor(role("DISPATCH_OFFICER"))).toEqual(["loading", "fg-ready"]);
    // the new hand-overs: counts go to Admin, rejects to Store, final inspection and first-off to QA
    expect(tasksFor(role("ADMIN"))).toContain("adjustments");
    expect(tasksFor(role("STORE_INCHARGE"))).toEqual(expect.arrayContaining(["counting", "rtv"]));
    expect(tasksFor(role("QA_INSPECTOR"))).toEqual(expect.arrayContaining(["pdi", "firstoff"]));
    expect(tasksFor(role("PRODUCTION_LEAD"))).toEqual(expect.arrayContaining(["firstoff-mine"]));
    expect(tasksFor(role("PRODUCTION_LEAD"))).not.toContain("firstoff");
  });
});

describe("editing the store layout", () => {
  it("is for Admin and Demo by default, and only reachable through the Stores screen", () => {
    expect(can(role("ADMIN"), "bins.manage")).toBe(true);
    expect(canView(role("ADMIN"), "stock")).toBe(true);
    expect(can(role("DEMO"), "bins.manage")).toBe(true);
    for (const r of ["STORE_INCHARGE", "QA_INSPECTOR", "PRODUCTION_LEAD", "DISPATCH_OFFICER", "PLANNER"]) expect(can(role(r), "bins.manage")).toBe(false);
  });
  it("can be granted to any role that has Stores, and is dropped when the role loses Stores", () => {
    expect(normalize({ views: ["stock"], permissions: ["bins.manage", "stock.transfer"] }).permissions).toEqual(["stock.transfer", "bins.manage"]);
    expect(normalize({ views: ["grn"], permissions: ["bins.manage"] }).permissions).toEqual([]);
  });
});

describe("Stores access ladder (View, Move stock, Edit layout)", () => {
  const stores = viewDef("stock")!;
  it("has three rungs, each including the one below", () => {
    expect(stores.levels?.map((l) => l.label)).toEqual(["View", "Move stock", "Edit layout"]);
    expect(levelPermissions(stores, 0)).toEqual([]);
    expect(levelPermissions(stores, 1)).toEqual(["stock.transfer"]);
    expect(levelPermissions(stores, 2)).toEqual(["stock.transfer", "bins.manage"]);
    expect(levelPermissions(stores, 9)).toEqual(["stock.transfer", "bins.manage"]); // out of range stays on the top rung
  });
  it("reads a role's rung from its permissions", () => {
    expect(levelOf(stores, [])).toBe(0);
    expect(levelOf(stores, ["stock.transfer"])).toBe(1);
    expect(levelOf(stores, ["stock.transfer", "bins.manage"])).toBe(2);
    expect(levelOf(stores, ["bins.manage"])).toBe(2);
  });
  it("settles a saved role on one rung: layout editing brings move-stock, and lower rungs drop the rest", () => {
    expect(normalize({ views: ["stock"], permissions: ["bins.manage"] }).permissions).toEqual(["stock.transfer", "bins.manage"]);
    expect(normalize({ views: ["stock"], permissions: ["stock.transfer"] }).permissions).toEqual(["stock.transfer"]);
    expect(normalize({ views: ["stock"], permissions: [] }).permissions).toEqual([]);
    // other permissions are left alone
    expect(normalize({ views: ["stock", "production"], permissions: ["downtime.log", "stock.transfer"] }).permissions.sort()).toEqual(["downtime.log", "stock.transfer"]);
  });
  it("gives Store the Move rung and Admin the Edit rung by default", () => {
    expect(levelOf(stores, role("STORE_INCHARGE").permissions)).toBe(1);
    expect(levelOf(stores, role("ADMIN").permissions)).toBe(2);
    expect(can(role("ADMIN"), "stock.transfer")).toBe(true);
  });
});

describe("Orders (Supplier PO and Dispatch merged in)", () => {
  it("is one screen, with raising POs and creating dispatches as separate actions", () => {
    expect(canView(role("STORE_INCHARGE"), "orders")).toBe(true);
    expect(can(role("STORE_INCHARGE"), "po.manage")).toBe(true);
    expect(can(role("STORE_INCHARGE"), "dispatch.manage")).toBe(false);
    expect(can(role("DISPATCH_OFFICER"), "dispatch.manage")).toBe(true);
    expect(can(role("DISPATCH_OFFICER"), "po.manage")).toBe(false);
    expect(can(role("PLANNER"), "po.manage")).toBe(true);
    // Admin can see every order but raises none
    expect(canView(role("ADMIN"), "orders")).toBe(true);
    expect(can(role("ADMIN"), "po.manage")).toBe(false);
    expect(viewDef("purchase")).toBeUndefined();
    expect(viewDef("dispatch")).toBeUndefined();
  });
  it("keeps Orders as the dispatch officer's first phone tab", () => {
    expect(tabsFor(role("DISPATCH_OFFICER").views).map((t) => t.label)).toEqual(["Home", "Orders", "Goods", "Scan", "More"]);
  });
});

describe("editing customers and suppliers", () => {
  it("is a View / Edit list ladder on Customers & suppliers, held by Admin only by default", () => {
    const partners = viewDef("partners")!;
    expect(partners.levels?.map((l) => l.label)).toEqual(["View", "Edit list"]);
    expect(levelOf(partners, role("ADMIN").permissions)).toBe(1);
    expect(can(role("ADMIN"), "partners.manage")).toBe(true);
    expect(canView(role("PLANNER"), "partners")).toBe(true);
    for (const r of ["STORE_INCHARGE", "QA_INSPECTOR", "PRODUCTION_LEAD", "DISPATCH_OFFICER", "PLANNER"]) expect(can(role(r), "partners.manage")).toBe(false);
  });
});

describe("editing machines and moulds", () => {
  it("is held by Admin only by default, as an extra on the Maintenance screen", () => {
    expect(can(role("ADMIN"), "equipment.manage")).toBe(true);
    expect(canView(role("ADMIN"), "maintenance")).toBe(true);
    for (const r of ["STORE_INCHARGE", "QA_INSPECTOR", "PRODUCTION_LEAD", "DISPATCH_OFFICER", "PLANNER"]) expect(can(role(r), "equipment.manage")).toBe(false);
    // Production Lead records PM and repairs but doesn't add or remove equipment
    expect(can(role("PRODUCTION_LEAD"), "maintenance.manage")).toBe(true);
    expect(viewDef("maintenance")?.actions).toEqual(["maintenance.manage", "equipment.manage"]);
    expect(normalize({ views: ["maintenance"], permissions: ["equipment.manage", "maintenance.manage"] }).permissions.sort()).toEqual(["equipment.manage", "maintenance.manage"]);
    expect(normalize({ views: ["trace"], permissions: ["equipment.manage"] }).permissions).toEqual([]);
  });
});

describe("Home widgets per role", () => {
  it("gives each built-in role its own Home, in order", () => {
    expect(role("DISPATCH_OFFICER").home).toEqual(["todays-shipments", "needs-you"]);
    expect(role("PRODUCTION_LEAD").home).toEqual(["my-machines", "needs-you", "quick-actions"]);
    expect(role("QA_INSPECTOR").home).toEqual(["qc-queue", "needs-you"]);
    expect(role("ADMIN").home[0]).toBe("plant-overview");
    expect(role("STORE_INCHARGE").home).toContain("stock-health");
    expect(role("QA_INSPECTOR").home).not.toContain("stock-health");
  });
  it("hides a block the role has no screen or permission for, and falls back to the task inbox", () => {
    const r = resolveAccess({ allAccess: false, views: ["trace"], permissions: [], home: ["my-machines", "stock-health", "bogus"] });
    expect(r.home).toEqual(["needs-you"]);
    expect(resolveAccess({ allAccess: false, views: ["production"], permissions: [], home: ["my-machines", "my-machines"] }).home).toEqual(["my-machines"]);
  });
  it("keeps widget order when a role is saved, and keeps the old list when none is sent", () => {
    expect(normalize({ views: ["trace"], permissions: [], home: ["quick-actions", "nope", "needs-you"] }).home).toEqual(["quick-actions", "needs-you"]);
    expect(normalize({ views: ["trace"], permissions: [] }, [], ["needs-you"]).home).toEqual(["needs-you"]);
  });
  it("gives the demo role the whole catalog", () => {
    expect(role("DEMO").home).toHaveLength(8);
  });
});

describe("Quality hub: one screen, tabs by permission", () => {
  it("shows each role only the tabs it holds", () => {
    expect(qualityTabs(role("QA_INSPECTOR").permissions)).toEqual(["inward", "scrap", "pdi", "firstoff"]);
    expect(qualityTabs(role("STORE_INCHARGE").permissions)).toEqual(["rtv"]);
    expect(qualityTabs(role("PRODUCTION_LEAD").permissions)).toEqual(["firstoff"]);
    expect(qualityTabs(role("DEMO").permissions)).toEqual(["inward", "scrap", "pdi", "firstoff", "rtv"]);
  });
  it("opens the hub for a role holding any one tab, and drops it when none is held", () => {
    expect(canView(role("STORE_INCHARGE"), "quality")).toBe(true);
    expect(canView(role("DISPATCH_OFFICER"), "quality")).toBe(false);
    expect(resolveAccess({ allAccess: false, views: ["quality"], permissions: [], home: [] }).views).not.toContain("quality");
    expect(resolveAccess({ allAccess: false, views: ["quality"], permissions: ["firstoff.request"], home: [] }).views).toContain("quality");
  });
  it("lists first-off once even though it has a request and an approve permission", () => {
    expect(qualityTabs(["firstoff.request", "firstoff.approve"])).toEqual(["firstoff"]);
  });
});

describe("merged screens: what each role does in them", () => {
  const stepsOf = (key: string, r: string) => hubTabs(viewDef(key)!, role(r).permissions);
  it("Material requests is one flow whose steps follow the permissions", () => {
    expect(stepsOf("requests", "PRODUCTION_LEAD")).toEqual(["request", "return"]);
    expect(stepsOf("requests", "STORE_INCHARGE")).toEqual(["issue", "return"]);
    expect(canView(role("DISPATCH_OFFICER"), "requests")).toBe(false);
    expect(stepsOf("requests", "DEMO")).toEqual(["request", "issue", "return"]);
  });
  it("Finished goods has Pack for production and Pack + Crates for dispatch", () => {
    expect(stepsOf("fg", "PRODUCTION_LEAD")).toEqual(["pack"]);
    expect(stepsOf("fg", "DISPATCH_OFFICER")).toEqual(["pack", "crates"]);
    expect(can(role("PRODUCTION_LEAD"), "crates.manage")).toBe(false);
  });
  it("stock counts live in Stores: Store counts, Admin approves, nobody else does either", () => {
    expect(can(role("STORE_INCHARGE"), "stock.count")).toBe(true);
    expect(can(role("STORE_INCHARGE"), "stock.adjust")).toBe(false);
    expect(can(role("ADMIN"), "stock.adjust")).toBe(true);
    expect(can(role("ADMIN"), "stock.count")).toBe(false);
    expect(can(role("PRODUCTION_LEAD"), "stock.count")).toBe(false);
    expect(normalize({ views: ["grn"], permissions: ["stock.count", "stock.adjust"] }).permissions).toEqual([]); // dropped without Stores
    expect(normalize({ views: ["stock"], permissions: ["stock.count"] }).permissions).toContain("stock.count");
  });
  it("BOMs: everyone with the screen reads it; editing, variance and group management are their own permissions", () => {
    expect(canView(role("QA_INSPECTOR"), "bom")).toBe(true);
    expect(can(role("QA_INSPECTOR"), "bom.manage")).toBe(false);
    expect(can(role("QA_INSPECTOR"), "reports.view")).toBe(false);
    expect(can(role("ADMIN"), "bom.manage") && can(role("ADMIN"), "reports.view") && can(role("ADMIN"), "equivalents.manage")).toBe(true);
  });
  it("the retired screens are gone from the catalog", () => {
    for (const k of ["count", "approvals", "issue", "returns", "returnables", "equivalents", "variance"]) expect(viewDef(k)).toBeUndefined();
  });
});
