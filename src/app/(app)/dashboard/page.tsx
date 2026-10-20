import { stockByItem } from "@/server/services/stock";
import { DownloadLink } from "@/components/download-link";
import { requirePermission } from "@/server/auth/guard";
import { Flash } from "@/components/flash";

const BADGE = {
  RED: "bg-red-100 text-red-800",
  YELLOW: "bg-yellow-100 text-yellow-800",
  GREEN: "bg-green-100 text-green-800",
} as const;
const LABEL = { RED: "Below Min", YELLOW: "Near ROP", GREEN: "Optimal" } as const;

export const instant = false;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("stock.view");
  const { error } = await searchParams;
  const rows = await stockByItem();
  const count = (s: keyof typeof BADGE) => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Live Stock &amp; Min/Max Dashboard</h1>
      <Flash error={error} />
      <p className="flex gap-4 text-sm print:hidden">
        <DownloadLink href={"/api/v1/export/stock?format=xlsx"}>Download Excel</DownloadLink>
        <DownloadLink href={"/api/v1/export/stock?format=csv"}>Download CSV</DownloadLink>
        <span className="text-slate-500">To get a PDF, use your browser&apos;s Print and choose Save as PDF.</span>
      </p>
      <div className="grid grid-cols-3 gap-3 max-w-xl">
        {(["RED", "YELLOW", "GREEN"] as const).map((s) => (
          <div key={s} className={`rounded-lg p-4 ${BADGE[s]}`}>
            <div className="text-2xl font-bold">{count(s)}</div>
            <div className="text-xs">{LABEL[s]}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-2">Item</th><th className="p-2">Category</th>
              <th className="p-2 text-right">On hand</th><th className="p-2 text-right">Pending QC</th>
              <th className="p-2 text-right">Min</th><th className="p-2 text-right">ROP</th>
              <th className="p-2 text-right">Max</th><th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.itemId} className="border-t">
                <td className="p-2"><div className="font-medium">{r.code}</div><div className="text-slate-500">{r.name}</div></td>
                <td className="p-2">{r.category.replace("_", " ")}</td>
                <td className="p-2 text-right">{r.onHand.toLocaleString()} {r.uom}</td>
                <td className="p-2 text-right">{r.pendingQc.toLocaleString()}</td>
                <td className="p-2 text-right">{r.minStock.toLocaleString()}</td>
                <td className="p-2 text-right">{r.reorderPoint.toLocaleString()}</td>
                <td className="p-2 text-right">{r.maxStock.toLocaleString()}</td>
                <td className="p-2"><span className={`rounded px-2 py-1 text-xs font-medium ${BADGE[r.status]}`}>{LABEL[r.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
