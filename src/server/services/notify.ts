import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { can, resolveAccess, type Permission } from "@/server/auth/permissions";
import type { ViewKey } from "@/lib/views";

type Db = PrismaClient;

// Web Push for new inbox tasks. The next person in a hand-over gets a notification on their phone; tapping it opens the
// screen where the work is done. No email or WhatsApp. Without VAPID keys in the environment nothing is sent.

export interface PushPayload { title: string; body: string; url: string; tag?: string }
export interface PushTarget { endpoint: string; p256dh: string; auth: string }
/** Sends one notification. Resolves "gone" when the push service says the subscription no longer exists. */
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<"sent" | "gone">;

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let configured = false;
/** The real sender, backed by the web-push library. Loaded on first use so tests and builds don't need it. */
export const webPushSender: PushSender = async (t, payload) => {
  const wp = await import("web-push");
  if (!configured) {
    wp.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  try {
    await wp.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
    return "sent";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return "gone";
    throw e;
  }
};

export interface Audience {
  view: ViewKey;
  perm?: Permission; // also required, for tasks only some holders of the view act on
  exceptUserId?: string; // whoever caused the event doesn't need telling
}

/** Active users whose role has the screen (and permission) the task is done on. */
export async function audience(a: Audience, db: Db = defaultDb): Promise<string[]> {
  const users = await db.user.findMany({
    where: { active: true, ...(a.exceptUserId ? { id: { not: a.exceptUserId } } : {}), pushes: { some: {} } },
    select: { id: true, access: true },
  });
  return users
    .filter((u) => {
      const acc = resolveAccess(u.access);
      return acc.views.includes(a.view) && (!a.perm || can(acc, a.perm));
    })
    .map((u) => u.id);
}

/**
 * Notifies everyone who has the screen. Never throws: a failed push must not fail the action that caused it.
 * Returns how many notifications were delivered.
 */
export async function notifyView(a: Audience, payload: PushPayload, db: Db = defaultDb, send: PushSender = webPushSender): Promise<number> {
  try {
    if (send === webPushSender && !pushConfigured()) return 0;
    const ids = await audience(a, db);
    if (ids.length === 0) return 0;
    const subs = await db.pushSubscription.findMany({ where: { userId: { in: ids } } });
    let delivered = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        if ((await send(s, payload)) === "gone") dead.push(s.id);
        else delivered++;
      } catch (e) {
        console.error("push failed", s.endpoint.slice(0, 40), e instanceof Error ? e.message : e);
      }
    }));
    if (dead.length) await db.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    return delivered;
  } catch (e) {
    console.error("notify failed", e instanceof Error ? e.message : e);
    return 0;
  }
}

export interface SubscriptionInput { endpoint: string; p256dh: string; auth: string; userAgent?: string }

/** Saves this device's subscription for a user (a device that changes hands moves to the new user). */
export async function saveSubscription(userId: string, s: SubscriptionInput, db: Db = defaultDb) {
  if (!/^https:\/\//.test(s.endpoint)) throw new Error("Invalid push endpoint.");
  if (!s.p256dh || !s.auth) throw new Error("Invalid push keys.");
  await db.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    update: { userId, p256dh: s.p256dh, auth: s.auth, userAgent: s.userAgent },
    create: { userId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, userAgent: s.userAgent },
  });
}

export async function removeSubscription(userId: string, endpoint: string, db: Db = defaultDb) {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
}
