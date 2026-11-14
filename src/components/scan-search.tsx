"use client";

import { useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ScanButton } from "@/components/scan-button";
import { codeOf, normalizeCode } from "@/lib/scan-parse";

// The camera button that sits beside a search box. Scanning a product's label does the search for you.
//  - "text" (default): the scanned code goes into the search box and the search runs (the lot, box or part is found in the list).
//  - param="lot" (or any other parameter): goes to this page with that parameter set instead (Inward QC opens the lot's card).
//  - "locate": asks the server what the code is and takes you there: a bin label opens that bin, a lot tag or box label opens the
//    bin it is in, an item code searches Stores for it. Used on Stores, where the person usually wants to know "where is it?".

export function ScanSearch({ mode = "text", param = "q", keep = {}, title = "Scan a product", hint = "Point the camera at a lot tag, box label or bin label." }: {
  mode?: "text" | "locate"; param?: string; keep?: Record<string, string | undefined>; title?: string; hint?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  const path = usePathname();

  async function onScan(scanned: string) {
    if (mode === "locate") return locate(scanned);
    const code = codeOf(scanned);
    if (param === "q") {
      const form = anchor.current?.closest("form");
      const box = form?.querySelector<HTMLInputElement>('input[name="q"]');
      if (form && box) {
        box.value = code;
        form.requestSubmit();
        return;
      }
    }
    const qs = new URLSearchParams(Object.entries(keep).filter(([, v]) => v) as [string, string][]);
    qs.set(param, code);
    router.push(`${path}?${qs}`);
  }

  async function locate(scanned: string) {
    try {
      const res = await fetch(`/api/v1/locate?code=${encodeURIComponent(normalizeCode(scanned))}`);
      const found = res.ok ? await res.json() : { kind: "none" };
      if (found.kind === "bin") router.push(`/stock?view=bins&bin=${encodeURIComponent(found.bin)}`);
      else if (found.kind === "lot" && found.bins[0]) router.push(`/stock?view=bins&bin=${encodeURIComponent(found.bins[0])}`);
      else if (found.kind === "box") router.push(`/stock?view=bins&bin=${encodeURIComponent(found.bin)}`);
      else if (found.kind === "lot" || found.kind === "item") router.push(`/stock?q=${encodeURIComponent(found.kind === "lot" ? found.itemCode : found.itemCode)}`);
      else router.push(`/stock?q=${encodeURIComponent(codeOf(scanned))}`);
    } catch {
      router.push(`/stock?q=${encodeURIComponent(codeOf(scanned))}`);
    }
  }

  return <span ref={anchor} className="contents"><ScanButton onScan={onScan} title={title} hint={hint} label={title} className="min-h-11" /></span>;
}
