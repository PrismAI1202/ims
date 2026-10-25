import { requirePermission } from "@/server/auth/guard";
import { MaintenanceView } from "@/components/demo/maintenance-view";

export const instant = false;

export default async function MaintenancePage() {
  await requirePermission("stock.view");
  return <MaintenanceView />;
}
