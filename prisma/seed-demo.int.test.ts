import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Loads the whole demo into the test database and checks the story it is meant to tell. The demo goes through the real services, so
// this also fails when a rule changes in a way that breaks the seed, before anyone finds out on the day of a demo.
const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
process.env.DATABASE_URL = url; // seed-demo creates its own client from this
const db = new PrismaClient({ datasourceUrl: url });

beforeAll(async () => {
  expect(url).toContain("ims_test");
  const tables = (await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`))
    .map((t) => t.tablename).filter((t) => !["_prisma_migrations", "AccessRole"].includes(t));
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  const { loadAllDemo } = await import("./seed-demo");
  await loadAllDemo();
}, 180_000);
afterAll(() => db.$disconnect());

describe("the demo data", () => {
  it("has customer orders for the next 30 days, a few overdue and a few completed", async () => {
    const { listOrders } = await import("../src/server/services/orders");
    const orders = (await listOrders(db)).filter((o) => o.type === "DEMAND");
    const by = (state: string) => orders.filter((o) => o.state === state);
    expect(by("closed")).toHaveLength(4);
    expect(by("closed").every((o) => o.status === "SHIPPED" && o.lines[0].done === o.lines[0].total)).toBe(true);
    expect(by("overdue")).toHaveLength(4);
    expect(by("overdue").some((o) => o.status === "PAST DUE" && (o.lines[0].done ?? 0) > 0)).toBe(true); // one is part-shipped
    const open = by("open");
    expect(open).toHaveLength(12);
    const today = Date.now();
    expect(open.every((o) => o.date.getTime() >= today - 86_400_000 && o.date.getTime() <= today + 31 * 86_400_000)).toBe(true);
  });

  it("has stock that is red, yellow and green, with a late PO, a part-received PO and a cancelled one", async () => {
    const { stockByItem } = await import("../src/server/services/stock");
    const status = Object.fromEntries((await stockByItem(db)).map((r) => [r.code, r.status]));
    expect([status["RM-PP-012"], status["BOP-INS-M4K"], status["PK-FILM-23"]]).toEqual(["RED", "RED", "RED"]);
    expect([status["RM-PA66-G30"], status["MB-GRY-7035"]]).toEqual(["YELLOW", "YELLOW"]);
    expect(status["RM-ABS-NAT"]).toBe("GREEN");
    const pos = await db.purchaseOrder.groupBy({ by: ["status"], _count: true });
    const n = (s: string) => pos.find((p) => p.status === s)?._count ?? 0;
    expect(n("PARTIAL")).toBe(1);
    expect(n("CANCELLED")).toBe(1);
    expect(n("APPROVED")).toBe(4);
    const { listOrders } = await import("../src/server/services/orders");
    expect((await listOrders(db)).filter((o) => o.type === "PO" && o.state === "overdue")).toHaveLength(2);
  });

  it("leaves work in every queue, so each role's Home has something to do", async () => {
    const [{ pendingScrap }, { pdiQueue }, { rejectedLots }] = await Promise.all([
      import("../src/server/services/scrap"), import("../src/server/services/pdi"), import("../src/server/services/rtv"),
    ]);
    expect((await pendingScrap(db)).length).toBe(4);
    const pdi = await pdiQueue(db);
    expect([pdi.filter((l) => l.status === "PENDING").length, pdi.filter((l) => l.status === "HOLD").length]).toEqual([2, 1]);
    expect((await rejectedLots(db)).length).toBe(1);
    expect(await db.lot.count({ where: { qcStatus: "PENDING_QC" } })).toBe(2);
    expect(await db.firstOff.count({ where: { status: "PENDING" } })).toBe(1);
    expect(await db.materialRequest.count({ where: { status: { in: ["OPEN", "PARTIAL"] } } })).toBe(4);
    expect(await db.dispatch.count({ where: { status: "LOADING" } })).toBe(1);
    const counts = await db.stockCount.groupBy({ by: ["status"], _count: true });
    expect(Object.fromEntries(counts.map((c) => [c.status, c._count]))).toEqual({ OPEN: 1, SUBMITTED: 2, APPROVED: 1 }); // one SUBMITTED comes from the QC count
    expect(await db.returnToVendor.count()).toBe(1);
  });

  it("plans the month: things to buy, things to make, and demand spread over time", async () => {
    const { planMrp } = await import("../src/server/services/mrp");
    const plan = await planMrp({ horizonDays: 30, scrapPct: 2 }, db);
    expect(plan.rows.filter((r) => r.buyable && r.supplier).length).toBeGreaterThanOrEqual(3);
    expect(plan.rows.filter((r) => r.role === "FG" && r.suggested > 0).length).toBeGreaterThanOrEqual(4);
    const spread = Object.fromEntries(plan.demandSpread.map((b) => [b.key, b.lines]));
    expect(spread.overdue).toBe(4);
    expect(spread.week + spread.month).toBeGreaterThanOrEqual(10);
    const dt = plan.rows.find((r) => r.code === "FG-DT220")!;
    expect(dt.needBy[7]).toBeLessThan(dt.needBy[30]); // wider horizons add demand
  });

  it("keeps the ledger balanced against the balances", async () => {
    const rows = await db.$queryRawUnsafe<{ lotId: string; ledger: number; bal: number }[]>(`
      SELECT l.id AS "lotId",
             COALESCE((SELECT SUM(qty) FROM "StockTransaction" t WHERE t."lotId" = l.id), 0)::float AS ledger,
             COALESCE((SELECT SUM(qty) FROM "StockBalance" b WHERE b."lotId" = l.id), 0)::float AS bal
      FROM "Lot" l`);
    expect(rows.filter((r) => Math.abs(r.ledger - r.bal) > 0.001)).toEqual([]);
  });
});
