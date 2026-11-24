const release = new URL(self.location.href).searchParams.get("release");
const releaseNumber = Number(release?.match(/^winter-2026-r(\d+)$/)?.[1]);
const releaseRoot = "/static/releases/" + release + "/";
const prefix = "kovcheg-static-assets:";
const cacheName = prefix + release;
const contentCache = "kovcheg-content-assets:v1";
const staticFile = /\.(?:js|css|json|svg|webp|png|jpe?g|gif|avif|bin|gz|m4a|mp3|wav|ogg|woff2?)$/i;
const pending = new Map();
let directory;
let older;

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function assetDirectory() {
  if (!(releaseNumber >= 44)) return Promise.resolve(null);
  if (!directory) {
    directory = fetch(releaseRoot + "asset-versions.json", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
    directory.then((files) => { if (!files) directory = undefined; });
  }
  return directory;
}

function olderCaches() {
  if (!older) {
    older = caches.keys().then((keys) => keys
      .filter((key) => key.startsWith(prefix + "winter-2026-r") && key !== cacheName)
      .sort((a, b) => Number(b.split("-r").pop()) - Number(a.split("-r").pop()))
      .slice(0, 2)
      .map((name) => ({ name, release: name.slice(prefix.length) })));
  }
  return older;
}

async function fingerprint(url) {
  const files = await assetDirectory();
  if (!files) return null;
  const part = url.pathname.startsWith(releaseRoot) ? url.pathname.slice(releaseRoot.length) : url.pathname;
  const hash = files[part + url.search] || files[part];
  if (!hash) return null;
  const extension = part.slice(part.lastIndexOf("."));
  return { key: self.location.origin + "/__kov_asset__/" + hash + extension, hash, part };
}

// Cache the bytes without the old response URL. Relative imports and CSS
// references must resolve against the requesting release, even on a cache hit.
function reusable(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function matchesHash(response, expected) {
  if (!response?.ok || response.status !== 200) return false;
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  return actual === expected;
}

async function findLegacy(request, asset) {
  for (const previous of await olderCaches()) {
    const url = new URL(request.url);
    if (!asset.part.startsWith("/")) {
      url.pathname = "/static/releases/" + previous.release + "/" + asset.part;
    }
    const saved = await caches.match(url.href, { cacheName: previous.name })
      || await caches.match(url.href, { cacheName: previous.name, ignoreSearch: true });
    if (await matchesHash(saved, asset.hash)) return reusable(saved);
  }
  return null;
}

function deduplicate(key, load) {
  if (!pending.has(key)) {
    const task = load();
    pending.set(key, task);
    task.finally(() => pending.delete(key)).catch(() => {});
  }
  return pending.get(key).then((response) => response?.clone());
}

async function loadResource(request, allowNetwork = true) {
  const url = new URL(request.url);
  const asset = await fingerprint(url);
  if (asset) {
    const cache = await caches.open(contentCache);
    const saved = await cache.match(asset.key);
    if (saved) return saved;

    const immutable = url.pathname.startsWith(releaseRoot);
    const requestKey = immutable ? asset.key : url.href;
    return deduplicate(requestKey + (allowNetwork ? "" : ":cached"), async () => {
      const old = await findLegacy(request, asset);
      if (old) {
        await cache.put(asset.key, old.clone()).catch(() => {});
        return old;
      }
      if (!allowNetwork) return null;
      let response = await fetch(request, { cache: "force-cache" });
      let expected = immutable || await matchesHash(response, asset.hash);
      if (!immutable && response.ok && !expected) {
        response = await fetch(request, { cache: "reload" });
        expected = await matchesHash(response, asset.hash);
      }
      if (response.status === 200 && expected) {
        await cache.put(asset.key, reusable(response.clone())).catch(() => {});
      }
      return reusable(response);
    });
  }

  // Support unlisted uploads and pages from older releases still open in a tab.
  const requestedRelease = url.pathname.match(/^\/static\/releases\/([^/]+)\//)?.[1];
  const cache = await caches.open(requestedRelease ? prefix + requestedRelease : cacheName);
  const saved = await cache.match(request);
  if (saved || !allowNetwork) return saved;
  return deduplicate(url.href, async () => {
    const response = await fetch(request, { cache: requestedRelease === release ? "force-cache" : "reload" });
    if (response.ok && response.type === "basic") await cache.put(request, response.clone()).catch(() => {});
    return response;
  });
}

async function partial(request) {
  const match = request.headers.get("Range").match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return fetch(request);
  const saved = await loadResource(new Request(request.url, { credentials: request.credentials }), false);
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
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      !url.pathname.startsWith("/static/") || !staticFile.test(url.pathname)) return;
  const load = request.headers.has("Range") ? partial(request) : loadResource(request);
  event.respondWith(load.catch(() => fetch(request)));
});
