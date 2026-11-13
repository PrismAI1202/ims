import { getApiUser } from "@/server/auth/api-auth";
import { locateCode } from "@/server/services/locate";

// GET /api/v1/locate?code=… — what a scanned code is (bin, lot, FG box or item) and where its stock is. Any signed-in user may
// ask: it only names things the Stores screen already shows everyone.
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!code.trim() || code.length > 300) return Response.json({ error: "Give a code to look up." }, { status: 400 });
  return Response.json(await locateCode(code));
}
