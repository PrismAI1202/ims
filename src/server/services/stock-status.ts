export type StockStatus = "RED" | "YELLOW" | "GREEN";

export interface StockLevels {
  minStock: number;
  reorderPoint: number;
}

// SRS Module 3: Red = below Min, Yellow = near/at ROP, Green = optimal.
export function stockStatus(onHand: number, levels: StockLevels): StockStatus {
  if (onHand < levels.minStock) return "RED";
  if (onHand <= levels.reorderPoint) return "YELLOW";
  return "GREEN";
}
