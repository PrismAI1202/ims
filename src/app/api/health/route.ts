import { db } from "@/server/db";

// GET /api/health — for load balancers and container health checks. Public, and reveals nothing beyond up/down.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
