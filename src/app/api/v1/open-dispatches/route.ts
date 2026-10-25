import { db } from "@/server/db";
import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { dispatchProgress } from "@/server/services/dispatch";

// GET /api/v1/open-dispatches — dispatches still being loaded, with their pick lists, for the scanner (cached offline).
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "dispatch.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const open = await db.dispatch.findMany({ where: { status: "LOADING" }, orderBy: { createdAt: "asc" }, include: { customer: true } });
  const dispatches = await Promise.all(open.map(async (d) => {
    const p = await dispatchProgress(d.id);
    return { id: d.id, dcNumber: d.dcNumber, customer: d.customer.name, vehicle: d.vehicleNumber, lines: p.lines.map((l) => ({ code: l.code, ordered: l.ordered, scanned: l.scanned })) };
  }));
  return Response.json({ dispatches, fetchedAt: new Date().toISOString() });
}
