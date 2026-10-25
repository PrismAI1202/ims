import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { readUpload } from "@/server/services/storage";

// GET /api/v1/files/:name — uploaded certificates, for signed-in staff only. The name pattern in readUpload
// rejects anything that isn't a file we generated, so this can't be used to read other files on the server.
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "stock.view")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { name } = await params;
  const file = await readUpload(name);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=300",
    },
  });
}
