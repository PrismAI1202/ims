"use client";

import { inputCls } from "@/components/flash";

/** "Ask the supplier to expedite", with a note field once it is ticked. Used by every place a PO is raised. */
export function ExpediteBox({ asked, early, leadTimeDays, onChange }: { asked: boolean; early: boolean; leadTimeDays: number; onChange: (v: boolean) => void }) {
  return (
    <>
      <label className={`flex items-start gap-2.5 rounded-xl border p-3 text-[13px] ${asked ? "border-warn-ink bg-warn-bg" : "border-border"}`}>
        <input name="expedite" type="checkbox" value="1" checked={asked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 flex-none accent-[#c2410c]" />
        <span>
          <span className="font-semibold">Ask the supplier to expedite</span>
          <span className="block text-xs text-ink-2">
            {early ? `The date is inside the ${leadTimeDays}-day lead time, so the PO is flagged for a faster delivery.` : "Flag the PO so the supplier knows it is urgent."}
          </span>
        </span>
      </label>
      {asked && (
        <label className="block text-[13px]">Note for the supplier <span className="text-ink-3">(optional)</span>
          <input name="expediteNote" maxLength={200} placeholder="e.g. line stops on the 30th without it" className={inputCls} />
        </label>
      )}
    </>
  );
}
