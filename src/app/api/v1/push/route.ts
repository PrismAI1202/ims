import { z } from "zod";
import { getApiUser } from "@/server/auth/api-auth";
import { pushConfigured, removeSubscription, saveSubscription, vapidPublicKey } from "@/server/services/notify";

// GET    /api/v1/push -> { configured, publicKey }   what the browser needs to subscribe
// POST   /api/v1/push -> save this device's subscription ({ endpoint, keys: { p256dh, auth } })
// DELETE /api/v1/push -> forget it ({ endpoint })
const sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) });

export async function GET(req: Request) {
  if (!(await getApiUser(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ configured: pushConfigured(), publicKey: vapidPublicKey() });
}

export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = sub.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid subscription" }, { status: 400 });
  try {
    await saveSubscription(user.id, { endpoint: body.data.endpoint, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth, userAgent: req.headers.get("user-agent") ?? undefined });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid subscription" }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = z.object({ endpoint: z.string() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  await removeSubscription(user.id, body.data.endpoint);
  return Response.json({ ok: true });
}
