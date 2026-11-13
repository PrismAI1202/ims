import { Form } from "@/components/form";
import { pdiQueue } from "@/server/services/pdi";
import { ago } from "@/server/services/home";
import { btnCls, btnWarnCls } from "@/components/flash";
import { Badge, Card, Mono, ScrollArea } from "@/components/ui";
import { decideFinal } from "../actions";

export async function PdiTab() {
  const lots = await pdiQueue();
  const now = new Date();
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        Finished-goods lots can be packed and labelled straight away, but dispatch can only load boxes from a lot you have released. Put a lot on hold if the sample fails.
      </p>
      {lots.length === 0 && <Card><p className="text-sm text-ink-3">No lots are waiting for final inspection.</p></Card>}
      <ScrollArea label="Lots waiting for final inspection">
      <div className="grid gap-2.5 md:grid-cols-2">
        {lots.map((l) => (
          <article key={l.lotNumber} className="space-y-2.5 rounded-[14px] bg-white p-3.5">
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col">
                <Mono className="text-[15px] font-semibold">{l.lotNumber}</Mono>
                <span className="text-[13px] text-ink-2">{l.item} · {l.itemName}</span>
              </span>
              <Badge tone={l.status === "HOLD" ? "danger" : "warn"}>{l.status === "HOLD" ? "On hold" : "Waiting"}</Badge>
            </div>
            <div className="text-xs text-ink-3">
              {l.qty.toLocaleString()} parts · {l.boxes} boxed · booking {l.booking} · {ago(l.since, now)}
              {l.note && <span className="block text-ink-2">Hold reason: {l.note}</span>}
            </div>
            <Form action={decideFinal} className="space-y-2">
              <input type="hidden" name="lot" value={l.lotNumber} />
              <label className="block text-[13px]">Remarks <span className="text-ink-3">(needed to hold)</span>
                <input name="remarks" className="mt-1 w-full min-h-12 rounded-xl border border-border bg-white px-3.5 text-base" />
              </label>
              <div className="flex gap-2">
                <button name="decision" value="release" className={btnCls}>Release</button>
                {l.status !== "HOLD" && <button name="decision" value="hold" className={btnWarnCls}>Hold</button>}
              </div>
            </Form>
          </article>
        ))}
      </div>
      </ScrollArea>
    </div>
  );
}
