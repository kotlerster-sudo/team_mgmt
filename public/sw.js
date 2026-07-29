// v4 (2026-07-29): stopped caching navigation responses. Previously we cached
// signed-in HTML on the way through, which meant the PWA could serve a stale
// app shell after permission/nav changes (e.g. a new super-admin nav item
// wouldn't appear until the SW cache expired). Navigations are now network-
// only, with the precached shell as the offline fallback. Same behaviour as
// Safari — no more "PWA sees an older nav than the browser tab" divergence.
const CACHE = "pitstop-v4";
const PRECACHE = ["/", "/home", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.endsWith("/export") ||
    url.pathname.includes("/export/")
  ) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .catch(async () => {
        // Never resolve respondWith to undefined — caches.match() returns
        // undefined on a miss, which throws "Failed to convert value to
        // 'Response'". Fall back to the cache, then the app shell for
        // navigations, then a real network-error Response.
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          return (
            (await caches.match("/home")) ??
            (await caches.match("/")) ??
            Response.error()
          );
        }
        return Response.error();
      })
  );
});

// Push: always call showNotification immediately — do not gate it on matchAll.
// On iOS, gating on matchAll can cause the promise to resolve before
// showNotification is called, silently dropping the background notification.
// iOS naturally suppresses the system banner when the app is in the foreground,
// so we get clean behaviour on both platforms without special-casing.
// In parallel, post an in-app message if a window is focused so the app can
// show its own banner (covers the iOS foreground suppression case).
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "Pitstop", body: "", link: "/" };
  try { payload = { ...payload, ...event.data.json() }; } catch {}

  // event.waitUntil gets ONLY showNotification — nothing else.
  // Including matchAll() in waitUntil caused iOS to drop background
  // notifications: if matchAll hangs (no active clients), the entire
  // waitUntil promise hangs, iOS times out the push event, notification lost.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link: payload.link },
    })
  );

  // Fire-and-forget: post to a focused window for the in-app banner.
  // Not in waitUntil — iOS may kill the SW before this resolves when
  // backgrounded, but showNotification above is already queued.
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      const focused = clients.find((c) => c.focused);
      if (focused) focused.postMessage({ type: "push-notification", payload });
    })
    .catch(() => {});
});

// iOS APNs can silently rotate push endpoints. When that happens, resubscribe
// automatically so background delivery keeps working without requiring an app open.
// We fetch the VAPID key from the server because oldSubscription.options
// .applicationServerKey is unreliable on iOS.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    fetch("/api/push")
      .then((r) => r.json())
      .then(({ publicKey }) => {
        if (!publicKey) return;
        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
      })
      .then((sub) => {
        if (!sub) return;
        const json = sub.toJSON();
        return fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
      })
      .catch(() => {})
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.navigate(link).then((c) => (c ?? client).focus());
          }
        }
        return clients.openWindow(link);
      })
  );
});
