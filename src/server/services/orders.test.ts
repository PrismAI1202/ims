import { describe, expect, it } from "vitest";
import { filterOrders, orderParties, paginate, type OrderRow } from "./orders";

const row = (over: Partial<OrderRow>): OrderRow => ({
  key: "k", id: "i", type: "PO", direction: "BUY", partyId: "s1", segment: "NON_AUTOMOTIVE", searchText: "", actions: [],
  number: "PO-1", party: "PolyChem", kind: "PO", status: "APPROVED", state: "open", tone: "info", date: new Date("2026-11-01T00:00:00Z"), href: "/purchase/i",
  lines: [{ label: "RM-PP", sub: "PP Homopolymer", done: 0, total: 100, uom: "KG" }], ...over,
});

const rows: OrderRow[] = [
  row({ key: "a", number: "PO-001", state: "open", date: new Date("2026-11-01T00:00:00Z") }),
  row({ key: "b", number: "PO-002", state: "overdue", status: "LATE", partyId: "s2", party: "PackRight", segment: "AUTOMOTIVE", searchText: "automotive", date: new Date("2026-10-10T00:00:00Z") }),
  row({ key: "c", number: "PO-003", state: "closed", status: "CLOSED", date: new Date("2026-09-01T00:00:00Z") }),
  row({ key: "d", type: "DISPATCH", direction: "SELL", partyId: "c1", party: "Apex Motors", segment: "AUTOMOTIVE", number: "DC-001", kind: "Dispatch", status: "LOADING", state: "open", searchText: "mh12ab1234 ravi automotive", date: new Date("2026-11-05T00:00:00Z"), lines: [{ label: "FG-CLIP", total: 500, uom: "pcs" }] }),
  row({ key: "e", type: "DEMAND", direction: "SELL", partyId: "c1", party: "Apex Motors", segment: "AUTOMOTIVE", number: "FIRM · FG-CLIP", kind: "Firm order", status: "PAST DUE", state: "overdue", date: new Date("2026-10-20T00:00:00Z"), lines: [{ label: "FG-CLIP", total: 900, uom: "pcs" }] }),
  row({ key: "f", type: "DISPATCH", direction: "SELL", partyId: "c2", party: "Bright Home", segment: "NON_AUTOMOTIVE", number: "DC-002", kind: "Dispatch", status: "DISPATCHED", state: "closed", date: new Date("2026-10-01T00:00:00Z"), lines: [{ label: "FG-HS40", total: 100, uom: "pcs" }] }),
];
const keys = (f: Parameters<typeof filterOrders>[1]) => filterOrders(rows, f).map((r) => r.key);

describe("filterOrders", () => {
  it("returns everything, newest first, with no filters", () => {
    expect(keys({})).toEqual(["d", "a", "e", "b", "f", "c"]);
    expect(keys({ sort: "old" })).toEqual(["c", "f", "b", "e", "a", "d"]);
  });
  it("splits incoming from outgoing, and by type", () => {
    expect(keys({ dir: "BUY" })).toEqual(["a", "b", "c"]);
    expect(keys({ dir: "SELL" })).toEqual(["d", "e", "f"]);
    expect(keys({ kind: "dispatch" })).toEqual(["d", "f"]);
    expect(keys({ kind: "demand" })).toEqual(["e"]);
    expect(keys({ dir: "BUY", kind: "dispatch" })).toEqual([]);
  });
  it("active means open or overdue; overdue and closed are exact", () => {
    expect(keys({ state: "active" })).toEqual(["d", "a", "e", "b"]);
    expect(keys({ state: "overdue" })).toEqual(["e", "b"]);
    expect(keys({ state: "closed" })).toEqual(["f", "c"]);
  });
  it("filters by supplier or customer and by segment", () => {
    expect(keys({ party: "c1" })).toEqual(["d", "e"]);
    expect(keys({ segment: "AUTOMOTIVE" })).toEqual(["d", "e", "b"]);
    expect(keys({ party: "c1", segment: "NON_AUTOMOTIVE" })).toEqual([]);
  });
  it("filters by an inclusive date range", () => {
    expect(keys({ from: "2026-10-10", to: "2026-10-20" })).toEqual(["e", "b"]);
    expect(keys({ from: "2026-11-01" })).toEqual(["d", "a"]);
    expect(keys({ to: "2026-09-30" })).toEqual(["c"]);
  });
  it("searches every word across number, party, parts, vehicle and status", () => {
    expect(keys({ q: "apex" })).toEqual(["d", "e"]);
    expect(keys({ q: "mh12ab1234" })).toEqual(["d"]);
    expect(keys({ q: "po-00 packright" })).toEqual(["b"]);
    expect(keys({ q: "fg-clip loading" })).toEqual(["d"]);
    expect(keys({ q: "  " })).toHaveLength(6);
    expect(keys({ q: "nothing like this" })).toEqual([]);
  });
  it("combines filters and does not change the rows it was given", () => {
    const before = rows.map((r) => r.key).join();
    expect(keys({ dir: "SELL", state: "active", segment: "AUTOMOTIVE", from: "2026-10-15" })).toEqual(["d", "e"]);
    expect(rows.map((r) => r.key).join()).toBe(before);
  });
});

describe("orderParties", () => {
  it("lists each supplier and customer once, by name", () => {
    expect(orderParties(rows).map((p) => `${p.name}:${p.direction}`)).toEqual(["Apex Motors:SELL", "Bright Home:SELL", "PackRight:BUY", "PolyChem:BUY"]);
  });
});

describe("paginate", () => {
  const list = Array.from({ length: 60 }, (_, i) => i + 1);
  it("pages in 25s and reports the range", () => {
    expect(paginate(list, 1)).toMatchObject({ page: 1, pages: 3, total: 60, from: 1, to: 25 });
    expect(paginate(list, 3)).toMatchObject({ page: 3, from: 51, to: 60, rows: list.slice(50) });
  });
  it("clamps bad page numbers and handles an empty list", () => {
    expect(paginate(list, 99).page).toBe(3);
    expect(paginate(list, -4).page).toBe(1);
    expect(paginate(list, Number.NaN).page).toBe(1);
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, total: 0, from: 0, to: 0, rows: [] });
  });
});
