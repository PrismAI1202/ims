import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cachePut, discard, enqueue, flushQueue, listQueue, type QueuedOp } from "./offline-queue";

const transfer = (id: string): QueuedOp => ({
  type: "TRANSFER", clientUuid: id, lotNumber: "LOT-1", fromCode: "A-01-01", toCode: "A-01-02", qty: 5,
});

const reply = (results: object[], status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ results }), { status }));

beforeEach(async () => {
  for (const e of await listQueue()) await discard(e.op.clientUuid);
});
afterEach(() => vi.unstubAllGlobals());

describe("offline queue", () => {
  it("keeps everything queued when the network is down", async () => {
    await enqueue(transfer("uuid-0001"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await flushQueue()).toEqual({ sent: 0, failed: 0, offline: true });
    expect(await listQueue()).toHaveLength(1);
  });

  it("removes applied and replayed ops", async () => {
    await enqueue(transfer("uuid-0001"));
    await enqueue(transfer("uuid-0002"));
    vi.stubGlobal("fetch", reply([
      { clientUuid: "uuid-0001", status: "ok" },
      { clientUuid: "uuid-0002", status: "replayed" },
    ]));
    expect(await flushQueue()).toEqual({ sent: 2, failed: 0, offline: false });
    expect(await listQueue()).toHaveLength(0);
  });

  it("keeps a rejected op, flags it with the reason, and does not resend it", async () => {
    await enqueue(transfer("uuid-0001"));
    vi.stubGlobal("fetch", reply([{ clientUuid: "uuid-0001", status: "error", message: "Unknown lot LOT-1." }]));
    expect(await flushQueue()).toEqual({ sent: 0, failed: 1, offline: false });
    const [entry] = await listQueue();
    expect(entry.error).toBe("Unknown lot LOT-1.");

    const again = vi.fn();
    vi.stubGlobal("fetch", again);
    expect(await flushQueue()).toEqual({ sent: 0, failed: 0, offline: false });
    expect(again).not.toHaveBeenCalled();
  });

  it("leaves an op queued after a transient server error so it retries", async () => {
    await enqueue(transfer("uuid-0001"));
    vi.stubGlobal("fetch", reply([{ clientUuid: "uuid-0001", status: "error", message: "Server error; will retry." }]));
    await flushQueue();
    const [entry] = await listQueue();
    expect(entry.error).toBeUndefined();
  });

  it("treats a 401 as not-synced without losing the queue", async () => {
    await enqueue(transfer("uuid-0001"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const r = await flushQueue();
    expect(r.sent).toBe(0);
    expect(await listQueue()).toHaveLength(1);
  });

  it("round-trips the read cache used for offline request lists", async () => {
    await cachePut("open-lines", [{ requestLineId: "x" }]);
    const hit = await cacheGet<{ requestLineId: string }[]>("open-lines");
    expect(hit?.data[0].requestLineId).toBe("x");
    expect(await cacheGet("missing")).toBeUndefined();
  });
});
