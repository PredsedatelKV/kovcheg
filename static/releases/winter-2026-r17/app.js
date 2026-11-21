import { get, post, prefetch, peekCached } from "./api.js";
import { initSettings, openSettings, playUISound } from "./pages/settings.js";
import { icon, escapeText } from "./ui.js";

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  const applySafeArea = () => {
    const inset = tg.contentSafeAreaInset || {};
    for (const edge of ["top", "bottom"]) {
      document.documentElement.style.setProperty("--station-telegram-" + edge, Math.max(0, Number(inset[edge]) || 0) + "px");
    }
  };
  applySafeArea();
  tg.onEvent?.("contentSafeAreaChanged", applySafeArea);
  // Чтобы свайпы по карусели не двигали/закрывали сам мини-апп.
  if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
}

initSettings();

const renderFrom = (load, name) => async (root) => (await load())[name](root);
const RENDERERS = {
  home: renderFrom(() => import("./pages/home.js"), "renderHome"),
  profile: renderFrom(() => import("./pages/profile.js"), "renderProfile"),
  koverna: renderFrom(() => import("./pages/koverna.js"), "renderKoverna"),
  arcade: renderFrom(() => import("./pages/arcade.js"), "renderArcade"),
  battlepass: renderFrom(() => import("./pages/battlepass.js"), "renderBattlePass"),
  admin: renderFrom(() => import("./pages/admin.js"), "renderAdmin"),
};
const snowField = document.getElementById("winter-flakes");
const snowIcon = new URL("./media/snowflake.png", import.meta.url).href;
snowField.innerHTML = Array.from({ length: 38 }, (_, i) => {
  const left = (i * 37 + 13) % 100;
  return '<span style="--flake-x:' + left + '%;--flake-size:' + (i % 5 + 5) +
    'px;--flake-time:' + (11 + i % 7) + 's;--flake-delay:' + (-1 - i * 1.4) + 's"></span>';
}).join("");
snowField.style.setProperty("--snowflake-art", 'url("' + snowIcon + '")');
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("winter-inactive", document.hidden);
});

const auxiliaryTabs = new Set(["admin"]);
let returnTab = "home";
document.querySelectorAll("[data-icon]").forEach((element) => {
  element.innerHTML = icon(element.dataset.icon);
});

const viewEl = document.getElementById("view");
const tabButtons = [...document.querySelectorAll(".tabbtn")];
const tabLens = document.querySelector(".station-nav-lens");
let lensPulse;
let lensIndex = -1;
const containers = {};
const tabState = {};

let currentTab = null;

// Tab lifecycle listeners. Mounted tabs stay in the DOM, so pages can pause
// timers while hidden and resume them without a destructive re-render.
const tabListeners = {};
const tabShowListeners = {};

function onTabChange(name, fn) {
  if (!tabListeners[name]) tabListeners[name] = [];
  tabListeners[name].push(fn);
  return () => {
    tabListeners[name] = (tabListeners[name] || []).filter((listener) => listener !== fn);
  };
}

function onTabShow(name, fn) {
  if (!tabShowListeners[name]) tabShowListeners[name] = [];
  tabShowListeners[name].push(fn);
  return () => {
    tabShowListeners[name] = (tabShowListeners[name] || []).filter((listener) => listener !== fn);
  };
}

function notifyTabHidden(name) {
  const list = tabListeners[name];
  if (list) [...list].forEach(function(fn) { fn(); });
}

function notifyTabShown(name) {
  const list = tabShowListeners[name];
  if (list) [...list].forEach(function(fn) { fn(); });
}

function getTabState(name) {
  if (!tabState[name]) {
    let savedScroll = 0;
    try { savedScroll = Number(sessionStorage.getItem(`kovcheg.scroll.${name}`)) || 0; } catch (_) {}
    tabState[name] = {
      rendered: false,
      renderPromise: null,
      refreshPromise: null,
      scrollTop: Math.max(0, savedScroll),
      lastRevalidatedAt: 0,
      revalidateVersion: 0,
      needsRefresh: false,
    };
  }
  return tabState[name];
}

function rememberScroll(name) {
  if (!name) return;
  const state = getTabState(name);
  state.scrollTop = Math.max(0, viewEl.scrollTop || 0);
  try { sessionStorage.setItem(`kovcheg.scroll.${name}`, String(state.scrollTop)); } catch (_) {}
}

function restoreScroll(name) {
  const expectedTab = name;
  requestAnimationFrame(() => {
    if (currentTab !== expectedTab) return;
    viewEl.scrollTop = getTabState(name).scrollTop;
  });
}

function createTabContainer(name) {
  const div = document.createElement("div");
  div.className = "tab-content";
  div.dataset.tabContent = name;
  div.style.display = "none";
  viewEl.appendChild(div);
  containers[name] = div;
  return div;
}

function animateTab(container) {
  if (document.documentElement.classList.contains("motion-lite") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  container._entryMotion?.cancel();
  container._entryMotion = container.animate?.(
    [{ opacity: 0.66, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }],
    { duration: 185, easing: "cubic-bezier(.2,.72,.2,1)" },
  );
}

function showMountedTab(name) {
  if (currentTab !== name || !containers[name]) return;
  containers[name].style.display = "";
  restoreScroll(name);
  const state = getTabState(name);
  if (state.needsRefresh) {
    state.needsRefresh = false;
    refreshTab(name).catch((error) => console.warn("Не удалось тихо обновить вкладку", error));
    return;
  }
  animateTab(containers[name]);
  notifyTabShown(name);
  revalidateVisibleTab(name);
}

async function ensureTabRendered(name) {
  const state = getTabState(name);
  const div = containers[name] || createTabContainer(name);
  if (state.rendered) return div;
  if (state.renderPromise) return state.renderPromise;

  div.setAttribute("aria-busy", "true");
  div.innerHTML = '<div class="card"><p>Загрузка…</p></div>';
  state.renderPromise = (async () => {
    try {
      if (isSectionClosed(name)) renderMaintenance(div, name);
      else await RENDERERS[name](div);
      state.rendered = true;
      state.lastRevalidatedAt = Date.now();
      div.removeAttribute("aria-busy");
      if (currentTab !== name) {
        div.style.display = "none";
        notifyTabHidden(name);
      }
      return div;
    } catch (error) {
      state.rendered = false;
      div.removeAttribute("aria-busy");
      div.innerHTML = '<div class="card"><p>Не удалось загрузить раздел.</p><button class="btn" type="button">Повторить</button></div>';
      div.querySelector("button").addEventListener("click", () => ensureTabRendered(name).catch(console.error));
      throw error;
    } finally {
      state.renderPromise = null;
    }
  })();
  return state.renderPromise;
}

const TAB_QUERIES = {
  home: ["/api/home", "/api/home/daily-reward", "/api/home/news", "/api/quiz/available", "/api/wheel/status"],
  profile: ["/api/profile/me", "/api/profile/players", "/api/profile/transactions"],
  koverna: ["/api/shop/products", "/api/shop/categories", "/api/market/listings"],
  arcade: ["/api/profile/me", "/api/arcade/first-win-status"],
  battlepass: ["/api/battlepass"],
};

const SECTION_TITLES = {
  koverna: "Коверна",
  arcade: "Аркада",
  battlepass: "Боевой пропуск",
};

// Sections the server closed for this account. Their APIs are rejected server
// side too; this only keeps the client from rendering a page it cannot load.
function isSectionClosed(name) {
  const me = window.kov && window.kov.me;
  const closed = (me && me.maintenance_sections) || [];
  return closed.indexOf(name) !== -1;
}

function renderMaintenance(root, name) {
  root.innerHTML = `
    <div class="card maintenance-card">
      <div class="maintenance-icon">🛠</div>
      <h2 class="maintenance-title">${SECTION_TITLES[name] || "Раздел"} недоступен</h2>
      <p class="maintenance-text">Ведутся технические работы. Загляните позже.</p>
    </div>`;
}

function warmTab(name) {
  if (isSectionClosed(name)) return;
  const paths = TAB_QUERIES[name];
  if (paths) prefetch(paths).catch(() => {});
}

function comparableRevalidationValue(path, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const comparable = { ...value };
  // These fields intentionally change on every request and already have a
  // local live timer. They must not trigger a full mounted-tab refresh.
  if (path === "/api/home") {
    delete comparable.server_time_msk;
    delete comparable.server_epoch_ms;
  } else if (path === "/api/arcade/first-win-status") {
    delete comparable.server_time;
    delete comparable.next_reset_seconds;
  }
  return comparable;
}

function revalidateVisibleTab(name) {
  if (isSectionClosed(name)) return;
  const paths = TAB_QUERIES[name];
  const state = getTabState(name);
  const now = Date.now();
  if (!paths || now - state.lastRevalidatedAt < 15_000) return;
  state.lastRevalidatedAt = now;
  const version = ++state.revalidateVersion;
  const previous = paths.map((path) => peekCached(path));
  const balanceAtStart = window.kov && window.kov.me ? window.kov.me.balance : null;
  Promise.allSettled(paths.map((path) => get(path, { force: true }))).then(async (results) => {
    if (!window.kov || state.revalidateVersion !== version) return;
    const profileIndex = paths.indexOf("/api/profile/me");
    if (profileIndex !== -1) {
      const result = results[profileIndex];
      const freshUser = result && result.status === "fulfilled" && result.value && result.value.user;
      if (freshUser && window.kov.me) {
        const oldBalance = window.kov.me.balance;
        // A confirmed local action may have updated the balance while this
        // background read was travelling. Never roll that newer value back.
        if (oldBalance === balanceAtStart) {
          window.kov.me = { ...window.kov.me, ...freshUser };
          updateSnowflakes(freshUser.snowflakes);
          updatePassLevel(result.value.bp_level);
          if (freshUser.balance !== oldBalance) window.kov.emit("balance:update", { balance: freshUser.balance });
        }
      }
    }
    const changed = results.some((result, index) => {
      if (!result || result.status !== "fulfilled") return false;
      if (previous[index] === undefined) return true;
      const before = comparableRevalidationValue(paths[index], previous[index]);
      const after = comparableRevalidationValue(paths[index], result.value);
      try { return JSON.stringify(before) !== JSON.stringify(after); }
      catch (_) { return before !== after; }
    });
    if (currentTab !== name) {
      if (changed) state.needsRefresh = true;
      return;
    }
    if (changed) {
      try { await refreshTab(name); }
      catch (error) { console.warn("Не удалось тихо обновить вкладку", error); }
    }
    window.kov.emit("data:revalidated", { tab: name, paths, results, changed });
  });
}

async function refreshTab(name) {
  if (!RENDERERS[name] || !containers[name]) return;
  const state = getTabState(name);
  // Coalesce repeated local refreshes (for example two rapid market actions).
  if (state.refreshPromise) return state.refreshPromise;
  const div = containers[name];
  const wasVisible = currentTab === name;
  if (wasVisible) rememberScroll(name);
  const snapshot = wasVisible ? div.cloneNode(true) : null;
  if (snapshot) {
    snapshot.removeAttribute("aria-busy");
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.style.pointerEvents = "none";
    div.after(snapshot);
    div.style.display = "none";
  }
  // Give the mounted page a chance to stop timers before its DOM/listeners are
  // replaced. The freshly rendered page registers its own lifecycle below.
  notifyTabHidden(name);
  tabListeners[name] = [];
  tabShowListeners[name] = [];
  state.refreshPromise = (async () => {
    try {
      if (isSectionClosed(name)) renderMaintenance(div, name);
      else await RENDERERS[name](div);
      state.rendered = true;
    } catch (error) {
      state.rendered = false;
      throw error;
    } finally {
      if (snapshot) snapshot.remove();
      div.style.display = currentTab === name ? "" : "none";
      state.refreshPromise = null;
      if (currentTab === name) {
        restoreScroll(name);
        notifyTabShown(name);
      }
    }
  })();
  return state.refreshPromise;
}

function moveTabLens(index) {
  const previousIndex = lensIndex;
  lensIndex = index;
  lensPulse?.cancel();
  tabLens.hidden = index < 0;
  if (index < 0) return;
  tabLens.style.setProperty("--tab-lens-position", index);

  const settings = document.documentElement.classList;
  if (previousIndex < 0 || settings.contains("solid-surfaces") || settings.contains("motion-lite") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const distance = Math.abs(index - previousIndex);
  const stretch = 1.12 + distance * 0.06;
  lensPulse = tabLens.firstElementChild.animate?.([
    { transform: "scale(1)", offset: 0 },
    { transform: "scale(" + stretch + ", .9)", offset: .28 },
    { transform: "scale(.96, 1.035)", offset: .76 },
    { transform: "scale(1)", offset: 1 },
  ], { duration: 420, easing: "ease-in-out" });
}

async function setTab(name) {
  if (!window.kov.me) return;
  if (name === "chat") return openStationChat();
  if (!Object.prototype.hasOwnProperty.call(RENDERERS, name) || (name === "admin" && !window.kov.me.is_admin)) name = "home";
  if (name === currentTab) {
    if (auxiliaryTabs.has(name)) return refreshTab(name);
    return ensureTabRendered(name);
  }
  const prevTab = currentTab;

  if (prevTab) {
    rememberScroll(prevTab);
    containers[prevTab]?._entryMotion?.cancel();
    notifyTabHidden(prevTab);
  }

  if (auxiliaryTabs.has(name) && prevTab && !auxiliaryTabs.has(prevTab)) returnTab = prevTab;
  currentTab = name;
  const activeIndex = tabButtons.findIndex((button) => button.dataset.tab === name);
  moveTabLens(activeIndex);
  tabButtons.forEach((button, index) => {
    const active = index === activeIndex;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  updateBackButton();

  Object.entries(containers).forEach(([tabName, div]) => {
    div.style.display = tabName === name ? "" : "none";
  });
  const div = containers[name] || createTabContainer(name);
  div.style.display = "";
  restoreScroll(name);
  try { localStorage.setItem("kovcheg.tab", name); } catch (_) {}

  const alreadyRendered = getTabState(name).rendered;
  if (alreadyRendered) {
    showMountedTab(name);
    return div;
  }
  warmTab(name);
  const rendered = await ensureTabRendered(name);
  showMountedTab(name);
  return rendered;
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    playUISound("click");
    setTab(btn.dataset.tab).catch(console.error);
  });
  // Warm only the section the user is actually approaching. This replaces the
  // previous eager mounting of every tab (and all of its timers/subscriptions).
  btn.addEventListener("pointerenter", () => warmTab(btn.dataset.tab), { passive: true });
  btn.addEventListener("touchstart", () => warmTab(btn.dataset.tab), { passive: true, once: true });
});

// Modal lifecycle is owned by the shell. Feature modules register a guard or
// cleanup callback here instead of monkey-patching window.closeModal during
// ES-module evaluation (dependencies run before this file's body).
const modalBeforeCloseListeners = new Set();
const modalStack = [];
const modalOpeners = new WeakMap();

function hasOpenModal() {
  return Boolean(document.getElementById("modal-root")?.firstElementChild);
}

function updateBackButton() {
  if (hasOpenModal() || auxiliaryTabs.has(currentTab)) tg?.BackButton?.show();
  else tg?.BackButton?.hide();
}

function goBack() {
  if (hasOpenModal()) closeActiveModal("user");
  else if (auxiliaryTabs.has(currentTab)) setTab(returnTab).catch(console.error);
}

tg?.BackButton?.onClick(goBack);
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    const dialog = document.querySelector("#modal-root .modal");
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.disabled && element.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first || !dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last || dialog : first || dialog).focus();
    }
    return;
  }
  if (event.key !== "Escape" || (!hasOpenModal() && !auxiliaryTabs.has(currentTab))) return;
  event.preventDefault();
  goBack();
});

async function openStationChat() {
  if (document.querySelector("#modal-root .station-chat-dialog")) return;
  const dialog = window.kov.showModal(`
    <div class="station-chat-top">
      <h2>Чат</h2>
      <button class="close" type="button" aria-label="Закрыть чат" onclick="closeModal()">×</button>
    </div>
    <div class="station-chat-body"><div class="empty">Загрузка…</div></div>
  `, { sheet: true, label: "Чат" });
  dialog.classList.add("station-chat-dialog");
  dialog.style.setProperty("--station-menu-rows", stationMenuRows().length);
  const body = dialog.querySelector(".station-chat-body");
  try {
    const { renderChat } = await import("./pages/profile.js");
    if (dialog.isConnected) renderChat(body);
  } catch (error) {
    if (!dialog.isConnected) return;
    body.innerHTML = '<div class="empty">Не удалось загрузить чат</div>';
    console.warn("Ошибка открытия чата", error);
  }
}

function stationMenuRows() {
  const rows = [];
  if (window.kov.me?.is_admin) rows.push(["admin", "Админ-панель", "admin"]);
  rows.push(["laws", "Законодательство", "scales"], ["constitution", "Конституция", "book"]);
  if (window.kov.channelUrl) rows.push(["channel", "Канал в Telegram", "telegram"]);
  rows.push(["settings", "Настройки", "settings"]);
  return rows;
}

function openStationMenu() {
  const rows = stationMenuRows();
  const panel = window.kov.showModal(`
    <button class="close" type="button" aria-label="Закрыть" onclick="closeModal()">×</button>
    <h2>Меню</h2>
    <div class="station-menu-list">${rows.map(([action, title, symbol]) => `
      <button type="button" data-menu="${action}"><span class="menu-symbol">${icon(symbol)}</span><span><strong>${title}</strong></span>${icon("arrow")}</button>
    `).join("")}</div>
  `, { sheet: true, label: "Меню" });
  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-menu]")?.dataset.menu;
    if (!action) return;
    if (action === "settings") {
      openSettings({ stack: true });
    } else if (action === "laws" || action === "constitution") {
      const title = action === "laws" ? "Законодательство" : "Конституция";
      get("/api/content/legal/" + action).then((doc) => {
        if (!panel.isConnected) return;
        window.kov.showModal('<button class="close" type="button" aria-label="Назад" onclick="closeModal()">×</button><h2>' +
          escapeText(doc.title || title) + '</h2><div class="legal-text">' + escapeText(doc.body || "Документ пока не опубликован.") +
          '</div>', { stack: true, sheet: true, label: title });
      }).catch(() => {
        if (panel.isConnected) window.kov.toast("Документ пока недоступен");
      });
    } else if (action === "channel") {
      if (tg?.openTelegramLink) tg.openTelegramLink(window.kov.channelUrl);
      else window.open(window.kov.channelUrl, "_blank", "noopener,noreferrer");
    } else if (closeActiveModal("navigation")) {
      setTab(action).catch(console.error);
    }
  });
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-shell]")?.dataset.shell;
  if (!action || !window.kov.me) return;
  if (action === "menu") openStationMenu();
  else if (action === "back") goBack();
  else if (closeActiveModal("navigation")) setTab(action).catch(console.error);
});

function notifyModalBeforeClose(reason) {
  for (const listener of [...modalBeforeCloseListeners]) {
    try {
      if (listener({ reason }) === false) return false;
    } catch (error) {
      console.warn("Ошибка обработчика закрытия модального окна", error);
    }
  }
  return true;
}

function closeActiveModal(reason = "user") {
  const root = document.getElementById("modal-root");
  if (!root || !root.firstElementChild) return true;
  if (!notifyModalBeforeClose(reason)) return false;
  const opener = modalOpeners.get(root.firstElementChild);
  root.firstElementChild.remove();
  if (reason === "user" && modalStack.length > 0) {
    root.appendChild(modalStack.pop());
  } else {
    modalStack.length = 0;
  }
  updateBackButton();
  if (reason === "user" && opener?.isConnected) opener.focus({ preventScroll: true });
  return true;
}

// Global helpers — set early so renderers can use them
window.kov = {
  setTab,
  onTabChange,
  onTabShow,
  onModalBeforeClose(fn) {
    modalBeforeCloseListeners.add(fn);
    return () => modalBeforeCloseListeners.delete(fn);
  },
  getTab() { return currentTab; },
  // Re-render a tab into its own container (not the shared #view), so a renderer
  // can refresh itself without clobbering the structure of other tabs.
  rerender(name) {
    return refreshTab(name);
  },
  me: null,
  toast(msg) {
    playUISound("toast");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  },
  showModal(html, options = {}) {
    const root = document.getElementById("modal-root");
    const opener = document.activeElement;
    if (options.stack && root.firstElementChild) {
      modalStack.push(root.firstElementChild);
      root.firstElementChild.remove();
    } else {
      modalStack.length = 0;
      root.innerHTML = "";
    }
    root.insertAdjacentHTML("beforeend", `<div class="modal-overlay ${options.sheet ? "station-sheet" : ""}" data-close="1"><div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label="${escapeText(options.label || "Диалог Ковчега")}">${html}</div></div>`);
    const overlay = root.firstElementChild;
    modalOpeners.set(overlay, opener);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) window.closeModal();
    });
    const dialog = overlay.querySelector(".modal");
    updateBackButton();
    dialog.focus({ preventScroll: true });
    return dialog;
  },
};

// Event bus for cross-tab incremental updates
const _listeners = {};
window.kov.on = function (event, fn) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(fn);
  return function () { _listeners[event] = _listeners[event].filter(function(l) { return l !== fn; }); };
};
window.kov.emit = function (event, data) {
  var list = _listeners[event];
  if (list) list.forEach(function(fn) { fn(data); });
};

function mutationAffectedTabs(path) {
  // Chat messages, multiplayer moves and authentication do not mutate the
  // player's economy/profile. Every actual game mutation refreshes every
  // player tab so balances, XP, pass progress, inventory and stock cannot
  // remain stale in an already-mounted view.
  if (path.startsWith("/api/arcade/ice/") || path.startsWith("/api/arcade/arena/") || path.startsWith("/api/chat") || path.startsWith("/api/game") || path.startsWith("/api/assistant") || path.startsWith("/auth/")) return [];
  if (path.startsWith("/api/admin/")) return Object.keys(RENDERERS);
  return Object.keys(RENDERERS).filter((name) => name !== "admin");
}

function updateSnowflakes(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return;
  if (window.kov.me) window.kov.me.snowflakes = count;
  document.querySelectorAll("[data-snowflakes] strong,.wallet-snow-value").forEach((element) => {
    element.textContent = new Intl.NumberFormat("ru").format(count);
  });
}

const passCounter = document.querySelector("[data-pass-level]");
function updatePassLevel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return;
  passCounter.querySelector("strong").textContent = value;
  passCounter.setAttribute("aria-label", value ? `Боевой пропуск, уровень ${value}` : "Боевой пропуск, 0 XP");
  document.querySelectorAll(".wallet-level-value strong").forEach((counter) => {
    counter.textContent = value;
  });
}

let playerSummaryTimer;
let summaryGeneration = 0;
function mutationBalance(result) {
  if (Number.isFinite(Number(result?.balance))) return Number(result.balance);
  if (Number.isFinite(Number(result?.user?.balance))) return Number(result.user.balance);
  return null;
}

window.addEventListener("kov:data-mutated", (event) => {
  const detail = event.detail || {};
  const result = detail.result || {};
  if (result.user && window.kov.me) Object.assign(window.kov.me, result.user);
  const balance = mutationBalance(result);
  if (balance != null && window.kov.me) {
    window.kov.me.balance = balance;
    window.kov.emit("balance:update", { balance });
  }
  const path = String(detail.path || "");
  const snowflakes = result.snowflakes ?? result.user?.snowflakes ?? result.result?.snowflakes;
  if (snowflakes != null) updateSnowflakes(snowflakes);

  const affectedTabs = mutationAffectedTabs(path);
  if (affectedTabs.length) {
    const generation = ++summaryGeneration;
    clearTimeout(playerSummaryTimer);
    playerSummaryTimer = setTimeout(() => {
      get("/api/profile/me", { force: true }).then((profile) => {
        if (generation !== summaryGeneration) return;
        updateSnowflakes(profile.user.snowflakes);
        updatePassLevel(profile.bp_level);
      }).catch(() => {});
    }, 400);
    affectedTabs.forEach((name) => { getTabState(name).needsRefresh = true; });
  }
  window.kov.emit("data:mutated", detail);
});

// Live-update balance display anywhere on the page
window.kov.on("balance:update", function(data) {
  var els = document.querySelectorAll(".wallet-balance-value strong, [data-balance] strong");
  els.forEach(function(el) { el.textContent = new Intl.NumberFormat("ru").format(data.balance); });
});

window.closeModal = function () {
  return closeActiveModal("user");
};

function renderWinterGate() {
  document.documentElement.classList.add("winter-gate");
  viewEl.innerHTML = `
    <section class="winter-cover" aria-label="До открытия Ковчега">
      <img src="/static/releases/winter-2026-r3/media/poster.webp" alt="01.12">
      ${tg?.initData ? "" : '<button type="button" class="winter-cover-owner">Вход владельца</button>'}
    </section>`;
  viewEl.querySelector(".winter-cover-owner")?.addEventListener("click", () => {
    document.documentElement.classList.remove("winter-gate");
    renderBrowserLogin();
  });
}

async function renderBrowserLogin(profileError) {
  viewEl.innerHTML = `
    <section class="station-login">
      <div class="winter-hero station-login-hero">
        <div class="winter-hero-copy"><span class="winter-label">${icon("snow")} Зимняя станция</span><h1>Ковчег</h1><p>Федерация Ковчега</p></div>
      </div>
      <div class="card station-login-card">
        <h2>Войти в Ковчег</h2>
        <p>Подтвердите вход в Telegram, чтобы открыть свой профиль и игры.</p>
        <div class="station-login-actions">
          <button type="button" class="btn primary" id="login-start">${icon("telegram")} Войти через Telegram</button>
          <a id="browser-login" class="btn primary" target="_blank" rel="noopener" hidden>${icon("telegram")} Открыть бота</a>
        </div>
        <p id="browser-login-status" role="status" class="station-login-status"></p>
      </div>
    </section>`;
  const card = viewEl.querySelector(".station-login-card");
  const start = card.querySelector("#login-start");
  const link = card.querySelector("#browser-login");
  const status = card.querySelector("#browser-login-status");
  if (profileError && profileError.status !== 401) {
    status.textContent = profileError.status === 403 ? profileError.message : "Станция временно недоступна. Попробуйте ещё раз.";
    start.textContent = "Повторить";
    start.addEventListener("click", () => location.reload());
    return;
  }

  start.addEventListener("click", async () => {
    start.disabled = true;
    status.textContent = "Готовим ссылку…";
    try {
      const login = await post("/auth/web/start");
      const expires = Date.now() + (login.expires_in || 600) * 1000;
      start.hidden = true;
      link.hidden = false;
      link.href = login.login_url;
      status.textContent = "Откройте бота, нажмите «Старт» и вернитесь сюда.";
      const poll = async () => {
        if (!card.isConnected) return;
        if (Date.now() >= expires) {
          link.hidden = true;
          start.hidden = false;
          start.disabled = false;
          start.textContent = "Получить новую ссылку";
          status.textContent = "Срок действия ссылки истёк.";
          return;
        }
        if (!document.hidden) {
          try {
            const result = await post("/auth/web/complete", { token: login.token });
            if (result.authenticated) {
              status.textContent = "Вход подтверждён. Открываем Ковчег…";
              location.reload();
              return;
            }
          } catch (_) { /* Continue until the link expires. */ }
        }
        setTimeout(poll, 2500);
      };
      setTimeout(poll, 2500);
    } catch (error) {
      start.disabled = false;
      status.textContent = "Не удалось подготовить вход. " + error.message;
    }
  });
}

function showPendingLoginGifts(gifts) {
  if (!Array.isArray(gifts) || gifts.length === 0) return;
  const totals = { kovbucks: 0, xp: 0, items: [] };
  gifts.forEach((gift) => {
    totals.kovbucks += Number(gift.kovbucks) || 0;
    totals.xp += Number(gift.xp) || 0;
    if (gift.item_id && Number(gift.item_quantity) > 0) {
      totals.items.push({
        name: gift.item_name || "Предмет",
        icon: gift.item_icon || "/static/img/ui/box.svg",
        quantity: Number(gift.item_quantity),
      });
    }
  });
  const visualRewards = [];
  if (totals.kovbucks > 0) visualRewards.push({ kind: "kovbucks", label: `${totals.kovbucks} ковбаксов`, icon: "/static/img/ui/kovbaks.png" });
  if (totals.xp > 0) visualRewards.push({ kind: "xp", label: `${totals.xp} XP`, icon: "/static/img/ui/xp.png" });
  if (totals.items.length > 0) {
    const names = totals.items.map((item) => `${item.name} ×${item.quantity}`).join(" · ");
    visualRewards.push({ kind: "item", label: names, icon: totals.items[0].icon });
  }
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="login-gift-overlay" role="dialog" aria-modal="true" aria-label="Подарок от Ковчега">
      <div class="login-gift-screen">
        <div class="login-gift-sparkles" aria-hidden="true">✦ ✧ ✦</div>
        <h1>Подарок от Ковчега</h1>
        <p>Для вас подготовлены награды</p>
        <div class="login-gift-visual ${visualRewards.length === 1 ? "single" : "multiple"}" aria-label="Состав подарка"></div>
        <button class="btn login-gift-claim" id="login-gift-claim">Забрать</button>
      </div>
    </div>`;
  const visual = modalRoot.querySelector(".login-gift-visual");
  visual.setAttribute("aria-label", `Состав подарка: ${visualRewards.map((reward) => reward.label).join(", ")}`);
  visualRewards.forEach((reward) => {
    const token = document.createElement("div");
    token.className = `login-gift-token ${reward.kind}`;
    const icon = document.createElement("img");
    icon.src = reward.icon;
    icon.alt = "";
    const label = document.createElement("span");
    label.textContent = reward.label;
    token.append(icon, label);
    visual.appendChild(token);
  });
  const claimButton = modalRoot.querySelector("#login-gift-claim");
  claimButton.addEventListener("click", async () => {
    if (claimButton.disabled) return;
    claimButton.disabled = true;
    claimButton.textContent = "Забираем…";
    try {
      const result = await post("/api/profile/login-gifts/claim");
      if (!result.gifts || result.gifts.length === 0) {
        modalRoot.innerHTML = "";
        return;
      }
      window.kov.me = { ...window.kov.me, ...result.user };
      window.kov.emit("balance:update", { balance: result.user.balance });
      playUISound("win");
      claimButton.textContent = "Получено!";
      setTimeout(() => {
        modalRoot.innerHTML = "";
        if (window.kov.getTab() === "profile") window.kov.rerender("profile");
      }, 650);
    } catch (error) {
      claimButton.disabled = false;
      claimButton.textContent = "Забрать";
      window.kov.toast(error.message);
    }
  });
}

(async () => {
  let pendingLoginGifts = [];
  let profileError;
  try {
    const me = await get("/api/profile/me", { force: true });
    window.kov.me = me.user;
    updatePassLevel(me.bp_level ?? 0);
    pendingLoginGifts = me.login_gifts || [];
    window.kov.channelUrl = me.channel_url || "";
  } catch (err) {
    profileError = err;
  }
  // Без подтверждённой личности Telegram приложение не запускаем (иначе доступ к чужому профилю).
  if (!window.kov.me) {
    if (profileError?.status === 423) renderWinterGate();
    else await renderBrowserLogin(profileError);
    return;
  }
  // Every fresh launch starts from the public entrance. Mounted tabs remain
  // cached only inside the current session and never override this choice.
  viewEl.replaceChildren();
  document.getElementById("station-header").hidden = false;
  document.getElementById("tabbar").hidden = false;
  window.kov.emit("balance:update", { balance: window.kov.me.balance });
  updateSnowflakes(window.kov.me.snowflakes ?? 0);
  const initial = "home";
  try {
    await setTab(initial);
    showPendingLoginGifts(pendingLoginGifts);
    updateBackButton();
  } catch (_) {
    // `ensureTabRendered` already left a retryable error inside this tab. Do
    // not replace #view: doing so would detach every cached container and make
    // subsequent navigation point to dead DOM nodes.
    const failed = containers[initial];
    if (failed) failed.style.display = "";
  }
  import("./pages/multiplayer.js").then(({ initMultiplayer }) => initMultiplayer()).catch(console.error);
})();
