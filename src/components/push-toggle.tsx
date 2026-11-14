"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { btnCls, btnSecondaryCls } from "@/components/flash";

type State =
  | { kind: "loading" }
  | { kind: "unsupported"; why: string }
  | { kind: "off" | "on" | "blocked" };

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Turns task notifications on or off for this phone or browser. */
export function PushToggle() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhones only get push for an app added to the home screen, and then Safari exposes the API.
        return setState({ kind: "unsupported", why: isIos() && !isInstalled()
          ? "On iPhone, tap Share, then Add to Home Screen, open IMS from there, and come back to this page."
          : "This browser can't receive push notifications." });
      }
      if (Notification.permission === "denied") return setState({ kind: "blocked" });
      const reg = await navigator.serviceWorker.getRegistration("/");
      setState({ kind: (await reg?.pushManager.getSubscription()) ? "on" : "off" });
    })().catch(() => setState({ kind: "unsupported", why: "Couldn't check notification support." }));
  }, []);

  async function enable() {
    setBusy(true); setMsg("");
    try {
      const cfg = await (await fetch("/api/v1/push")).json();
      if (!cfg.configured) throw new Error("Notifications aren't set up on the server yet. Ask an admin to add the VAPID keys.");
      if ((await Notification.requestPermission()) !== "granted") return setState({ kind: "blocked" });
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.publicKey) }));
      const res = await fetch("/api/v1/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't save this device.");
      setState({ kind: "on" });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't turn notifications on.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/v1/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState({ kind: "off" });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't turn notifications off.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <h2 className="font-display text-base font-bold">Task notifications on this device</h2>
      <p className="text-sm text-ink-2">Get a notification when a new task reaches you, such as a lot waiting for QC or a request to issue. Tap it to open that screen.</p>
      {state.kind === "loading" && <p className="text-sm text-ink-3">Checking…</p>}
      {state.kind === "unsupported" && <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">{state.why}</p>}
      {state.kind === "blocked" && <p className="rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.</p>}
      {state.kind === "off" && <button type="button" onClick={enable} disabled={busy} className={`${btnCls} w-full gap-2`}><Bell size={18} aria-hidden /> Turn on notifications</button>}
      {state.kind === "on" && (
        <div className="space-y-2">
          <p className="rounded-xl bg-ok-bg px-3 py-2.5 text-sm text-ok-ink">Notifications are on for this device.</p>
          <button type="button" onClick={disable} disabled={busy} className={`${btnSecondaryCls} w-full gap-2`}><BellOff size={18} aria-hidden /> Turn off</button>
        </div>
      )}
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
    </div>
  );
}
