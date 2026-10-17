import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { issueStock, pickableLots } from "@/server/services/inventory";
import { sortForPicking } from "@/server/services/fifo";
import { btnCls, Flash, inputCls } from "@/components/flash";

export const instant = false;

async function issue(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.issue");
  await runAction("/issue", "Issued to shop floor.", async () => {
    await issueStock({
      requestLineId: String(formData.get("requestLineId")),
      lotNumber: String(formData.get("lotNumber")).trim(),
      locationCode: String(formData.get("locationCode")).trim(),
      qty: Number(formData.get("qty")),
      fifoOverrideReason: String(formData.get("override") || "") || undefined,
      userId: user.id,
    });
  });
}

export default async function IssuePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("stock.issue");
  const { error, ok } = await searchParams;
  const requests = await db.materialRequest.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { createdAt: "asc" },
    include: { lines: { include: { item: true } } },
  });

  const rows = await Promise.all(
    requests.flatMap((r) =>
      r.lines
        .filter((l) => Number(l.issuedQty) < Number(l.qty))
        .map(async (l) => ({
          request: r, line: l, remaining: Number(l.qty) - Number(l.issuedQty),
          lots: sortForPicking(await pickableLots(l.itemId)),
        })),
    ),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Issue to Shop Floor</h1>
      <p className="text-sm text-slate-600">Pick in the order shown (FEFO/FIFO). Scanning a newer lot while an older one has stock is blocked unless you give a reason.</p>
      <Flash error={error} ok={ok} />
      {rows.length === 0 && <p className="text-slate-500">No open material requests.</p>}
      {rows.map(({ request, line, remaining, lots }) => (
        <form key={line.id} action={issue} className="max-w-4xl space-y-3 rounded-lg border bg-white p-4">
          <input type="hidden" name="requestLineId" value={line.id} />
          <div className="text-sm"><span className="font-semibold">{request.requestNumber}</span> · {line.item.code} {line.item.name} · <b>{remaining} {line.item.uom}</b> still to issue</div>
          <div className="text-sm text-slate-700">
            {lots.length === 0 ? <span className="text-red-700">No approved stock available.</span> : (
              <ol className="list-decimal pl-5">
                {lots.map((l) => (
                  <li key={l.lotId}>{l.lotNumber} — {l.locations.map((x) => `${x.code}: ${x.qty}`).join(", ")}{l.expiryDate && ` (exp ${l.expiryDate.toISOString().slice(0, 10)})`}</li>
                ))}
              </ol>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <label className="text-sm">Lot<input name="lotNumber" required defaultValue={lots[0]?.lotNumber} className={inputCls} /></label>
            <label className="text-sm">Bin<input name="locationCode" required defaultValue={lots[0]?.locations[0]?.code} className={inputCls} /></label>
            <label className="text-sm">Qty<input name="qty" type="number" step="any" min="0" required defaultValue={lots[0] ? Math.min(remaining, lots[0].available) : ""} className={inputCls} /></label>
            <label className="text-sm md:col-span-2">FIFO override reason (only if skipping)<input name="override" className={inputCls} /></label>
          </div>
          <button className={btnCls}>Issue</button>
        </form>
      ))}
    </div>
  );
}
