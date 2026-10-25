import Link from "next/link";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/guard";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { Badge, DataTable, Eyebrow, PageHeader, SegmentedTabs } from "@/components/ui";
import {
  addCustomer, addItem, addLocation, addMachine, addMould, addSupplier, saveSupplier, toggleActive,
} from "./actions";
import { ItemFields } from "./item-fields";

export const instant = false;

const TABS = [
  ["items", "Items"], ["suppliers", "Suppliers"], ["customers", "Customers"], ["bins", "Bin locations"], ["machines", "Machines & moulds"],
] as const;
type Tab = (typeof TABS)[number][0];

const th = "";
const td = "";

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <DataTable>
      <thead><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </DataTable>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-[14px] bg-white p-4">
      <summary className="min-h-9 cursor-pointer text-sm font-semibold text-accent">{title}</summary>
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
      <button className="min-h-9 cursor-pointer text-xs font-semibold text-ink-2">{active ? "Deactivate" : "Activate"}</button>
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
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="Admin · Masters" subtitle="Parts, suppliers, customers, bins, machines and moulds">
        <SegmentedTabs tabs={TABS.map(([k, label]) => ({ href: `/masters?tab=${k}`, label: label === "Machines & moulds" ? "Machines" : label === "Bin locations" ? "Bins" : label, active: k === tab }))} />
      </PageHeader>
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
          <tr key={i.id} className={i.active ? "" : "text-ink-3"}>
            <td className={`${td} font-medium`}>{i.code}</td><td className={td}>{i.name}</td><td className={td}>{i.category}</td>
            <td className={td}>{i.uom}</td><td className={td}>{Number(i.minStock)}</td><td className={td}>{Number(i.reorderPoint)}</td>
            <td className={td}>{Number(i.maxStock)}</td><td className={td}>{i.requiresCoa ? "Yes" : "—"}</td>
            <td className={td}><Badge tone={i.active ? "ok" : "neutral"}>{i.active ? "Active" : "Inactive"}</Badge></td>
            <td className={`${td} flex items-center gap-3`}>
              <Link href={`/masters/items/${i.id}`} className="flex min-h-9 items-center text-xs font-semibold text-accent">Edit</Link>
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
          <label className="text-[13px]">Code<input name="code" required className={inputCls} /></label>
          <label className="text-[13px] md:col-span-2">Name<input name="name" required className={inputCls} /></label>
          <label className="text-[13px]">Lead time (days)<input name="leadTimeDays" type="number" min="0" defaultValue={7} className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Create supplier</button></div>
        </form>
      </Panel>
      <Table head={["Code", "Name", "Lead time (days)", "Status", ""]}>
        {suppliers.map((s) => (
          <tr key={s.id} className={s.active ? "" : "text-ink-3"}>
            <td className={`${td} font-medium`}>{s.code}</td>
            <td colSpan={2} className={td}>
              <form action={saveSupplier} className="flex gap-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="code" value={s.code} />
                <input name="name" defaultValue={s.name} className="min-h-10 w-56 rounded-lg border border-border px-2" />
                <input name="leadTimeDays" type="number" min="0" defaultValue={s.leadTimeDays} className="min-h-10 w-20 rounded-lg border border-border px-2" />
                <button className="min-h-10 cursor-pointer text-xs font-semibold text-accent">Save</button>
              </form>
            </td>
            <td className={td}><Badge tone={s.active ? "ok" : "neutral"}>{s.active ? "Active" : "Inactive"}</Badge></td>
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
          <label className="text-[13px]">Code<input name="code" required className={inputCls} /></label>
          <label className="text-[13px]">Name<input name="name" required className={inputCls} /></label>
          <label className="text-[13px]">Segment
            <select name="segment" className={inputCls}><option value="AUTOMOTIVE">Automotive</option><option value="NON_AUTOMOTIVE">Non-automotive</option></select>
          </label>
          <label className="text-[13px]">Label format
            <select name="labelFormat" className={inputCls}><option value="OEM">OEM</option><option value="GENERIC">Generic</option></select>
          </label>
          <label className="text-[13px]">GSTIN<input name="gstin" placeholder="for e-way bill" className={inputCls} /></label>
          <label className="text-[13px] md:col-span-3">Address<input name="address" className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Create customer</button></div>
        </form>
      </Panel>
      <Table head={["Code", "Name", "Segment", "Label format", "GSTIN", "Status", ""]}>
        {customers.map((c) => (
          <tr key={c.id} className={c.active ? "" : "text-ink-3"}>
            <td className={`${td} font-medium`}>{c.code}</td><td className={td}>{c.name}</td><td className={td}>{c.segment}</td>
            <td className={td}>{c.labelFormat}</td><td className={td}>{c.gstin ?? "—"}</td><td className={td}><Badge tone={c.active ? "ok" : "neutral"}>{c.active ? "Active" : "Inactive"}</Badge></td>
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
          <label className="text-[13px]">Warehouse
            <select name="warehouseId" className={inputCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </label>
          <label className="text-[13px]">Rack<input name="rack" required className={inputCls} /></label>
          <label className="text-[13px]">Shelf<input name="shelf" required className={inputCls} /></label>
          <label className="text-[13px]">Bin<input name="bin" required className={inputCls} /></label>
          <label className="text-[13px]">Type
            <select name="type" className={inputCls}><option value="STORAGE">Storage</option><option value="STAGING">Staging</option></select>
          </label>
          <p className="text-xs text-ink-3 md:col-span-5">The scannable code is built as RACK-SHELF-BIN.</p>
          <div className="md:col-span-5"><button className={btnCls}>Create bin</button></div>
        </form>
      </Panel>
      <p className="text-sm"><Link className="font-semibold text-accent" href="/masters/bin-labels">Print bin labels (Code 128 barcodes)</Link></p>
      <Table head={["Code", "Rack", "Shelf", "Bin", "Type"]}>
        {locations.map((l) => (
          <tr key={l.id}>
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
          <label className="text-[13px]">Code<input name="code" required className={inputCls} /></label>
          <label className="text-[13px] md:col-span-2">Name<input name="name" required className={inputCls} /></label>
          <label className="text-[13px]">Tonnage<input name="tonnage" type="number" min="1" className={inputCls} /></label>
          <div className="md:col-span-4"><button className={btnCls}>Create machine</button></div>
        </form>
      </Panel>
      <Panel title="+ New mould">
        <form action={addMould} className="grid gap-3 md:grid-cols-4">
          <label className="text-[13px]">Code<input name="code" required className={inputCls} /></label>
          <label className="text-[13px] md:col-span-2">Name<input name="name" required className={inputCls} /></label>
          <label className="text-[13px]">Cavities<input name="cavities" type="number" min="1" defaultValue={1} className={inputCls} /></label>
          <label className="text-[13px]">Shot weight (g)<input name="shotWeightG" type="number" step="any" min="0" className={inputCls} /></label>
          <label className="text-[13px]">Runner weight (g)<input name="runnerWeightG" type="number" step="any" min="0" className={inputCls} /></label>
          <label className="text-[13px]">Machine
            <select name="machineId" className={inputCls}><option value="">—</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</select>
          </label>
          <div className="md:col-span-4"><button className={btnCls}>Create mould</button></div>
        </form>
      </Panel>
      <Eyebrow>MACHINES</Eyebrow>
      <Table head={["Code", "Name", "Tonnage", "Moulds"]}>
        {machines.map((m) => (
          <tr key={m.id}>
            <td className={`${td} font-medium`}>{m.code}</td><td className={td}>{m.name}</td><td className={td}>{m.tonnage ?? "—"}</td>
            <td className={td}>{m.moulds.map((x) => x.code).join(", ") || "—"}</td>
          </tr>
        ))}
      </Table>
      <Eyebrow>MOULDS</Eyebrow>
      <Table head={["Code", "Name", "Cavities", "Shot (g)", "Runner (g)", "Machine"]}>
        {moulds.map((m) => (
          <tr key={m.id}>
            <td className={`${td} font-medium`}>{m.code}</td><td className={td}>{m.name}</td><td className={td}>{m.cavities}</td>
            <td className={td}>{m.shotWeightG ? Number(m.shotWeightG) : "—"}</td><td className={td}>{m.runnerWeightG ? Number(m.runnerWeightG) : "—"}</td>
            <td className={td}>{m.machine?.code ?? "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
