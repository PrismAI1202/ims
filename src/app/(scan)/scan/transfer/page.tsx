import { requirePermission } from "@/server/auth/guard";
import { TransferForm } from "./transfer-form";

export const instant = false;

export default async function ScanTransfer() {
  await requirePermission("stock.transfer");
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Bin transfer / put-away</h1>
      <TransferForm />
    </div>
  );
}
