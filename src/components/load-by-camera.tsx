"use client";

import { useRouter } from "next/navigation";
import { ScanButton } from "@/components/scan-button";

// Loading a truck with the camera: the sheet stays open and each box label is posted as it is seen, with its result shown at once
// ("✓ Loaded BX-…" or the reason it was refused), so a person can go box after box without leaving the camera. It uses the same
// endpoint as the offline scanner, which is safe to repeat: a label seen twice is only counted once.
export function LoadByCamera({ dispatchId }: { dispatchId: string }) {
  const router = useRouter();
  async function onScan(scanned: string) {
    try {
      const res = await fetch("/api/v1/sync", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: [{ type: "DISPATCH_SCAN", clientUuid: crypto.randomUUID(), dispatchId, scan: scanned }] }),
      });
      if (!res.ok) return "✗ Couldn't reach the server. Try again.";
      const r = (await res.json()).results?.[0] as { status: string; message?: string } | undefined;
      router.refresh(); // the pick-list progress and the box list behind the camera
      if (!r || r.status === "error") return `✗ ${r?.message ?? "Not loaded."}`;
      return r.status === "replayed" ? "Already on this load" : "✓ Loaded";
    } catch {
      return "✗ No connection. Use the offline scanner, or try again.";
    }
  }
  return <ScanButton continuous onScan={onScan} title="Load boxes with the camera" hint="Scan each box label in turn. Each one is checked against the pick list." label="Load boxes with the camera" />;
}
