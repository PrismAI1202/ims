import { hubTabs, viewDef } from "@/lib/views";

// The tabs of the Quality hub. Which of them a role sees comes from the permissions it holds (see the `tabs` of the quality view
// in views.ts), so Settings and the screen itself read from the same list.

export type QualityTab = "inward" | "scrap" | "pdi" | "firstoff" | "rtv";

export const QUALITY_TAB_LABEL: Record<QualityTab, string> = {
  inward: "Inward QC", scrap: "Scrap", pdi: "Final inspection", firstoff: "First-off", rtv: "Return to supplier",
};

/** The Quality tabs a user may open, in the hub's order. */
export function qualityTabs(permissions: readonly string[]): QualityTab[] {
  return hubTabs(viewDef("quality")!, permissions) as QualityTab[];
}

export const isQualityTab = (v: string | undefined): v is QualityTab => !!v && v in QUALITY_TAB_LABEL;

/** Where a tab lives, for links from Home, the inbox, notifications and Process. */
export const qualityHref = (tab: QualityTab) => `/quality?tab=${tab}`;
