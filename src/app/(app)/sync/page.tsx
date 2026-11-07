import { requireUser } from "@/server/auth/guard";
import { SyncView } from "@/components/sync-view";

export const instant = false;

export default async function SyncPage() {
  const user = await requireUser();
  return <SyncView device={user.name ?? "THIS DEVICE"} />;
}
