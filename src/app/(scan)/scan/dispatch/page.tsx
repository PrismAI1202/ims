import { requirePermission } from "@/server/auth/guard";
import { DispatchScanForm } from "./dispatch-scan-form";

export const instant = false;

export default async function ScanDispatch() {
  await requirePermission("dispatch.manage");
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Load a dispatch</h1>
      <DispatchScanForm />
    </div>
  );
}
