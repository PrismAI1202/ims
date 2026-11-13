import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { DomainError } from "@/server/services/inventory";
import { createItemWithSupplier } from "@/server/services/masters";

// POST /api/v1/items — creates an item (part, resin, masterbatch, insert, packaging...) and, optionally, the supplier and buying
// price that make it orderable. The BOM editor calls this so a new part or material can be added without leaving the form.
// Body: the item fields (code, name, category, uom, minStock, reorderPoint, maxStock, polymerGrade, maxRegrindPct...) plus optional supplierId and price.
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "masters.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid request" }, { status: 400 });
  const { supplierId, price, ...fields } = body;
  const supplier = typeof supplierId === "string" && supplierId ? { supplierId, price: Number(price) } : null;
  if (supplier && (price === "" || price === null || price === undefined)) return Response.json({ error: "Enter the buying price for that supplier." }, { status: 400 });

  try {
    // Resin is COA-controlled by default, as it is when materials come in through a BOM import.
    const item = await createItemWithSupplier({ requiresCoa: fields.category === "RM_RESIN", ...fields }, supplier);
    return Response.json({
      item: { id: item.id, code: item.code, name: item.name, uom: item.uom, category: item.category, polymerGrade: item.polymerGrade, maxRegrindPct: item.maxRegrindPct === null ? null : Number(item.maxRegrindPct) },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof DomainError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
