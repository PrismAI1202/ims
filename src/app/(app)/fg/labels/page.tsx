import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { boxLabel } from "@/server/services/fg";
import { LabelCard } from "@/components/label-card";

export const instant = false;

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ boxes?: string }> }) {
  await requirePermission("fg.pack");
  const { boxes } = await searchParams;
  const codes = (boxes ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 200);
  if (codes.length === 0) notFound();

  const labels = (await Promise.all(codes.map((c) => boxLabel(c)))).filter((l) => l !== null);
  if (labels.length === 0) notFound();

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 print:hidden">{labels.length} label{labels.length > 1 ? "s" : ""}. Use your browser&apos;s Print to send them to the label printer, one per page.</p>
      <div className="flex flex-wrap gap-4 print:block">
        {labels.map((l) => <LabelCard key={l.boxCode} label={l} boxCode={l.boxCode} />)}
      </div>
    </div>
  );
}
