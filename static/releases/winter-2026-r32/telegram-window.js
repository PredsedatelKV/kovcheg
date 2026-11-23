const EDGES = ["top", "right", "bottom", "left"];
const EDITOR = 'textarea, [contenteditable="true"], input:not([type]), input:is([type="text"],[type="search"],[type="email"],[type="tel"],[type="url"],[type="password"],[type="number"])';
const SUPPORTED_MOBILE = new Set(["ios", "android", "android_x"]);
let session;

function valueAsInset(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(220, Math.ceil(n))) : 0;
}

export function initTelegramWindow(tg = window.Telegram?.WebApp) {
  if (!tg || session) return;
  const root = document.documentElement;
  const mobile = SUPPORTED_MOBILE.has(tg.platform);
  const version = feature => !tg.isVersionAtLeast || tg.isVersionAtLeast(feature);
  const call = method => {
    try {
      if (typeof tg[method] !== "function") return false;
      tg[method]();
      return true;
    } catch (_) { return false; }
  };
  const canFullscreen = mobile && typeof tg.requestFullscreen === "function" && version("8.0");
  let timer = 0, scheduled = 0, legacy = false, expanded = false;
  const last = new Map();

  function write(name, value) {
    if (last.get(name) === value) return;
    last.set(name, value);
    root.style.setProperty(name, value);
  }

  function sync() {
    scheduled = 0;
    if (!mobile || legacy) return;
    const full = tg.isFullscreen === true;
    root.dataset.kovTelegram = full ? "fullscreen" : "sheet";
    for (const edge of EDGES) {
      const system = valueAsInset(tg.safeAreaInset?.[edge]);
      const content = valueAsInset(tg.contentSafeAreaInset?.[edge]);
      // The host reports system/cutout and overlay-button margins separately.
      const buttons = full && edge === "top" ? Math.max(content, 44) : content;
      write("--kov-system-" + edge, system + "px");
      write("--kov-content-" + edge, buttons + "px");
    }

    const layout = window.innerHeight;
    const reported = Number(tg.viewportStableHeight);
    const stable = Number.isFinite(reported) && reported > 100 ? reported : layout;
    let height = Math.min(stable, layout || stable);
    const visible = window.visualViewport;
    const editing = document.activeElement?.matches(EDITOR);
    const keyboard = editing && visible && visible.scale <= 1.05 && visible.height < height - 60;
    const top = keyboard ? Math.max(0, Math.round(visible.offsetTop)) : 0;
    if (keyboard) height = visible.height;
    root.toggleAttribute("data-kov-keyboard", Boolean(keyboard));
    if (height > 80) write("--kov-host-height", Math.floor(height) + "px");
    write("--kov-window-top", top + "px");
  }

  function schedule() {
    if (!scheduled && mobile && !legacy) scheduled = requestAnimationFrame(sync);
  }

  function fallback() {
    if (!expanded && !tg.isFullscreen) {
      expanded = true;
      call("expand");
    }
    schedule();
  }

  function cancelPending() {
    if (timer) clearTimeout(timer);
    timer = 0;
  }

  function onFullscreenChanged() {
    cancelPending();
    schedule();
  }

  function onFullscreenFailed(event) {
    cancelPending();
    if (event?.error === "ALREADY_FULLSCREEN") schedule();
    else fallback();
  }

  // Install listeners before the first request. A native callback can be
  // synchronous on some clients; send at most one automatic request at launch.
  if (mobile) {
    tg.onEvent?.("safeAreaChanged", schedule);
    tg.onEvent?.("contentSafeAreaChanged", schedule);
    tg.onEvent?.("viewportChanged", event => {
      if (event?.isStateStable !== false) schedule();
    });
    if (canFullscreen) {
      tg.onEvent?.("fullscreenChanged", onFullscreenChanged);
      tg.onEvent?.("fullscreenFailed", onFullscreenFailed);
    }
    window.addEventListener("resize", schedule, {passive:true});
    window.visualViewport?.addEventListener("resize", schedule, {passive:true});
    window.visualViewport?.addEventListener("scroll", schedule, {passive:true});
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
  }

  session = {
    useLegacySheet() {
      legacy = true;
      cancelPending();
      delete root.dataset.kovTelegram;
      root.removeAttribute("data-kov-keyboard");
      for (const key of last.keys()) root.style.removeProperty(key);
      if (tg.isFullscreen) call("exitFullscreen");
      else fallback();
    },
  };

  if (mobile) sync();
  call("ready");
  if (version("7.7")) call("disableVerticalSwipes");
  if (canFullscreen && !tg.isFullscreen) {
    timer = setTimeout(() => { timer = 0; fallback(); }, 1400);
    if (!call("requestFullscreen")) {
      cancelPending();
      fallback();
    }
  } else if (!tg.isFullscreen) fallback();
}

export function useTelegramLegacySheet() {
  session?.useLegacySheet();
}
