import { db } from "@/server/db";
import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { pickableLots } from "@/server/services/inventory";
import { sortForPicking } from "@/server/services/fifo";

// GET /api/v1/open-lines — open material request lines with FIFO/FEFO-ordered lots.
// The scanner caches this so the issue screen still works offline.
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "stock.issue")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const requests = await db.materialRequest.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { createdAt: "asc" },
    include: { lines: { include: { item: true } } },
  });
  const lines = await Promise.all(
    requests.flatMap((r) =>
      r.lines
        .filter((l) => Number(l.issuedQty) < Number(l.qty))
        .map(async (l) => ({
          requestLineId: l.id,
          requestNumber: r.requestNumber,
          itemCode: l.item.code, itemName: l.item.name, uom: l.item.uom,
          remaining: Number(l.qty) - Number(l.issuedQty),
          lots: sortForPicking(await pickableLots(l.itemId)).map((p) => ({
            lotNumber: p.lotNumber, available: p.available, locations: p.locations,
          })),
        })),
    ),
  );
  return Response.json({ lines, fetchedAt: new Date().toISOString() });
}
