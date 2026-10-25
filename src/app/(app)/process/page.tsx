import { requirePermission } from "@/server/auth/guard";
import { ProcessView } from "@/components/demo/process-view";

export const instant = false;

export default async function ProcessPage() {
  const user = await requirePermission("stock.view");
  return <ProcessView role={user.role} />;
}
