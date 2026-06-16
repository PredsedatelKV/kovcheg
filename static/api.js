const tg = window.Telegram && window.Telegram.WebApp;

function initData() {
  const v = tg && tg.initData;
  if (v && v.length > 0) return v;
  // DEV-фолбэк ТОЛЬКО на localhost. На проде пустой initData НЕ подставляем —
  // иначе игрок без подписи Telegram аутентифицировался бы как админ (Омар).
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "DEV";
  return "";
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Telegram-Init-Data", initData());
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
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  // On 2xx with empty/invalid body, json() above left data null. Callers expect
  // an object so `data.field` access doesn't throw — normalize to {}.
  return data ?? {};
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: "POST", body: body ? JSON.stringify(body) : null });
export const patch = (p, body) => api(p, { method: "PATCH", body: body ? JSON.stringify(body) : null });
export const put = (p, body) => api(p, { method: "PUT", body: body ? JSON.stringify(body) : null });
export const del = (p) => api(p, { method: "DELETE" });

/** Upload a single image via multipart form. Returns `{url, filename, size}`. */
export async function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  return api("/api/admin/uploads", { method: "POST", body: fd });
}

/**
 * Render an item/task icon, supporting both file paths and emoji fallbacks.
 * size: "sm" (24px), "md" (32px), "lg" (48px), "xl" (64px).
 */
export function iconHtml(icon, size = "md", alt = "") {
  const safe = String(icon ?? "").trim();
  const cls = `pixel-icon pixel-icon-${size}`;
  if (safe.startsWith("/") || safe.startsWith("http")) {
    return `<img src="${safe}" alt="${alt}" class="${cls}"/>`;
  }
  if (safe === "") {
    return `<img src="/static/img/ui/box.svg" alt="" class="${cls}"/>`;
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
  const safe = String(src).trim();
  const alt = (item.name || "").replace(/"/g, "");
  if (safe.startsWith("/") || safe.startsWith("http")) {
    const mode = item.image_url ? "cover" : "contain";
    return `<div class="img-frame img-frame-${size}"><img src="${safe}" alt="${alt}" class="img-${mode}"/></div>`;
  }
  // emoji fallback for legacy DB rows
  return `<div class="img-frame img-frame-${size}"><span class="img-emoji">${safe}</span></div>`;
}

