import { getApiUser } from "@/server/auth/api-auth";
import { can } from "@/server/auth/permissions";
import { toCsv, toXlsx } from "@/server/services/export-format";
import { buildReport, isReport, REPORTS } from "@/server/services/report-export";

const date = (s: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const num = (s: string | null, min: number, max: number) => {
  if (s === null || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
};

// GET /api/v1/export/:report?format=xlsx|csv — report downloads. Each report needs the same permission as its screen.
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { report } = await params;
  if (!isReport(report)) return Response.json({ error: "Unknown report" }, { status: 404 });
  if (!can(user.role, REPORTS[report])) return Response.json({ error: "Forbidden" }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const table = await buildReport(report, {
    from: date(q.get("from")), to: date(q.get("to")), horizonDays: num(q.get("horizon"), 7, 365), scrapPct: num(q.get("scrap"), 0, 50),
  });
  const stamp = new Date().toISOString().slice(0, 10);

  if (q.get("format") === "csv") {
    return new Response(toCsv(table), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report}-${stamp}.csv"` },
    });
  }
  return new Response(new Uint8Array(await toXlsx(table)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report}-${stamp}.xlsx"`,
    },
  });
}
