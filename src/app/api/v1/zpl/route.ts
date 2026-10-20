import { getApiUser } from "@/server/auth/api-auth";
import { can, type Permission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { boxLabel } from "@/server/services/fg";
import { zplBinLabel, zplBoxLabel, zplLotTag } from "@/server/services/zpl";

// GET /api/v1/zpl?boxes=BX-1,BX-2 | ?lot=<lot number> | ?bins=A-01-01,A-01-02 — ZPL II label jobs as a text file.
// Send the file to any Zebra-compatible printer (copy to its USB queue, or use the app's "Send to printer").
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const need = (p: Permission) => can(user.role, p);
  const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  let zpl = "";
  let name = "labels";

  if (q.get("boxes")) {
    if (!need("fg.pack")) return Response.json({ error: "Forbidden" }, { status: 403 });
    for (const code of list(q.get("boxes"))) {
      const l = await boxLabel(code);
      if (l) zpl += zplBoxLabel(l, l.boxCode);
    }
    name = "box-labels";
  } else if (q.get("lot")) {
    if (!need("stock.view")) return Response.json({ error: "Forbidden" }, { status: 403 });
    const lot = await db.lot.findUnique({ where: { lotNumber: q.get("lot")!.trim() }, include: { item: true } });
    if (!lot || lot.qcStatus === "PENDING_QC" || lot.qcStatus === "REJECTED") return Response.json({ error: "Not found" }, { status: 404 });
    zpl = zplLotTag({
      itemCode: lot.item.code, itemName: lot.item.name, lotNumber: lot.lotNumber, supplierLotNo: lot.supplierLotNo,
      qty: `${Number(lot.receivedQty)} ${lot.item.uom}`, status: lot.qcStatus === "DEVIATED" ? "ACCEPTED (DEVIATION)" : "APPROVED",
    });
    name = `lot-${lot.lotNumber}`;
  } else if (q.get("bins")) {
    if (!need("masters.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
    const bins = await db.location.findMany({ where: { code: { in: list(q.get("bins")) } }, orderBy: { code: "asc" } });
    zpl = bins.map((b) => zplBinLabel(b.code)).join("");
    name = "bin-labels";
  } else {
    return Response.json({ error: "Specify boxes, lot or bins" }, { status: 400 });
  }

  if (!zpl) return Response.json({ error: "Nothing to print" }, { status: 404 });
  return new Response(zpl, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.zpl"` } });
}
