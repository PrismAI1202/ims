// Types and constants shared by the Process service and its client view (no server imports here).
import type { ViewKey } from "./views";

export interface ProcessPhoto { name: string; href?: string }
export interface ProcessEntry {
  id: string; by: string; init: string; avBg: string; time: string; status: string;
  photos: ProcessPhoto[]; fields: [string, string][];
}
export interface ProcessStage {
  key: string; view: ViewKey; perm?: string; name: string; role: string; owners: string[]; color: string; rule: string;
  proofs: string[]; link: string; linkLabel: string; desc: string; entries: ProcessEntry[];
}

/** Statuses that mean someone still has to act. */
export const PENDING_STATUSES = ["Pending QC", "Draft", "Picking", "Review", "Waiting", "Pending", "Hold", "Open", "In progress", "Due", "Planned", "To put away"];
