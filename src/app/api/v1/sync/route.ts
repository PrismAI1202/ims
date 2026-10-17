import { z } from "zod";
import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { DomainError, issueStock, transferStock } from "@/server/services/inventory";

const opSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("TRANSFER"),
    clientUuid: z.string().min(8).max(100),
    lotNumber: z.string().min(1), fromCode: z.string().min(1), toCode: z.string().min(1),
    qty: z.number().positive(),
  }),
  z.object({
    type: z.literal("ISSUE"),
    clientUuid: z.string().min(8).max(100),
    requestLineId: z.string().min(1), lotNumber: z.string().min(1), locationCode: z.string().min(1),
    qty: z.number().positive(), fifoOverrideReason: z.string().optional(),
  }),
]);
const bodySchema = z.object({ ops: z.array(opSchema).max(200) });

type Result = { clientUuid: string; status: "ok" | "replayed" | "error"; message?: string };

// POST /api/v1/sync — applies queued scan operations. Every op is idempotent on clientUuid,
// so a client that lost the response can safely resend the whole queue.
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const results: Result[] = [];
  for (const op of parsed.data.ops) {
    try {
      if (op.type === "TRANSFER") {
        if (!can(user.role, "stock.transfer")) throw new DomainError("Not allowed to transfer stock.");
        const r = await transferStock({ ...op, userId: user.id });
        results.push({ clientUuid: op.clientUuid, status: r.replayed ? "replayed" : "ok" });
      } else {
        if (!can(user.role, "stock.issue")) throw new DomainError("Not allowed to issue stock.");
        const r = await issueStock({ ...op, userId: user.id });
        results.push({ clientUuid: op.clientUuid, status: r.replayed ? "replayed" : "ok" });
      }
    } catch (e) {
      if (!(e instanceof DomainError)) console.error("sync op failed", e);
      results.push({
        clientUuid: op.clientUuid, status: "error",
        message: e instanceof DomainError ? e.message : "Server error; will retry.",
      });
    }
  }
  return Response.json({ results });
}
