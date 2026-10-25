import { can } from "@/server/auth/permissions";
import { requirePermission, runAction } from "@/server/auth/guard";
import { computeMetrics } from "@/server/services/metrics";
import { setShiftMinutes } from "@/server/services/settings";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { MetricsView } from "@/components/metrics-view";
import { Card } from "@/components/ui";

export const instant = false;

async function saveShift(formData: FormData) {
  "use server";
  await requirePermission("masters.manage");
  await runAction("/metrics", "Shift length saved.", async () => { await setShiftMinutes(Number(formData.get("minutes"))); });
}

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requirePermission("stock.view");
  const { error, ok } = await searchParams;
  const data = await computeMetrics();
  return (
    <MetricsView
      data={data}
      footer={
        <>
          <Flash error={error} ok={ok} />
          {can(user.role, "masters.manage") && (
            <Card>
              <form action={saveShift} className="flex flex-wrap items-end gap-3">
                <label className="text-[13px]">Shift length (minutes)
                  <input name="minutes" type="number" min="60" max="720" step="1" required defaultValue={data.shiftMinutes} className={`${inputCls} w-40`} />
                </label>
                <button className={btnCls}>Save</button>
                <p className="text-xs text-ink-3">Planned time for OEE is this many minutes for every machine-shift that ran or stopped.</p>
              </form>
            </Card>
          )}
        </>
      }
    />
  );
}
