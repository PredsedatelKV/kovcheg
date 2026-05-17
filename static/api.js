const tg = window.Telegram?.WebApp;

function initData() {
  const v = tg?.initData;
  if (v && v.length > 0) return v;
  // dev fallback — only works with server flag SKIP_INIT_DATA_CHECK
  return "DEV";
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
    const msg = data?.detail || data?.error || `Ошибка ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: "POST", body: body ? JSON.stringify(body) : null });
export const patch = (p, body) => api(p, { method: "PATCH", body: body ? JSON.stringify(body) : null });
export const put = (p, body) => api(p, { method: "PUT", body: body ? JSON.stringify(body) : null });
export const del = (p) => api(p, { method: "DELETE" });

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

