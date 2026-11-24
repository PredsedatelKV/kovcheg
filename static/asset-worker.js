const release = new URL(self.location.href).searchParams.get("release");
const prefix = "kovcheg-static-assets:";
const cacheName = prefix + release;
const staticFile = /\.(?:js|css|json|svg|webp|png|jpe?g|gif|avif|bin|gz|m4a|mp3|wav|ogg|woff2?)$/i;
const pending = new Map();

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName)
    .map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      !url.pathname.startsWith("/static/") || !staticFile.test(url.pathname)) return;
  if (request.headers.has("Range")) {
    event.respondWith(partial(request));
    return;
  }
  event.respondWith(persistent(request));
});

async function persistent(request) {
  try {
    const cache = await caches.open(cacheName);
    const existing = await cache.match(request);
    if (existing) return existing;
    const url = new URL(request.url);
    if (!pending.has(url.href)) {
      const immutable = url.pathname.startsWith("/static/releases/" + release + "/");
      const task = fetch(request, { cache: immutable ? "force-cache" : "reload" }).then(async (response) => {
        if (response.ok && response.type === "basic") await cache.put(request, response.clone()).catch(() => {});
        return response;
      });
      pending.set(url.href, task);
      task.finally(() => pending.delete(url.href)).catch(() => {});
    }
    return (await pending.get(url.href)).clone();
  } catch (_) {
    return fetch(request);
  }
}

async function partial(request) {
  const match = request.headers.get("Range").match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return fetch(request);
  try {
    const cache = await caches.open(cacheName);
    const saved = await cache.match(request.url);
    if (!saved) return fetch(request);
    const bytes = await saved.arrayBuffer();
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
      "Content-Type": saved.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    } });
  } catch (_) {
    return fetch(request);
  }
}
