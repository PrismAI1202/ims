import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Cookie sessions are Auth.js territory (and need Next's runtime). This route is under test for its Bearer-token path,
// so the session helper is stubbed to "nobody signed in".
vi.mock("@/auth", () => ({ auth: async () => null }));

// The route uses the app's shared Prisma client, so point that at the test database before anything imports it.
const url = process.env.TEST_DATABASE_URL ?? "postgresql://ims:ims@localhost:5433/ims_test?schema=public";
process.env.DATABASE_URL = url;
const db = new PrismaClient({ datasourceUrl: url });

let POST: (req: Request) => Promise<Response>;
let tokens: Record<string, string>;
let ids: Record<string, string>;

beforeAll(async () => {
  expect(url).toContain("ims_test");
  ({ POST } = await import("./route"));
});
afterAll(() => db.$disconnect());

const tokenFor = async (userId: string, plain: string) => {
  await db.apiToken.create({ data: { userId, label: "test", tokenHash: createHash("sha256").update(plain).digest("hex") } });
  return plain;
};

beforeEach(async () => {
  for (const t of [
    "ApiToken", "User", "FgBox", "DispatchLine", "Dispatch", "StockTransaction", "StockBalance", "Lot", "Location", "Warehouse", "Customer", "Item",
  ]) await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);

  const mkUser = (email: string, role: "ADMIN" | "STORE_INCHARGE" | "DISPATCH_OFFICER" | "QA_INSPECTOR") =>
    db.user.create({ data: { email, name: email, role, passwordHash: "x" } });
  const [dispatchUser, storeUser, qaUser] = await Promise.all([mkUser("d@x", "DISPATCH_OFFICER"), mkUser("s@x", "STORE_INCHARGE"), mkUser("q@x", "QA_INSPECTOR")]);
  tokens = {
    dispatch: await tokenFor(dispatchUser.id, "tok-dispatch"), store: await tokenFor(storeUser.id, "tok-store"), qa: await tokenFor(qaUser.id, "tok-qa"),
  };

  const wh = await db.warehouse.create({ data: { code: "WH", name: "Main" } });
  const a = await db.location.create({ data: { code: "A-01-01", rack: "A", shelf: "1", bin: "1", type: "STORAGE", warehouseId: wh.id } });
  const b = await db.location.create({ data: { code: "A-01-02", rack: "A", shelf: "1", bin: "2", type: "STORAGE", warehouseId: wh.id } });
  const fg = await db.item.create({ data: { code: "FG-1", name: "FG", category: "FG", uom: "NOS" } });
  const apex = await db.customer.create({ data: { code: "APEX", name: "Apex", segment: "AUTOMOTIVE", labelFormat: "OEM" } });
  const lot = await db.lot.create({ data: { lotNumber: "LOT-1", itemId: fg.id, supplierLotNo: "S", receivedQty: 1000, qcStatus: "APPROVED" } });
  await db.stockBalance.create({ data: { lotId: lot.id, locationId: a.id, qty: 1000 } });
  const box = await db.fgBox.create({ data: { boxCode: "BX-T-0001", lotId: lot.id, customerId: apex.id, locationId: a.id, qty: 500, producedDate: new Date() } });
  const d = await db.dispatch.create({ data: { dcNumber: "DC-T-1", customerId: apex.id, vehicleNumber: "MH12", lines: { create: [{ itemId: fg.id, qty: 500 }] } } });
  ids = { a: a.id, b: b.id, dispatch: d.id, box: box.id };
});

const post = (token: string | null, ops: object[]) =>
  POST(new Request("http://localhost/api/v1/sync", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ ops }),
  }));
const scanOp = (uuid: string, scan = "BX-T-0001") => ({ type: "DISPATCH_SCAN", clientUuid: uuid, dispatchId: ids.dispatch, scan });

describe("auth and validation", () => {
  it("401 without a token or with a wrong one", async () => {
    expect((await post(null, [scanOp("uuid-0001")])).status).toBe(401);
    expect((await post("nope", [scanOp("uuid-0001")])).status).toBe(401);
  });
  it("400 for a malformed or unknown operation", async () => {
    expect((await post(tokens.dispatch, [{ type: "HACK", clientUuid: "uuid-0001" }])).status).toBe(400);
    expect((await post(tokens.dispatch, [{ type: "DISPATCH_SCAN", clientUuid: "x" }])).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/v1/sync", { method: "POST", headers: { Authorization: `Bearer ${tokens.dispatch}` }, body: "not json" }))).status).toBe(400);
  });
});

describe("offline dispatch scans", () => {
  it("loads a box onto the dispatch for a dispatch officer", async () => {
    const res = await post(tokens.dispatch, [scanOp("uuid-0001")]);
    expect((await res.json()).results).toEqual([{ clientUuid: "uuid-0001", status: "ok" }]);
    expect((await db.fgBox.findUniqueOrThrow({ where: { id: ids.box } })).dispatchId).toBe(ids.dispatch);
  });

  it("treats the same scan sent again as a replay, not an error", async () => {
    await post(tokens.dispatch, [scanOp("uuid-0001")]);
    const again = (await (await post(tokens.dispatch, [scanOp("uuid-0001")])).json()).results[0];
    expect(again.status).toBe("replayed");
  });

  it("still reports real problems with the reason", async () => {
    const r = (await (await post(tokens.dispatch, [scanOp("uuid-0001", "BX-NOPE")])).json()).results[0];
    expect(r).toMatchObject({ status: "error", message: "Unknown box BX-NOPE." });
  });

  it("refuses roles that may not load dispatches", async () => {
    for (const t of [tokens.store, tokens.qa]) {
      const r = (await (await post(t, [scanOp("uuid-0001")])).json()).results[0];
      expect(r).toMatchObject({ status: "error", message: expect.stringMatching(/Not allowed/) });
    }
    expect((await db.fgBox.findUniqueOrThrow({ where: { id: ids.box } })).dispatchId).toBeNull();
  });
});

describe("a mixed batch", () => {
  it("applies each operation on its own merits and keeps going after a failure", async () => {
    const res = await post(tokens.store, [
      { type: "TRANSFER", clientUuid: "uuid-aaaa1", lotNumber: "LOT-1", fromCode: "A-01-01", toCode: "A-01-02", qty: 100 },
      { type: "TRANSFER", clientUuid: "uuid-aaaa2", lotNumber: "NOPE", fromCode: "A-01-01", toCode: "A-01-02", qty: 1 },
      scanOp("uuid-aaaa3"), // a store incharge can't load dispatches
      { type: "TRANSFER", clientUuid: "uuid-aaaa1", lotNumber: "LOT-1", fromCode: "A-01-01", toCode: "A-01-02", qty: 100 }, // replay
    ]);
    const r = (await res.json()).results as { status: string }[];
    expect(r.map((x) => x.status)).toEqual(["ok", "error", "error", "replayed"]);
    const moved = await db.stockBalance.findFirstOrThrow({ where: { locationId: ids.b } });
    expect(Number(moved.qty)).toBe(100); // the replay did not move it twice
  });
});
