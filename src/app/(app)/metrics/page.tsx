import { requirePermission } from "@/server/auth/guard";
import { stockByItem } from "@/server/services/stock";
import { MetricsView } from "@/components/demo/metrics-view";

export const instant = false;

export default async function MetricsPage() {
  await requirePermission("stock.view");
  const rows = await stockByItem();
  return <MetricsView belowMin={rows.filter((r) => r.status === "RED").length} />;
}
