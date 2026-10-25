import { openDB, type DBSchema } from "idb";

export type QueuedOp =
  | { type: "TRANSFER"; clientUuid: string; lotNumber: string; fromCode: string; toCode: string; qty: number }
  | { type: "ISSUE"; clientUuid: string; requestLineId: string; lotNumber: string; locationCode: string; qty: number; fifoOverrideReason?: string }
  | { type: "DISPATCH_SCAN"; clientUuid: string; dispatchId: string; dcNumber: string; scan: string };

export type QueueEntry = { op: QueuedOp; queuedAt: number; error?: string };

interface Schema extends DBSchema {
  queue: { key: string; value: QueueEntry };
  cache: { key: string; value: { key: string; data: unknown; savedAt: number } };
}

const dbPromise = () =>
  openDB<Schema>("ims-scan", 1, {
    upgrade(db) {
      db.createObjectStore("queue", { keyPath: "op.clientUuid" });
      db.createObjectStore("cache", { keyPath: "key" });
    },
  });

export const newUuid = () => crypto.randomUUID();

export async function enqueue(op: QueuedOp) {
  await (await dbPromise()).put("queue", { op, queuedAt: Date.now() });
}

export async function listQueue(): Promise<QueueEntry[]> {
  return (await (await dbPromise()).getAll("queue")).sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function discard(clientUuid: string) {
  await (await dbPromise()).delete("queue", clientUuid);
}

export async function cachePut(key: string, data: unknown) {
  await (await dbPromise()).put("cache", { key, data, savedAt: Date.now() });
}

export async function cacheGet<T>(key: string): Promise<{ data: T; savedAt: number } | undefined> {
  const row = await (await dbPromise()).get("cache", key);
  return row ? { data: row.data as T, savedAt: row.savedAt } : undefined;
}

// Sends every queued op. Applied/replayed ops leave the queue; rejected ones stay, flagged with the
// server's reason so the operator can see and discard them; a network failure leaves everything queued.
export async function flushQueue(): Promise<{ sent: number; failed: number; offline: boolean }> {
  const entries = (await listQueue()).filter((e) => !e.error);
  if (entries.length === 0) return { sent: 0, failed: 0, offline: false };
  let res: Response;
  try {
    res = await fetch("/api/v1/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: entries.map((e) => e.op) }),
    });
  } catch {
    return { sent: 0, failed: 0, offline: true };
  }
  if (!res.ok) return { sent: 0, failed: 0, offline: res.status >= 500 };

  const { results } = (await res.json()) as { results: { clientUuid: string; status: string; message?: string }[] };
  const db = await dbPromise();
  let sent = 0, failed = 0;
  for (const r of results) {
    if (r.status === "ok" || r.status === "replayed") {
      await db.delete("queue", r.clientUuid);
      sent++;
    } else if (r.message && !r.message.startsWith("Server error")) {
      const entry = await db.get("queue", r.clientUuid);
      if (entry) await db.put("queue", { ...entry, error: r.message });
      failed++;
    }
  }
  return { sent, failed, offline: false };
}
