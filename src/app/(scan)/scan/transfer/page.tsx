import { requirePermission } from "@/server/auth/guard";
import { TransferForm } from "./transfer-form";

export const instant = false;

export default async function ScanTransfer() {
  await requirePermission("stock.transfer");
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Bin transfer / put-away</h1>
      <TransferForm />
    </div>
  );
}
