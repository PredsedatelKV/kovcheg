const tg = window.Telegram && window.Telegram.WebApp;
const DEFAULT_ITEM_ICON = "/static/img/ui/box.svg";
const LOOTBOX_ASSET_VERSION = "287";

export function versionedAssetUrl(value) {
  const src = String(value ?? "").trim();
  if (!src.startsWith("/static/img/items/lootbox_")) return src;
  return `${src.split("?", 1)[0]}?v=${LOOTBOX_ASSET_VERSION}`;
}

// Image load errors do not bubble, therefore one capture listener handles all
// current and future item images. The marker makes the fallback strictly
// one-shot: if the fallback itself is unavailable it cannot create an error
// loop or repeatedly mutate `src`.
if (typeof document !== "undefined" && !window.__kovImageFallbackInstalled) {
  window.__kovImageFallbackInstalled = true;
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-kov-fallback")) return;
    if (img.dataset.kovFallbackApplied === "1") return;
    img.dataset.kovFallbackApplied = "1";
    img.src = img.dataset.kovFallback || DEFAULT_ITEM_ICON;
  }, true);
}

// A small in-memory query cache.  It deliberately covers only read-mostly
// screens; live multiplayer/clicker endpoints are still fetched every time.
// Besides making a second tab visit instant, `inFlightGets` coalesces identical
// requests made by several cards during the same render.
const queryCache = new Map();
const inFlightGets = new Map();
const inFlightMutations = new Map();
const recentMutationKeys = new Map();
const requestVersions = new Map();
const MUTATION_RECOVERY_MS = 10 * 60 * 1000;

const CACHE_POLICIES = [
  { test: (p) => p === "/api/home", freshFor: 30_000, staleFor: 7 * 24 * 60 * 60_000 },
  { test: (p) => p === "/api/home/news", freshFor: 30_000, staleFor: 300_000 },
  { test: (p) => p === "/api/home/daily-reward", freshFor: 5_000, staleFor: 30_000 },
  { test: (p) => p === "/api/profile/me", freshFor: 3_000, staleFor: 30_000 },
  { test: (p) => p === "/api/profile/players", freshFor: 10_000, staleFor: 60_000 },
  { test: (p) => p === "/api/profile/transactions", freshFor: 5_000, staleFor: 30_000 },
  { test: (p) => p === "/api/battlepass", freshFor: 5_000, staleFor: 60_000 },
  { test: (p) => p === "/api/battlepass/lootbox-pools", freshFor: 30_000, staleFor: 300_000 },
  { test: (p) => p === "/api/shop/products", freshFor: 30_000, staleFor: 7 * 24 * 60 * 60_000 },
  { test: (p) => p === "/api/shop/categories", freshFor: 30_000, staleFor: 7 * 24 * 60 * 60_000 },
  { test: (p) => p === "/api/market/listings", freshFor: 15_000, staleFor: 7 * 24 * 60 * 60_000 },
  { test: (p) => p === "/api/market/inventory", freshFor: 5_000, staleFor: 30_000 },
  { test: (p) => p === "/api/market/my", freshFor: 5_000, staleFor: 30_000 },
  { test: (p) => p === "/api/quiz/available", freshFor: 15_000, staleFor: 120_000 },
  { test: (p) => p === "/api/wheel/status", freshFor: 5_000, staleFor: 30_000 },
  { test: (p) => p === "/api/arcade/first-win-status", freshFor: 2_000, staleFor: 15_000 },
];

const PERSISTED_CACHE_PATHS = new Set([
  "/api/home",
  "/api/home/news",
  "/api/shop/products",
  "/api/shop/categories",
  "/api/market/listings",
]);
const cacheUserScope = tg?.initDataUnsafe?.user?.id || "browser";
const PERSISTED_CACHE_KEY = `kovcheg.query-cache.v244.${cacheUserScope}`;

function persistQueryCache() {
  try {
    const payload = {};
    PERSISTED_CACHE_PATHS.forEach((path) => {
      const cached = queryCache.get(path);
      if (cached) payload[path] = cached;
    });
    localStorage.setItem(PERSISTED_CACHE_KEY, JSON.stringify(payload));
  } catch (_) {
    // Storage may be disabled or full in an embedded WebView; memory cache remains available.
  }
}

try {
  const persisted = JSON.parse(localStorage.getItem(PERSISTED_CACHE_KEY) || "{}");
  const oldestAllowed = Date.now() - 7 * 24 * 60 * 60_000;
  Object.entries(persisted).forEach(([path, cached]) => {
    if (!PERSISTED_CACHE_PATHS.has(path) || !cached || cached.updatedAt < oldestAllowed) return;
    queryCache.set(path, cached);
  });
} catch (_) {
  // Corrupt or unavailable storage is ignored and replaced by the next good response.
}

function normalizedPath(path) {
  return String(path || "").split("#", 1)[0];
}

function cachePolicy(path, options) {
  if (options.cache === false) return null;
  if (Number.isFinite(options.freshFor) || Number.isFinite(options.staleFor)) {
    const freshFor = Math.max(0, Number(options.freshFor) || 0);
    return { freshFor, staleFor: Math.max(freshFor, Number(options.staleFor) || freshFor) };
  }
  const pathname = normalizedPath(path).split("?", 1)[0];
  return CACHE_POLICIES.find((rule) => rule.test(pathname)) || null;
}

function bumpVersion(key) {
  requestVersions.set(key, (requestVersions.get(key) || 0) + 1);
  return requestVersions.get(key);
}

/**
 * Drop matching cached queries and invalidate already-running responses.
 * `match` may be a path prefix, predicate, or omitted to clear all queries.
 */
export function invalidateCache(match) {
  const matches = typeof match === "function"
    ? match
    : (key) => !match || key.startsWith(String(match));
  const keys = new Set([
    ...queryCache.keys(),
    ...inFlightGets.keys(),
    ...requestVersions.keys(),
  ]);
  keys.forEach((key) => {
    if (!matches(key)) return;
    queryCache.delete(key);
    // Do not let the next reader attach to a request that started before the
    // mutation. The old request may finish for its original caller, but its
    // version can no longer enter the cache.
    inFlightGets.delete(key);
    bumpVersion(key);
  });
  persistQueryCache();
}

/**
 * Read the last cached payload without starting a request.  The tab shell uses
 * this only to decide whether a completed background revalidation actually
 * changed anything before it quietly refreshes mounted DOM.
 */
export function peekCached(path) {
  const cached = queryCache.get(normalizedPath(path));
  return cached ? cached.data : undefined;
}

function invalidateForMutation(path) {
  const pathname = normalizedPath(path).split("?", 1)[0];
  // Admin operations can affect any catalogue or player; a broad invalidation
  // is safer there. Normal player actions invalidate only related screens.
  if (pathname.startsWith("/api/admin/")) {
    invalidateCache();
    return;
  }
  const groups = [];
  if (pathname.startsWith("/api/home/daily-reward")) groups.push("/api/home", "/api/profile");
  if (pathname.startsWith("/api/battlepass")) groups.push("/api/battlepass", "/api/home", "/api/profile");
  if (pathname.startsWith("/api/shop")) groups.push("/api/shop", "/api/market/inventory", "/api/profile");
  if (pathname.startsWith("/api/market")) groups.push("/api/market", "/api/profile", "/api/shop");
  if (pathname.startsWith("/api/profile")) groups.push("/api/profile", "/api/market");
  if (pathname.startsWith("/api/tasks")) groups.push("/api/home", "/api/profile");
  if (pathname.startsWith("/api/wheel")) groups.push("/api/wheel", "/api/home", "/api/profile");
  if (pathname.startsWith("/api/quiz")) groups.push("/api/quiz", "/api/home", "/api/profile", "/api/battlepass");
  if (pathname.startsWith("/api/arcade")) groups.push("/api/arcade", "/api/profile", "/api/battlepass");
  if (groups.length === 0 && pathname.startsWith("/api/")) groups.push(pathname);
  new Set(groups).forEach((prefix) => invalidateCache(prefix));
}

function initData() {
  const v = tg && tg.initData;
  if (v && v.length > 0) return v;
  // DEV-фолбэк ТОЛЬКО на localhost. На проде пустой initData НЕ подставляем —
  // иначе игрок без подписи Telegram аутентифицировался бы как админ (Омар).
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "DEV";
  return "";
}

function newIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Legacy WebView fallback. Timestamp + two random components is sufficient
  // to avoid accidental client-side collisions; the server still scopes keys
  // to the authenticated user.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function mutationBodyKey(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof FormData) {
    return Array.from(body.entries(), ([name, value]) => {
      if (typeof value === "string") return `${name}=${value}`;
      return `${name}=[file:${value.name}:${value.size}:${value.type}:${value.lastModified || 0}]`;
    }).join("&");
  }
  return String(body);
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Telegram-Init-Data", initData());
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !headers.has("X-Idempotency-Key")) {
    headers.set("X-Idempotency-Key", newIdempotencyKey());
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `Ошибка ${res.status}`;
    const error = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    error.status = res.status;
    error.idempotencyStatus = res.headers.get("X-Idempotency-Status") || "";
    throw error;
  }
  // On 2xx with empty/invalid body, json() above left data null. Callers expect
  // an object so `data.field` access doesn't throw — normalize to {}.
  return data ?? {};
}

async function fetchGet(path, options, policy) {
  const key = normalizedPath(path);
  // A caller-owned AbortSignal must not cancel a shared request used elsewhere.
  const canShare = options.dedupe !== false && !options.signal;
  if (canShare && !options.force && inFlightGets.has(key)) return inFlightGets.get(key);

  const version = bumpVersion(key);
  const request = api(path, { method: "GET", signal: options.signal })
    .then((data) => {
      // A mutation or newer forced request may have happened while this request
      // was in flight. Never deliver that obsolete payload to the original
      // renderer: attach it to the newer request/cache instead.
      if (requestVersions.get(key) !== version) {
        return get(path, { ...options, force: false });
      }
      if (policy) {
        queryCache.set(key, { data, updatedAt: Date.now() });
        if (PERSISTED_CACHE_PATHS.has(key)) persistQueryCache();
      }
      return data;
    })
    .finally(() => {
      if (inFlightGets.get(key) === request) inFlightGets.delete(key);
    });
  if (canShare) inFlightGets.set(key, request);
  return request;
}

/**
 * GET with request coalescing and opt-in stale-while-revalidate policies.
 * Existing callers need no changes. Pass `{cache:false}` for a guaranteed live
 * read, or `{force:true}` to refresh while retaining race protection.
 */
export function get(path, options = {}) {
  const key = normalizedPath(path);
  const policy = cachePolicy(path, options);
  const cached = policy ? queryCache.get(key) : null;
  const age = cached ? Date.now() - cached.updatedAt : Infinity;

  if (!options.force && cached && age <= policy.freshFor) {
    return Promise.resolve(cached.data);
  }
  if (!options.force && cached && age <= policy.staleFor) {
    // Serve the stable screen immediately; revalidate without replacing it by
    // a loader. Failure intentionally keeps the last known-good value.
    fetchGet(path, options, policy).catch(() => {});
    return Promise.resolve(cached.data);
  }
  return fetchGet(path, options, policy);
}

function mutate(path, options) {
  const method = String(options.method || "POST").toUpperCase();
  const fingerprint = `${method}\n${normalizedPath(path)}\n${mutationBodyKey(options.body)}`;
  const existing = inFlightMutations.get(fingerprint);
  if (existing) return existing.promise;

  const now = Date.now();
  for (const [key, value] of recentMutationKeys) {
    if (value.expiresAt <= now) recentMutationKeys.delete(key);
  }
  const headers = new Headers(options.headers || {});
  const recoverable = recentMutationKeys.get(fingerprint);
  const idempotencyKey = recoverable && recoverable.expiresAt > now
    ? recoverable.idempotencyKey
    : newIdempotencyKey();
  recentMutationKeys.set(fingerprint, {
    idempotencyKey,
    expiresAt: now + MUTATION_RECOVERY_MS,
  });
  headers.set("X-Idempotency-Key", idempotencyKey);
  const send = () => api(path, { ...options, method, headers });
  // A connection can drop after the server committed but before the WebView
  // received the token/balance. Retry once with the exact same key so the
  // durable server receipt replays the response instead of repeating a spend.
  const request = send()
    .catch(async (error) => {
      if (!(error instanceof TypeError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return send();
    })
    .then((result) => {
      recentMutationKeys.delete(fingerprint);
      invalidateForMutation(path);
      // One authoritative mutation signal keeps every mounted tab in sync.
      // The shell updates global balance immediately and marks hidden tabs for
      // an automatic fresh render before they become visible.
      window.dispatchEvent(new CustomEvent("kov:data-mutated", {
        detail: { path: normalizedPath(path), method, result },
      }));
      return result;
    })
    .catch((error) => {
      // HTTP errors are definitive and need a fresh key after the user fixes
      // their input. Network errors keep the key for a later manual retry.
      if (!(error instanceof TypeError) && !error.idempotencyStatus) {
        recentMutationKeys.delete(fingerprint);
      }
      throw error;
    })
    .finally(() => {
      const active = inFlightMutations.get(fingerprint);
      if (active && active.promise === request) inFlightMutations.delete(fingerprint);
    });
  // Expose the key for diagnostics/tests without changing the resolved value.
  Object.defineProperty(request, "idempotencyKey", { value: idempotencyKey, enumerable: false });
  inFlightMutations.set(fingerprint, { promise: request, idempotencyKey });
  return request;
}

export const post = (p, body) => mutate(p, { method: "POST", body: body != null ? JSON.stringify(body) : null });
export const patch = (p, body) => mutate(p, { method: "PATCH", body: body != null ? JSON.stringify(body) : null });
export const put = (p, body) => mutate(p, { method: "PUT", body: body != null ? JSON.stringify(body) : null });
export const del = (p) => mutate(p, { method: "DELETE" });

/** Warm read-mostly screens during browser idle time without mounting them. */
export function prefetch(paths) {
  return Promise.allSettled((paths || []).map((path) => get(path)));
}

/** Upload a single image via multipart form. Returns `{url, filename, size}`. */
export async function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  return mutate("/api/admin/uploads", { method: "POST", body: fd });
}

/**
 * Render an item/task icon, supporting both file paths and emoji fallbacks.
 * size: "sm" (24px), "md" (32px), "lg" (48px), "xl" (64px).
 */
export function iconHtml(icon, size = "md", alt = "") {
  const safe = versionedAssetUrl(icon);
  const cls = `pixel-icon pixel-icon-${size}`;
  if (safe.startsWith("/") || safe.startsWith("http")) {
    return `<img src="${safe}" alt="${alt}" class="${cls}" data-kov-fallback="${DEFAULT_ITEM_ICON}"/>`;
  }
  if (safe === "") {
    return `<img src="${DEFAULT_ITEM_ICON}" alt="" class="${cls}" data-kov-fallback="${DEFAULT_ITEM_ICON}"/>`;
  }
  // emoji fallback for legacy DB rows
  return `<span class="${cls} pixel-icon-emoji">${safe}</span>`;
}

/**
 * Render a uniform 1:1 product/inventory image frame. If `item.image_url` is set
 * (uploaded photo), it fills via object-fit: cover. Otherwise the pixel-art icon
 * is centered with padding. Use one of "lg" (in inventory cells), "xl" (in shop
 * and market product cards), or "md" (in listings).
 */
export function productImg(item, size = "xl") {
  if (!item) return `<div class="img-frame img-frame-${size}"></div>`;
  const src = item.image_url || item.icon || "/static/img/ui/box.svg";
  const safe = versionedAssetUrl(src);
  const alt = (item.name || "").replace(/"/g, "");
  if (safe.startsWith("/") || safe.startsWith("http")) {
  const mode = (item.lootbox_pool_code || String(item.code || "").includes("fragment"))
    ? "contain"
    : (item.image_url ? "product-photo" : "contain");
    return `<div class="img-frame img-frame-${size}"><img src="${safe}" alt="${alt}" class="img-${mode}" data-kov-fallback="${DEFAULT_ITEM_ICON}"/></div>`;
  }
  // emoji fallback for legacy DB rows
  return `<div class="img-frame img-frame-${size}"><span class="img-emoji">${safe}</span></div>`;
}
