import { requirePermission } from "@/server/auth/guard";
import { processStages } from "@/server/services/process";
import { ProcessView } from "@/components/process-view";

export const instant = false;

export default async function ProcessPage() {
  const user = await requirePermission("stock.view");
  const [auto, non] = await Promise.all([processStages("auto"), processStages("non")]);
  return <ProcessView role={user.role} stagesBySegment={{ auto, non }} />;
}
