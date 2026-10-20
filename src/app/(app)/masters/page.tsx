import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { btnCls, Flash, inputCls } from "@/components/flash";
import {
  addCustomer, addItem, addLocation, addMachine, addMould, addSupplier, saveSupplier, toggleActive,
} from "./actions";
import { ItemFields } from "./item-fields";

export const instant = false;

const TABS = [
  ["items", "Items"], ["suppliers", "Suppliers"], ["customers", "Customers"], ["bins", "Bin locations"], ["machines", "Machines & moulds"],
] as const;
type Tab = (typeof TABS)[number][0];

const th = "p-2";
const td = "p-2";

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left"><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="max-w-4xl rounded-lg border bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function ActiveToggle({ kind, id, active }: { kind: string; id: string; active: boolean }) {
  return (
    <form action={toggleActive}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button className="text-xs underline">{active ? "Deactivate" : "Activate"}</button>
    </form>
  );
}

export default async function MastersPage({
  searchParams,
}: { searchParams: Promise<{ tab?: string; error?: string; ok?: string }> }) {
  await requirePermission("masters.manage");
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "items";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Masters</h1>
      <nav className="flex flex-wrap gap-2 text-sm">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/masters?tab=${k}`}
            className={`rounded px-3 py-1.5 ${tab === k ? "bg-slate-900 text-white" : "bg-white border"}`}>{label}</Link>
        ))}
      </nav>
      <Flash error={sp.error} ok={sp.ok} />

      {tab === "items" && <Items />}
      {tab === "suppliers" && <Suppliers />}
      {tab === "customers" && <Customers />}
      {tab === "bins" && <Bins />}
      {tab === "machines" && <Machines />}
    </div>
  );
}

async function Items() {
  const items = await db.item.findMany({ orderBy: { code: "asc" } });
  return (
    <>
      <Panel title="+ New item">
        <form action={addItem} className="space-y-3"><ItemFields /><button className={btnCls}>Create item</button></form>
      </Panel>
      <Table head={["Code", "Name", "Category", "UOM", "Min", "ROP", "Max", "COA", "Status", ""]}>
        {items.map((i) => (
          <tr key={i.id} className={`border-t ${i.active ? "" : "text-slate-400"}`}>
            <td className={`${td} font-medium`}>{i.code}</td><td className={td}>{i.name}</td><td className={td}>{i.category}</td>
            <td className={td}>{i.uom}</td><td className={td}>{Number(i.minStock)}</td><td className={td}>{Number(i.reorderPoint)}</td>
            <td className={td}>{Number(i.maxStock)}</td><td className={td}>{i.requiresCoa ? "Yes" : "—"}</td>
            <td className={td}>{i.active ? "Active" : "Inactive"}</td>
            <td className={`${td} flex gap-3`}>
              <Link href={`/masters/items/${i.id}`} className="text-xs underline">Edit</Link>
              <ActiveToggle kind="item" id={i.id} active={i.active} />
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

async function Suppliers() {
  const suppliers = await db.supplier.findMany({ orderBy: { code: "asc" } });
  return (
    <>
      <Panel title="+ New supplier">
        <form action={addSupplier} className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">Code<input name="code" required className={inputCls} /></label>
          <label className="text-sm md:col-span-2">Name<input name="name" required className={inputCls} /></label>
          <label className="text-sm">Lead time (days)<input name="leadTimeDays" type="number" min="0" defaultValue={7} className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Create supplier</button></div>
        </form>
      </Panel>
      <Table head={["Code", "Name", "Lead time (days)", "Status", ""]}>
        {suppliers.map((s) => (
          <tr key={s.id} className={`border-t ${s.active ? "" : "text-slate-400"}`}>
            <td className={`${td} font-medium`}>{s.code}</td>
            <td colSpan={2} className={td}>
              <form action={saveSupplier} className="flex gap-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="code" value={s.code} />
                <input name="name" defaultValue={s.name} className="w-56 rounded border px-2 py-1" />
                <input name="leadTimeDays" type="number" min="0" defaultValue={s.leadTimeDays} className="w-20 rounded border px-2 py-1" />
                <button className="text-xs underline">Save</button>
              </form>
            </td>
            <td className={td}>{s.active ? "Active" : "Inactive"}</td>
            <td className={td}><ActiveToggle kind="supplier" id={s.id} active={s.active} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}

async function Customers() {
  const customers = await db.customer.findMany({ orderBy: { code: "asc" } });
  return (
    <>
      <Panel title="+ New customer">
        <form action={addCustomer} className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">Code<input name="code" required className={inputCls} /></label>
          <label className="text-sm">Name<input name="name" required className={inputCls} /></label>
          <label className="text-sm">Segment
            <select name="segment" className={inputCls}><option value="AUTOMOTIVE">Automotive</option><option value="NON_AUTOMOTIVE">Non-automotive</option></select>
          </label>
          <label className="text-sm">Label format
            <select name="labelFormat" className={inputCls}><option value="OEM">OEM</option><option value="GENERIC">Generic</option></select>
          </label>
          <label className="text-sm">GSTIN<input name="gstin" placeholder="for e-way bill" className={inputCls} /></label>
          <label className="text-sm md:col-span-3">Address<input name="address" className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Create customer</button></div>
        </form>
      </Panel>
      <Table head={["Code", "Name", "Segment", "Label format", "GSTIN", "Status", ""]}>
        {customers.map((c) => (
          <tr key={c.id} className={`border-t ${c.active ? "" : "text-slate-400"}`}>
            <td className={`${td} font-medium`}>{c.code}</td><td className={td}>{c.name}</td><td className={td}>{c.segment}</td>
            <td className={td}>{c.labelFormat}</td><td className={td}>{c.gstin ?? "—"}</td><td className={td}>{c.active ? "Active" : "Inactive"}</td>
            <td className={td}><ActiveToggle kind="customer" id={c.id} active={c.active} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}

async function Bins() {
  const [locations, warehouses] = await Promise.all([
    db.location.findMany({ orderBy: { code: "asc" } }), db.warehouse.findMany({ orderBy: { code: "asc" } }),
  ]);
  return (
    <>
      <Panel title="+ New bin">
        <form action={addLocation} className="grid gap-3 md:grid-cols-5">
          <label className="text-sm">Warehouse
            <select name="warehouseId" className={inputCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </label>
          <label className="text-sm">Rack<input name="rack" required className={inputCls} /></label>
          <label className="text-sm">Shelf<input name="shelf" required className={inputCls} /></label>
          <label className="text-sm">Bin<input name="bin" required className={inputCls} /></label>
          <label className="text-sm">Type
            <select name="type" className={inputCls}><option value="STORAGE">Storage</option><option value="STAGING">Staging</option></select>
          </label>
          <p className="text-xs text-slate-500 md:col-span-5">The scannable code is built as RACK-SHELF-BIN.</p>
          <div className="md:col-span-5"><button className={btnCls}>Create bin</button></div>
        </form>
      </Panel>
      <Table head={["Code", "Rack", "Shelf", "Bin", "Type"]}>
        {locations.map((l) => (
          <tr key={l.id} className="border-t">
            <td className={`${td} font-medium`}>{l.code}</td><td className={td}>{l.rack}</td><td className={td}>{l.shelf}</td>
            <td className={td}>{l.bin}</td><td className={td}>{l.type}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

async function Machines() {
  const machines = await db.machine.findMany({ orderBy: { code: "asc" }, include: { moulds: true } });
  const moulds = await db.mould.findMany({ orderBy: { code: "asc" }, include: { machine: true } });
  return (
    <>
      <Panel title="+ New machine">
        <form action={addMachine} className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">Code<input name="code" required className={inputCls} /></label>
          <label className="text-sm md:col-span-2">Name<input name="name" required className={inputCls} /></label>
          <label className="text-sm">Tonnage<input name="tonnage" type="number" min="1" className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Create machine</button></div>
        </form>
      </Panel>
      <Panel title="+ New mould">
        <form action={addMould} className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">Code<input name="code" required className={inputCls} /></label>
          <label className="text-sm md:col-span-2">Name<input name="name" required className={inputCls} /></label>
          <label className="text-sm">Cavities<input name="cavities" type="number" min="1" defaultValue={1} className={inputCls} /></label>
          <label className="text-sm">Shot weight (g)<input name="shotWeightG" type="number" step="any" min="0" className={inputCls} /></label>
          <label className="text-sm">Runner weight (g)<input name="runnerWeightG" type="number" step="any" min="0" className={inputCls} /></label>
          <label className="text-sm">Machine
            <select name="machineId" className={inputCls}><option value="">—</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select>
          </label>
          <div className="md:col-span-4"><button className={btnCls}>Create mould</button></div>
        </form>
      </Panel>
      <h2 className="text-lg font-semibold">Machines</h2>
      <Table head={["Code", "Name", "Tonnage", "Moulds"]}>
        {machines.map((m) => (
          <tr key={m.id} className="border-t">
            <td className={`${td} font-medium`}>{m.code}</td><td className={td}>{m.name}</td><td className={td}>{m.tonnage ?? "—"}</td>
            <td className={td}>{m.moulds.map((x) => x.code).join(", ") || "—"}</td>
          </tr>
        ))}
      </Table>
      <h2 className="text-lg font-semibold">Moulds</h2>
      <Table head={["Code", "Name", "Cavities", "Shot (g)", "Runner (g)", "Machine"]}>
        {moulds.map((m) => (
          <tr key={m.id} className="border-t">
            <td className={`${td} font-medium`}>{m.code}</td><td className={td}>{m.name}</td><td className={td}>{m.cavities}</td>
            <td className={td}>{m.shotWeightG ? Number(m.shotWeightG) : "—"}</td><td className={td}>{m.runnerWeightG ? Number(m.runnerWeightG) : "—"}</td>
            <td className={td}>{m.machine?.code ?? "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
