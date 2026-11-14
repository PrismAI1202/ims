// How ticked MRP rows turn into POs. One rule, used by the server when it creates them and by the screen when it previews them:
// rows for the same supplier go on one PO (or one each when clubbing is off), and automotive (Kanban) lines never share a PO with
// non-automotive ones, because the segment decides whether a COA is mandatory at GRN.

export type PoSegment = "AUTOMOTIVE" | "NON_AUTOMOTIVE";
export const segmentOf = (policy: "KANBAN" | "ROP"): PoSegment => (policy === "KANBAN" ? "AUTOMOTIVE" : "NON_AUTOMOTIVE");

export interface PoGroup<T> { key: string; supplierId: string; segment: PoSegment; lines: T[] }

export function groupForPos<T extends { itemId: string; supplierId: string; policy: "KANBAN" | "ROP" }>(lines: T[], club = true): PoGroup<T>[] {
  const groups = new Map<string, PoGroup<T>>();
  for (const l of lines) {
    const segment = segmentOf(l.policy);
    const key = club ? `${l.supplierId}:${segment}` : `${l.supplierId}:${segment}:${l.itemId}`;
    const g = groups.get(key) ?? { key, supplierId: l.supplierId, segment, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  return [...groups.values()];
}
