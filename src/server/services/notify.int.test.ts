import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { audience, notifyView, removeSubscription, saveSubscription, type PushPayload, type PushSender, type PushTarget } from "./notify";
import { resetRole } from "./roles";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
const db = new PrismaClient({ datasourceUrl: url });

const u: Record<string, string> = {};
const payload: PushPayload = { title: "Lots waiting for QC", body: "PO-1: 1 line received", url: "/qc" };

// Records who was sent what; `gone` endpoints answer like an expired subscription, `boom` ones fail.
function fakeSender(opts: { gone?: string[]; boom?: string[] } = {}) {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const send: PushSender = async (t: PushTarget, p) => {
    if (opts.boom?.includes(t.endpoint)) throw new Error("push service down");
    if (opts.gone?.includes(t.endpoint)) return "gone";
    sent.push({ endpoint: t.endpoint, payload: p });
    return "sent";
  };
  return { sent, send };
}

beforeEach(async () => {
  expect(url).toContain("ims_test");
  for (const t of ["PushSubscription", "ApiToken", "User"]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  for (const r of SYSTEM_ROLES) await resetRole(r.key, db);
  const mk = async (key: string, role: string, active = true) => {
    u[key] = (await db.user.create({ data: { email: `${key}@x`, name: key, role, passwordHash: "x", active } })).id;
    await saveSubscription(u[key], { endpoint: `https://push.example/${key}`, p256dh: "p", auth: "a" }, db);
  };
  await mk("qa", "QA_INSPECTOR");
  await mk("qa2", "QA_INSPECTOR");
  await mk("qaOff", "QA_INSPECTOR", false);
  await mk("store", "STORE_INCHARGE");
  await mk("prod", "PRODUCTION_LEAD");
  await mk("dispatch", "DISPATCH_OFFICER");
});
afterAll(async () => {
  for (const t of ["PushSubscription", "ApiToken", "User"]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  await db.$disconnect();
});

describe("who gets a notification", () => {
  it("goes to active users whose role has the screen, and not to the person who caused it", async () => {
    expect((await audience({ view: "quality", perm: "qc.inspect" }, db)).sort()).toEqual([u.qa, u.qa2].sort());
    expect(await audience({ view: "quality", perm: "qc.inspect", exceptUserId: u.qa }, db)).toEqual([u.qa2]);
    expect(await audience({ view: "orders", perm: "dispatch.manage" }, db)).toEqual([u.dispatch]);
  });

  it("can require a permission as well as the screen", async () => {
    // Store and Production both have Stores/requests-type screens; only the holder of the permission is told
    expect(await audience({ view: "stock", perm: "stock.transfer" }, db)).toEqual([u.store]);
    expect((await audience({ view: "quality", perm: "firstoff.approve" }, db)).sort()).toEqual([u.qa, u.qa2].sort());
    expect(await audience({ view: "quality", perm: "firstoff.request" }, db)).toEqual([u.prod]);
  });

  it("tells only the tab's own holders, since Store and Production also open the Quality screen", async () => {
    expect(await audience({ view: "quality", perm: "rtv.manage" }, db)).toEqual([u.store]);
    expect(await audience({ view: "quality", perm: "pdi.release" }, db)).toEqual([u.qa, u.qa2].sort());
    expect((await audience({ view: "quality" }, db)).sort()).toEqual([u.qa, u.qa2, u.store, u.prod].sort());
  });

  it("skips users with no subscribed device", async () => {
    await db.pushSubscription.deleteMany({ where: { userId: u.qa2 } });
    expect(await audience({ view: "quality", perm: "qc.inspect" }, db)).toEqual([u.qa]);
  });
});

describe("sending", () => {
  it("sends the payload to every device of everyone in the audience", async () => {
    await saveSubscription(u.qa, { endpoint: "https://push.example/qa-phone", p256dh: "p", auth: "a" }, db);
    const { sent, send } = fakeSender();
    expect(await notifyView({ view: "quality", perm: "qc.inspect" }, payload, db, send)).toBe(3);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.example/qa", "https://push.example/qa-phone", "https://push.example/qa2"]);
    expect(sent[0].payload).toEqual(payload);
  });

  it("deletes subscriptions the push service says are gone, and keeps the rest", async () => {
    const { send } = fakeSender({ gone: ["https://push.example/qa2"] });
    expect(await notifyView({ view: "quality", perm: "qc.inspect" }, payload, db, send)).toBe(1);
    expect(await db.pushSubscription.count({ where: { userId: u.qa2 } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: u.qa } })).toBe(1);
  });

  it("never throws when a push fails, and still reaches the others", async () => {
    const { sent, send } = fakeSender({ boom: ["https://push.example/qa"] });
    expect(await notifyView({ view: "quality", perm: "qc.inspect" }, payload, db, send)).toBe(1);
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/qa2"]);
    expect(await db.pushSubscription.count({ where: { userId: u.qa } })).toBe(1); // a failure isn't proof it's gone
  });

  it("sends nothing without server keys", async () => {
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
    expect(await notifyView({ view: "quality", perm: "qc.inspect" }, payload, db)).toBe(0); // default sender, not configured
  });
});

describe("subscriptions", () => {
  it("moves a device to the new user when it changes hands, and removes only your own", async () => {
    await saveSubscription(u.store, { endpoint: "https://push.example/qa", p256dh: "p2", auth: "a2" }, db);
    expect((await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: "https://push.example/qa" } })).userId).toBe(u.store);
    await removeSubscription(u.qa, "https://push.example/qa", db); // not theirs any more
    expect(await db.pushSubscription.count({ where: { endpoint: "https://push.example/qa" } })).toBe(1);
    await removeSubscription(u.store, "https://push.example/qa", db);
    expect(await db.pushSubscription.count({ where: { endpoint: "https://push.example/qa" } })).toBe(0);
  });

  it("rejects non-https endpoints and missing keys", async () => {
    await expect(saveSubscription(u.qa, { endpoint: "http://evil.example/x", p256dh: "p", auth: "a" }, db)).rejects.toThrow(/endpoint/);
    await expect(saveSubscription(u.qa, { endpoint: "https://push.example/z", p256dh: "", auth: "a" }, db)).rejects.toThrow(/keys/);
  });
});
