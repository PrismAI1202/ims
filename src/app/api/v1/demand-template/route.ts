import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { DEMAND_TEMPLATE_CSV } from "@/server/services/demand-import";

export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "mrp.plan")) return Response.json({ error: "Forbidden" }, { status: 403 });
  return new Response(DEMAND_TEMPLATE_CSV, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="demand-template.csv"' },
  });
}
