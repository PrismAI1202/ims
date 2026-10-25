import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { Badge, DataTable, Eyebrow, Mono, PageHeader, SegmentedTabs } from "@/components/ui";

export const instant = false;

function Table({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className="space-y-2">
      <Eyebrow>{title.toUpperCase()} · {rows.length}</Eyebrow>
      <DataTable>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{j === 0 ? <Mono className="font-semibold">{c}</Mono> : c}</td>)}</tr>
          ))}
        </tbody>
      </DataTable>
    </section>
  );
}

const TABS = [
  ["items", "Items"], ["suppliers", "Suppliers"], ["customers", "Customers"], ["bins", "Bins"], ["machines", "Machines"],
] as const;

export default async function MastersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("masters.manage");
  const { tab } = await searchParams;
  const active = TABS.find((t) => t[0] === tab)?.[0] ?? "items";
  const [items, suppliers, customers, locations, machines] = await Promise.all([
    db.item.findMany({ orderBy: { code: "asc" } }),
    db.supplier.findMany({ orderBy: { code: "asc" } }),
    db.customer.findMany({ orderBy: { code: "asc" } }),
    db.location.findMany({ orderBy: { code: "asc" } }),
    db.machine.findMany({ orderBy: { code: "asc" }, include: { moulds: true } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="ADMIN" title="Masters" subtitle="Read-only view of parts, suppliers, customers, bins, machines and moulds">
        <SegmentedTabs tabs={TABS.map(([k, label]) => ({ href: `/masters?tab=${k}`, label, active: k === active }))} />
      </PageHeader>
      <div className="flex"><Badge tone="info">Editing masters is not available yet</Badge></div>
      {active === "items" && <Table title="Items" head={["Code", "Name", "Category", "UOM", "Min", "ROP", "Max", "COA"]}
        rows={items.map((i) => [i.code, i.name, i.category, i.uom, Number(i.minStock), Number(i.reorderPoint), Number(i.maxStock), i.requiresCoa ? "Yes" : "—"])} />}
      {active === "suppliers" && <Table title="Suppliers" head={["Code", "Name", "Lead time (days)"]}
        rows={suppliers.map((s) => [s.code, s.name, s.leadTimeDays])} />}
      {active === "customers" && <Table title="Customers" head={["Code", "Name", "Segment", "Label format"]}
        rows={customers.map((c) => [c.code, c.name, c.segment, c.labelFormat])} />}
      {active === "bins" && <Table title="Bin locations" head={["Code", "Rack", "Shelf", "Bin", "Type"]}
        rows={locations.map((l) => [l.code, l.rack, l.shelf, l.bin, l.type])} />}
      {active === "machines" && <Table title="Machines & moulds" head={["Machine", "Name", "Tonnage", "Moulds"]}
        rows={machines.map((m) => [m.code, m.name, m.tonnage ?? "—", m.moulds.map((x) => `${x.code} (${x.cavities}-cav)`).join(", ") || "—"])} />}
    </div>
  );
}
