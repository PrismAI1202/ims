import { requirePermission } from "@/server/auth/guard";
import { SyncView } from "@/components/sync-view";

export const instant = false;

export default async function SyncPage() {
  const user = await requirePermission("stock.view");
  return <SyncView device={user.name ?? "THIS DEVICE"} />;
}
