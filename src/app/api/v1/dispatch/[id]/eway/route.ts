import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { challanData } from "@/server/services/dispatch";

// GET /api/v1/dispatch/:id/eway — e-way bill (delivery challan) data as a JSON file for upload or API hand-off.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "dispatch.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!(await db.dispatch.findUnique({ where: { id }, select: { id: true } }))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { eway } = await challanData(id);
  return new Response(JSON.stringify(eway, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="eway-${eway.docNo}.json"` },
  });
}
