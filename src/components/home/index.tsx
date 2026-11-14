import type { HomeWidgetKey } from "@/lib/home-widgets";
import { Approvals } from "./approvals";
import { MyMachines } from "./my-machines";
import { NeedsYou } from "./needs-you";
import { PlantOverview } from "./plant-overview";
import { QcQueue } from "./qc-queue";
import { QuickActions } from "./quick-actions";
import { StockHealth } from "./stock-health";
import { TodaysShipments } from "./todays-shipments";
import type { HomeProps } from "./types";

export const WIDGET_COMPONENTS: Record<HomeWidgetKey, (p: HomeProps) => React.ReactNode | Promise<React.ReactNode>> = {
  "needs-you": NeedsYou,
  "stock-health": StockHealth,
  "quick-actions": QuickActions,
  "my-machines": MyMachines,
  "todays-shipments": TodaysShipments,
  "qc-queue": QcQueue,
  "plant-overview": PlantOverview,
  approvals: Approvals,
};
