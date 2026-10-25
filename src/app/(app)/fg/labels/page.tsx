import { notFound } from "next/navigation";
import { requirePermission, runAction } from "@/server/auth/guard";
import { boxLabel } from "@/server/services/fg";
import { DomainError } from "@/server/services/inventory";
import { printerFromEnv, sendZpl, zplBoxLabel } from "@/server/services/zpl";
import { LabelCard } from "@/components/label-card";
import { DownloadLink } from "@/components/download-link";
import { btnCls, Flash } from "@/components/flash";

export const instant = false;

async function printToPrinter(formData: FormData) {
  "use server";
  await requirePermission("fg.pack");
  const boxes = String(formData.get("boxes") || "");
  const target = printerFromEnv();
  await runAction(`/fg/labels?boxes=${encodeURIComponent(boxes)}`, "Sent to the label printer.", async () => {
    if (!target) throw new DomainError("No label printer is configured. Set PRINTER_HOST.");
    const labels = (await Promise.all(boxes.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 200).map((c) => boxLabel(c)))).filter((l) => l !== null);
    if (labels.length === 0) throw new DomainError("No labels to print.");
    try {
      await sendZpl(target, labels.map((l) => zplBoxLabel(l, l.boxCode)).join(""));
    } catch (e) {
      throw new DomainError(e instanceof Error ? e.message : "Printing failed.");
    }
  });
}

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ boxes?: string; error?: string; ok?: string }> }) {
  await requirePermission("fg.pack");
  const { boxes, error, ok } = await searchParams;
  const codes = (boxes ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 200);
  if (codes.length === 0) notFound();

  const labels = (await Promise.all(codes.map((c) => boxLabel(c)))).filter((l) => l !== null);
  if (labels.length === 0) notFound();

  return (
    <div className="space-y-4">
      <Flash error={error} ok={ok} />
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 print:hidden">
        <span>{labels.length} label{labels.length > 1 ? "s" : ""}. Use your browser&apos;s Print for a normal printer.</span>
        <DownloadLink href={`/api/v1/zpl?boxes=${encodeURIComponent(codes.join(","))}`}>Download ZPL for a thermal printer</DownloadLink>
        {printerFromEnv() && (
          <form action={printToPrinter}><input type="hidden" name="boxes" value={codes.join(",")} /><button className={btnCls}>Send to label printer</button></form>
        )}
      </div>
      <div className="flex flex-wrap gap-4 print:block">
        {labels.map((l) => <LabelCard key={l.boxCode} label={l} boxCode={l.boxCode} />)}
      </div>
    </div>
  );
}
