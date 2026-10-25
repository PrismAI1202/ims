import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { DownloadLink } from "@/components/download-link";

export const instant = false;

// Rack/shelf/bin labels: Code 128, so any handheld scanner reads them without a camera.
export default async function BinLabelsPage() {
  await requirePermission("masters.manage");
  const bins = await db.location.findMany({ where: { type: "STORAGE" }, orderBy: { code: "asc" } });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 print:hidden">
        <span>{bins.length} bin labels. Use your browser&apos;s Print.</span>
        <DownloadLink href={`/api/v1/zpl?bins=${encodeURIComponent(bins.map((b) => b.code).join(","))}`}>Download ZPL for a thermal printer</DownloadLink>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 print:grid-cols-3">
        {bins.map((b) => (
          <div key={b.id} className="break-inside-avoid rounded border-2 border-black bg-white p-3 text-center text-black">
            <div className="text-2xl font-bold">{b.code}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/barcode?type=code128&text=${encodeURIComponent(b.code)}`} alt={`Barcode ${b.code}`} className="mx-auto mt-1 h-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
