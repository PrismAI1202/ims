import { requirePermission } from "@/server/auth/guard";
import { EquivalentsView } from "@/components/demo/equivalents-view";

export const instant = false;

export default async function EquivalentsPage() {
  await requirePermission("stock.view");
  return <EquivalentsView />;
}
