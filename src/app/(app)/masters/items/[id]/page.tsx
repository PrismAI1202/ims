import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { btnCls, Flash } from "@/components/flash";
import { Card, PageHeader } from "@/components/ui";
import { saveItem } from "../../actions";
import { ItemFields } from "../../item-fields";

export const instant = false;

export default async function EditItem({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requirePermission("masters.manage");
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const item = await db.item.findUnique({ where: { id } });
  if (!item) notFound();

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="ADMIN · MASTERS" title={`Edit ${item.code}`} subtitle={item.name}>
        <Link href="/masters?tab=items" className="text-sm font-semibold">← Items</Link>
      </PageHeader>
      <Flash error={error} />
      <Card>
        <form action={saveItem} className="space-y-4">
          <input type="hidden" name="id" value={item.id} />
          <ItemFields d={{
            code: item.code, name: item.name, category: item.category, uom: item.uom, polymerGrade: item.polymerGrade,
            minStock: Number(item.minStock), reorderPoint: Number(item.reorderPoint), maxStock: Number(item.maxStock),
            safetyStock: Number(item.safetyStock), shelfLifeDays: item.shelfLifeDays, requiresCoa: item.requiresCoa,
            maxRegrindPct: item.maxRegrindPct === null ? null : Number(item.maxRegrindPct),
            stockTracked: item.stockTracked, hsnCode: item.hsnCode, unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
          }} />
          <button className={`${btnCls} w-full md:w-auto`}>Save changes</button>
        </form>
      </Card>
    </div>
  );
}
