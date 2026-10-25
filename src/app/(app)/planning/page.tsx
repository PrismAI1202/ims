import { requirePermission } from "@/server/auth/guard";
import { PlanningView } from "@/components/demo/planning-view";

export const instant = false;

export default async function PlanningPage() {
  await requirePermission("stock.view");
  return <PlanningView />;
}
