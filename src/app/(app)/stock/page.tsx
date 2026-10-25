import { db } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { transferStock } from "@/server/services/inventory";
import { btnCls, Flash, inputCls } from "@/components/flash";
import Link from "next/link";
import { ScanLine } from "lucide-react";
import { Badge, Card, DataTable, headerBtnCls, Mono, PageHeader, StoresTabs } from "@/components/ui";

export const instant = false;

async function transfer(formData: FormData) {
  "use server";
  const user = await requirePermission("stock.transfer");
  await runAction("/stock", "Stock moved.", async () => {
    await transferStock({
      lotNumber: String(formData.get("lotNumber")).trim(),
      fromCode: String(formData.get("fromCode")).trim(),
      toCode: String(formData.get("toCode")).trim(),
      qty: Number(formData.get("qty")),
      userId: user.id,
    });
  });
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requirePermission("stock.view");
  const { error, ok } = await searchParams;
  const balances = await db.stockBalance.findMany({
    where: { qty: { gt: 0 } },
    include: { lot: { include: { item: true } }, location: true },
    orderBy: [{ location: { code: "asc" } }, { lot: { receivedAt: "asc" } }],
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="STORES"
        title="Stock & bins"
        right={can(user.role, "stock.transfer") ? (
          <Link href="/scan" className={headerBtnCls}><ScanLine size={16} aria-hidden /> Scan</Link>
        ) : undefined}
      >
        <StoresTabs active="/stock" />
      </PageHeader>
      <Flash error={error} ok={ok} />

      {can(user.role, "stock.transfer") && (
        <Card>
          <form action={transfer} className="grid gap-3 md:grid-cols-5">
            <label className="text-[13px]">Lot no.<input name="lotNumber" required placeholder="scan lot" className={inputCls} /></label>
            <label className="text-[13px]">From bin<input name="fromCode" required placeholder="scan bin" className={inputCls} /></label>
            <label className="text-[13px]">To bin<input name="toCode" required placeholder="scan bin" className={inputCls} /></label>
            <label className="text-[13px]">Qty<input name="qty" type="number" step="any" min="0" required className={inputCls} /></label>
            <div className="flex items-end"><button className={`${btnCls} w-full`}>Transfer</button></div>
          </form>
        </Card>
      )}

      <DataTable>
        <thead><tr>
          <th>Bin</th><th>Item</th><th>Lot</th>
          <th>Heat / mfr lot</th><th>QC</th><th className="text-right!">Qty</th>
        </tr></thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.id}>
              <td className="font-semibold"><Mono>{b.location.code}</Mono>{b.location.type === "STAGING" && " (staging)"}</td>
              <td>{b.lot.item.code}</td>
              <td><Mono className="text-xs">{b.lot.lotNumber}</Mono></td>
              <td><Mono className="text-xs">{b.lot.supplierLotNo}</Mono></td>
              <td><Badge tone={b.lot.qcStatus === "APPROVED" ? "ok" : b.lot.qcStatus === "REJECTED" ? "danger" : "warn"}>{b.lot.qcStatus}</Badge></td>
              <td className="text-right"><Mono>{Number(b.qty).toLocaleString()}</Mono> {b.lot.item.uom}</td>
            </tr>
          ))}
          {balances.length === 0 && <tr><td className="text-ink-3" colSpan={6}>No stock in any bin yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
  );
}
