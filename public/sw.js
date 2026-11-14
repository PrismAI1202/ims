// Scanner service worker: keeps the /scan screens usable when the plant Wi-Fi drops.
// Pages are network-first (fresh when online, last visit when offline); static assets are cache-first.
// API calls are never cached here: the app keeps its own IndexedDB copy and queue.
const PAGES = "ims-scan-pages-v1";
const ASSETS = "ims-scan-assets-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname.startsWith("/scan")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || Response.error()),
    );
  }
});

// ── Push notifications ──
// A notification names the next task (title, body) and where it is done (data.url). Tapping it focuses an open IMS
// window and goes there, or opens one.
self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { /* plain-text push: fall through to the defaults */ }
  event.waitUntil(
    self.registration.showNotification(p.title || "IMS", {
      body: p.body || "You have a new task.",
      icon: "/icon.svg", badge: "/icon.svg", tag: p.tag, renotify: !!p.tag,
      data: { url: p.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (all) => {
      const open = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) { await open.focus(); if ("navigate" in open) return open.navigate(url); }
      return self.clients.openWindow(url);
    }),
  );
});
