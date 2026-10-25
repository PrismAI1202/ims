import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission, runAction } from "@/server/auth/guard";
import { recordQc } from "@/server/services/inventory";
import { btnDangerCls, btnOkCls, btnWarnCls, Flash, inputCls } from "@/components/flash";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { CoaRef } from "@/components/coa-ref";
import { Badge, Card, DataTable, Eyebrow, Mono, PageHeader } from "@/components/ui";

export const instant = false;

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("qc.inspect");
  const decision = String(formData.get("decision")) as "APPROVED" | "REJECTED" | "DEVIATED";
  await runAction("/qc", `Lot ${decision.toLowerCase()}.`, async () => {
    await recordQc({
      lotId: String(formData.get("lotId")),
      decision,
      mfi: num(formData.get("mfi")), moisturePct: num(formData.get("moisture")),
      density: num(formData.get("density")), tensile: num(formData.get("tensile")),
      remarks: String(formData.get("remarks") || "") || undefined,
      putawayLocationCode: String(formData.get("bin") || "") || undefined,
      userId: user.id,
    });
  });
}

export default async function QcPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string }> }) {
  await requirePermission("qc.inspect");
  const { error, ok, q: rawQ } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const [pending, bins, recent] = await Promise.all([
    db.lot.findMany({
      where: { qcStatus: "PENDING_QC" }, orderBy: { receivedAt: "asc" },
      include: { item: true, grnLine: { include: { grn: { include: { po: true } } } } },
    }),
    db.location.findMany({ where: { type: "STORAGE" }, orderBy: { code: "asc" } }),
    db.lot.findMany({
      where: { qcStatus: { not: "PENDING_QC" } }, orderBy: { receivedAt: "desc" }, take: 100, include: { item: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="INWARD" title="Inward QC" subtitle={`${pending.length} lot${pending.length === 1 ? "" : "s"} waiting`} />
      <Flash error={error} ok={ok} />
      {pending.length === 0 && (
        <Card><p className="text-ink-3">Nothing here right now. No lots waiting for QC.</p></Card>
      )}
      {pending.map((l) => (
        <form key={l.id} action={decide}>
          <Card className="space-y-3">
            <input type="hidden" name="lotId" value={l.id} />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-display text-base font-bold">Lot <Mono>{l.lotNumber}</Mono></div>
                <div className="text-[13px] text-ink-2">{l.item.code} {l.item.name}</div>
              </div>
              <div className="text-right text-xs text-ink-2">
                <div><Mono>{Number(l.receivedQty)}</Mono> {l.item.uom} · heat/lot <Mono>{l.supplierLotNo}</Mono></div>
                <div>COA: <CoaRef value={l.grnLine?.grn.coaUrl} /></div>
                <Badge tone={l.grnLine?.grn.po.segment === "AUTOMOTIVE" ? "info" : "neutral"}>
                  {l.grnLine?.grn.po.segment === "AUTOMOTIVE" ? "Automotive" : "Non-auto"}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className="text-[13px]">MFI (g/10min)<input name="mfi" type="number" step="any" className={inputCls} /></label>
              <label className="text-[13px]">Moisture %<input name="moisture" type="number" step="any" className={inputCls} /></label>
              <label className="text-[13px]">Density (g/cm³)<input name="density" type="number" step="any" className={inputCls} /></label>
              <label className="text-[13px]">Tensile (MPa)<input name="tensile" type="number" step="any" className={inputCls} /></label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[13px]">Remarks (required for deviation)<input name="remarks" className={inputCls} /></label>
              <label className="text-[13px]">Put-away bin (on approval)
                <select name="bin" className={inputCls}>
                  <option value="">Leave in staging</option>
                  {bins.map((b) => <option key={b.id} value={b.code}>{b.code}</option>)}
                </select>
              </label>
            </div>
            <Eyebrow>DECISION</Eyebrow>
            <div className="grid gap-2 md:grid-cols-3">
              <button name="decision" value="APPROVED" className={btnOkCls}>Approve</button>
              <button name="decision" value="DEVIATED" className={btnWarnCls}>Accept with deviation</button>
              <button name="decision" value="REJECTED" className={btnDangerCls}>Reject</button>
            </div>
          </Card>
        </form>
      ))}

      <Eyebrow>RECENTLY DECIDED</Eyebrow>
      <SearchBar q={q} placeholder="Search lot or item" clearHref="/qc" />
      <DataTable>
        <thead><tr><th>Lot</th><th>Item</th><th>Status</th><th>Tag</th></tr></thead>
        <tbody>
          {recent.filter((l) => matches(q, l.lotNumber, l.item.code, l.item.name, l.qcStatus)).map((l) => (
            <tr key={l.id}>
              <td className="font-semibold"><Mono>{l.lotNumber}</Mono></td><td>{l.item.code}</td>
              <td><Badge tone={l.qcStatus === "APPROVED" ? "ok" : l.qcStatus === "REJECTED" ? "danger" : "warn"}>{l.qcStatus}</Badge></td>
              <td>{l.qcStatus !== "REJECTED" && <Link className="font-semibold text-accent underline" href={`/qc/tag/${l.id}`} target="_blank">Print QR tag</Link>}</td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td className="text-ink-3" colSpan={4}>Nothing yet.</td></tr>}
        </tbody>
      </DataTable>
    </div>
  );
}
