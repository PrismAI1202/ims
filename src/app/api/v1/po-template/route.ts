import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { PO_TEMPLATE_CSV } from "@/server/services/po-import";

// GET /api/v1/po-template — CSV template for loading supplier POs from a file.
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "po.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  return new Response(PO_TEMPLATE_CSV, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="supplier-po-template.csv"' },
  });
}
