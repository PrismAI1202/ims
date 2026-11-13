import { Form } from "@/components/form";
import Link from "next/link";
import { db } from "@/server/db";
import { requireView } from "@/server/auth/guard";
import { btnCls, Flash, inputCls } from "@/components/flash";
import { NewPanel } from "@/components/new-panel";
import { SearchBar } from "@/components/search-bar";
import { matches } from "@/lib/url";
import { Badge, DataTable, PageHeader } from "@/components/ui";
import {
  addItem, toggleActive,
} from "./actions";
import { ItemFields } from "./item-fields";

export const instant = false;


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
    <NewPanel label={title.replace(/^\+\s*/, "")}>
      <div className="rounded-[14px] bg-white p-4">{children}</div>
    </NewPanel>
  );
}

function ActiveToggle({ kind, id, active }: { kind: string; id: string; active: boolean }) {
  return (
    <Form action={toggleActive}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button className="min-h-9 cursor-pointer text-xs font-semibold text-ink-2">{active ? "Deactivate" : "Activate"}</button>
    </Form>
  );
}

export default async function MastersPage({
  searchParams,
}: { searchParams: Promise<{ tab?: string; error?: string; ok?: string; q?: string }> }) {
  await requireView("masters");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="SET UP" title="Admin · Masters" subtitle="Parts and materials, with their stock levels and suppliers" />
      <Flash error={sp.error} ok={sp.ok} />

      <Items q={q} />
    </div>
  );
}

async function Items({ q }: { q?: string }) {
  const [items, suppliers] = await Promise.all([db.item.findMany({ orderBy: { code: "asc" } }), db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } })]);
  return (
    <>
      <Panel title="+ New item">
        <Form action={addItem} className="space-y-3">
          <ItemFields />
          <div className="grid gap-3 rounded-xl border-2 border-dashed border-border p-3 md:grid-cols-4">
            <p className="text-[13px] font-semibold md:col-span-4">Who you buy it from <span className="font-normal text-ink-3">(optional; not for finished goods or regrind). Needed for MRP to suggest a PO. More suppliers can be added on the item.</span></p>
            <label className="text-[13px] md:col-span-2">Supplier
              <select name="supplierId" className={inputCls}><option value="">— none yet —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label className="text-[13px]">Buying price (₹)<input name="buyPrice" type="number" min="0" step="any" className={inputCls} /></label>
          </div>
          <button className={btnCls}>Create item</button>
        </Form>
      </Panel>
      <SearchBar q={q} placeholder="Search code, name or category" keep={{ tab: "items" }} clearHref="/masters?tab=items" />
      <Table head={["Code", "Name", "Category", "UOM", "Min", "ROP", "Max", "COA", "Status", ""]}>
        {items.filter((i) => matches(q, i.code, i.name, i.category)).map((i) => (
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

