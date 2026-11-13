import { requireView } from "@/server/auth/guard";
import { processStages } from "@/server/services/process";
import { ProcessView } from "@/components/process-view";

export const instant = false;

export default async function ProcessPage() {
  const user = await requireView("process");
  const [auto, non] = await Promise.all([processStages("auto"), processStages("non")]);
  return <ProcessView roleName={user.roleName} views={user.views} permissions={user.permissions} stagesBySegment={{ auto, non }} />;
}
