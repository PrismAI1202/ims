import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { BOM_TEMPLATE_CSV } from "@/server/services/bom-import";

// GET /api/v1/bom-template — CSV template for importing BOMs from a file.
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "bom.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  return new Response(BOM_TEMPLATE_CSV, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="bom-template.csv"' },
  });
}
