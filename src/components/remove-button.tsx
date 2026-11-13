"use client";

import { Minus } from "lucide-react";
import { ReasonButton } from "@/components/notice";

/** The red circled minus at a corner. Greyed out while the thing can't be removed; pressing it then pops up the reason. */
export function RemoveButton({ label, busy, why }: { label: string; busy: boolean; why: string }) {
  return (
    <ReasonButton aria-label={label} why={busy && why}
      className="absolute -right-1.5 -top-1.5 z-10 flex size-5 cursor-pointer items-center justify-center rounded-full bg-danger text-white shadow-sm ring-2 ring-white hover:bg-[#8f1a10] aria-disabled:bg-border aria-disabled:text-ink-3">
      <Minus size={12} strokeWidth={3.5} aria-hidden />
    </ReasonButton>
  );
}
