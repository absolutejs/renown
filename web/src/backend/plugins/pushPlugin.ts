// Serves the Web Push Service Worker at /sw.js. Mounted without a prefix because the
// SW must be served from the path whose scope it wants to control (here: site-wide
// root). The SW itself only handles 'push' events — it doesn't intercept fetches, so
// it can't break anything else. Worker source is inline as a string both to avoid an
// extra file in the static-asset pipeline and to keep the contract (what events it
// handles, what the notification looks like) close to the server code that fires them.
import { Elysia } from "elysia";

const SW = `// Renown Web Push Service Worker. Auto-generated — see web/src/backend/plugins/pushPlugin.ts.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  const title = payload.title || "Renown";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "",
    tag: payload.tag,
    data: { url: payload.url },
    icon: "/assets/ico/favicon.ico",
    badge: "/assets/ico/favicon.ico",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) { await c.focus(); try { await c.navigate(url); } catch {} return; }
    }
    await self.clients.openWindow(url);
  })());
});
`;

export const pushPlugin = () =>
  new Elysia()
    .get("/sw.js", () => new Response(SW, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-cache",   // SW updates need to be picked up promptly
        "service-worker-allowed": "/",   // scope = whole origin
      },
    }));
