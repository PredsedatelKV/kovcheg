import { ART, MEDIA } from "./startup-manifest.js";

const trackSources = new Map();
const audioBytes = new Map();
const staticBytes = new Map();
const warmed = new Map();
const AUDIO = /\.(?:wav|mp3|ogg|m4a)$/i;
const IMAGE = /\.(?:png|svg|webp|jpe?g|gif|avif)$/i;
const RECORDINGS = new Set(["media/new-year.mp3", "media/arena/winter-breakbeat.mp3",
  "media/courier/christmas-rally.mp3", "media/casino/lounge.mp3"]);
const REQUEST_TIMEOUT = 45000;

function cached(map, key, load) {
  if (!map.has(key)) {
    const promise = load();
    map.set(key, promise);
    promise.catch(() => map.delete(key));
  }
  return map.get(key);
}

async function read(url, parse) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {cache: "force-cache", signal: controller.signal});
    if (!response.ok) throw new Error("Asset unavailable");
    return await parse(response);
  } finally {
    clearTimeout(timer);
  }
}

export async function startAssetCache() {
  if (window.kovAssetCacheReady) return window.kovAssetCacheReady;
  if (!navigator.serviceWorker || !globalThis.caches) return false;
  const release = new URL(".", import.meta.url).pathname.split("/").filter(Boolean).pop();
  const worker = new URL("/asset-worker.js", location.origin);
  worker.searchParams.set("release", release);
  const usingRelease = () => navigator.serviceWorker.controller?.scriptURL === worker.href;
  try {
    const activated = new Promise((resolve) => {
      const change = () => { if (usingRelease()) finish(true); };
      const timeout = setTimeout(() => finish(false), 1900);
      const finish = (ready) => {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("controllerchange", change);
        resolve(ready);
      };
      navigator.serviceWorker.addEventListener("controllerchange", change);
      void navigator.serviceWorker.register(worker.href, { scope: "/" })
        .then(change, () => finish(false));
      change();
    });
    return await activated;
  } catch (_) {
    return false;
  }
}

export function readStaticBytes(path) {
  const url = new URL(path, location.href).href;
  return cached(staticBytes, url, () => read(url, (response) => response.arrayBuffer()));
}

export function readAudioBytes(path) {
  const url = new URL(path, location.href).href;
  const bytes = cached(audioBytes, url, () => read(url, (response) => response.arrayBuffer()));
  // Web Audio may detach the input buffer as part of decoding.
  return bytes.then((data) => data.slice(0));
}

export function musicSource(path) {
  const url = new URL(path, location.href).href;
  return trackSources.get(url) || url;
}

function prepareOne(path) {
  const url = new URL(path, import.meta.url).href;
  if (RECORDINGS.has(path)) {
    return cached(warmed, url, async () => {
      const song = await read(url, (response) => response.blob());
      trackSources.set(url, URL.createObjectURL(song));
    });
  }
  if (AUDIO.test(url)) return readAudioBytes(url);
  if (/\.(?:bin(?:\.gz)?|json)$/i.test(new URL(url).pathname)) return readStaticBytes(url);
  return cached(warmed, url, () => read(url, (response) => response.blob()).then(() => {}));
}

async function prepareBatch(items, report) {
  let next = 0;
  let done = 0;
  const failed = [];
  const run = async () => {
    while (next < items.length) {
      const path = items[next++];
      try {
        await prepareOne(path);
      } catch (_) {
        failed.push(path);
      }
      report?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({length: Math.min(5, items.length)}, run));
  return failed;
}

export async function prepareBundledAssets({admin, progress}) {
  const manifestURL = new URL("./preload.json", import.meta.url);
  const extra = await read(manifestURL, response => response.json()).catch(() => []);
  const supported = typeof DecompressionStream === "function"
    ? extra
    : extra.map(path => path.replace(/\.bin\.gz$/, ".bin"));
  const items = [...new Set([...MEDIA, ...ART, ...supported])];
  if (admin) {
    items.push(...["banners","battlepass","items","legal","lootboxes","market",
      "news","quizzes","shop","tasks","users","wheel"].map((name) => "/static/img/admin/" + name + ".png"));
  }
  // Start tracks early since they account for most transferred bytes.
  items.sort((a, b) => Number(RECORDINGS.has(b)) - Number(RECORDINGS.has(a)));
  const missing = await prepareBatch(items, progress);
  return prepareBatch(missing);
}

export function prepareContentImages(root, snapshots, report) {
  const paths = new Set();
  const remember = (source) => {
    try {
      const url = new URL(source, location.href);
      if (url.origin === location.origin && url.pathname.startsWith("/static/") && IMAGE.test(url.pathname)
          && !warmed.has(url.href)) paths.add(url.href);
    } catch (_) {}
  };
  const scan = (value) => {
    if (typeof value === "string") {
      if (value.startsWith("/static/") || value.startsWith(location.origin + "/static/")) remember(value);
    } else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === "object") Object.values(value).forEach(scan);
  };
  root.querySelectorAll("img[src],video[poster]").forEach((image) => remember(image.src || image.poster));
  snapshots.forEach(scan);
  return prepareBatch([...paths], report);
}
