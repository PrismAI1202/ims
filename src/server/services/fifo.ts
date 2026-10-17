export interface PickableLot {
  lotId: string;
  lotNumber: string;
  receivedAt: Date;
  expiryDate: Date | null;
  available: number;
}

// FEFO when an expiry date exists, otherwise FIFO by receipt date.
export function sortForPicking<T extends PickableLot>(lots: T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      const d = a.expiryDate.getTime() - b.expiryDate.getTime();
      if (d !== 0) return d;
    } else if (a.expiryDate) {
      return -1;
    } else if (b.expiryDate) {
      return 1;
    }
    return a.receivedAt.getTime() - b.receivedAt.getTime();
  });
}

export interface Suggestion {
  lotId: string;
  lotNumber: string;
  qty: number;
}

// Greedy allocation across lots in pick order.
export function suggestPicks(lots: PickableLot[], needed: number): { picks: Suggestion[]; shortfall: number } {
  const picks: Suggestion[] = [];
  let remaining = needed;
  for (const lot of sortForPicking(lots.filter((l) => l.available > 0))) {
    if (remaining <= 0) break;
    const take = Math.min(lot.available, remaining);
    picks.push({ lotId: lot.lotId, lotNumber: lot.lotNumber, qty: take });
    remaining -= take;
  }
  return { picks, shortfall: Math.max(remaining, 0) };
}

// A scanned lot is FIFO-compliant only if no older pickable lot still has stock.
export function checkFifo(
  lots: PickableLot[],
  scannedLotId: string,
): { ok: true } | { ok: false; shouldPick: PickableLot } {
  const ordered = sortForPicking(lots.filter((l) => l.available > 0));
  const first = ordered[0];
  if (!first || first.lotId === scannedLotId) return { ok: true };
  return { ok: false, shouldPick: first };
}
