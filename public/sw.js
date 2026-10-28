/* Airlink Visitas service worker: app-shell cache + offline fallback. Kiosk pages (/guard/*) and the wardens'
   evacuation list (/app/evacuacion) are network-first with a runtime copy so they open offline; scan queueing and
   the evacuation snapshot live in IndexedDB. */
const CACHE = "visitas-v3";
const PRECACHE = ["/offline", "/icons/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    if (url.pathname === "/guard" || url.pathname.startsWith("/guard/") || url.pathname === "/app/evacuacion") {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(url.pathname, copy));
            }
            return res;
          })
          .catch(() => caches.match(url.pathname, { ignoreVary: true }).then((hit) => hit || caches.match("/offline"))),
      );
      return;
    }
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
  const title = data.title || "Airlink Visitas";
  event.waitUntil(self.registration.showNotification(title, { body: data.body || "", data: data.url ? { url: data.url } : {}, icon: "/icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.openWindow(url));
});
