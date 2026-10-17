import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";

export const instant = false;

function Table({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title} <span className="text-sm font-normal text-slate-500">({rows.length})</span></h2>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>{head.map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="p-2">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function MastersPage() {
  await requirePermission("masters.manage");
  const [items, suppliers, customers, locations, machines] = await Promise.all([
    db.item.findMany({ orderBy: { code: "asc" } }),
    db.supplier.findMany({ orderBy: { code: "asc" } }),
    db.customer.findMany({ orderBy: { code: "asc" } }),
    db.location.findMany({ orderBy: { code: "asc" } }),
    db.machine.findMany({ orderBy: { code: "asc" }, include: { moulds: true } }),
  ]);
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Masters</h1>
      <Table title="Items" head={["Code", "Name", "Category", "UOM", "Min", "ROP", "Max", "COA"]}
        rows={items.map((i) => [i.code, i.name, i.category, i.uom, Number(i.minStock), Number(i.reorderPoint), Number(i.maxStock), i.requiresCoa ? "Yes" : "—"])} />
      <Table title="Suppliers" head={["Code", "Name", "Lead time (days)"]}
        rows={suppliers.map((s) => [s.code, s.name, s.leadTimeDays])} />
      <Table title="Customers" head={["Code", "Name", "Segment", "Label format"]}
        rows={customers.map((c) => [c.code, c.name, c.segment, c.labelFormat])} />
      <Table title="Bin locations" head={["Code", "Rack", "Shelf", "Bin", "Type"]}
        rows={locations.map((l) => [l.code, l.rack, l.shelf, l.bin, l.type])} />
      <Table title="Machines & moulds" head={["Machine", "Name", "Tonnage", "Moulds"]}
        rows={machines.map((m) => [m.code, m.name, m.tonnage ?? "—", m.moulds.map((x) => `${x.code} (${x.cavities}-cav)`).join(", ") || "—"])} />
    </div>
  );
}
