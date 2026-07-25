import { renderHome } from "/static/pages/home.js?v=258";
import { renderProfile } from "/static/pages/profile.js?v=258";
import { renderKoverna } from "/static/pages/koverna.js?v=258";
import { renderArcade } from "/static/pages/arcade.js?v=258";
import { renderAdmin } from "/static/pages/admin.js?v=258";
import { renderBattlePass } from "/static/pages/battlepass.js?v=258";
import { initSettings, playUISound } from "/static/pages/settings.js?v=258";
import { initMultiplayer } from "/static/pages/multiplayer.js?v=258";
import { get, post, prefetch, peekCached } from "/static/api.js?v=258";

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor("secondary_bg_color");
  // Чтобы свайпы по карусели не двигали/закрывали сам мини-апп.
  if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
}

initSettings();

const RENDERERS = {
  home: renderHome,
  profile: renderProfile,
  koverna: renderKoverna,
  arcade: renderArcade,
  battlepass: renderBattlePass,
  admin: renderAdmin,
};

const viewEl = document.getElementById("view");
const tabButtons = document.querySelectorAll(".tabbtn");
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
      div.innerHTML = `<div class="card"><p style="color:var(--danger)">Не удалось загрузить раздел: ${String(error && error.message || error)}</p></div>`;
      throw error;
    } finally {
      state.renderPromise = null;
    }
  })();
  return state.renderPromise;
}

const TAB_QUERIES = {
  home: ["/api/home", "/api/quiz/available"],
  profile: ["/api/profile/me"],
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

async function setTab(name, force) {
  if (!RENDERERS[name]) name = "home";
  let btn = document.querySelector(`.tabbtn[data-tab="${name}"]`);
  // Скрытую вкладку (админка) можно открыть только принудительно (секретный жест).
  if (!force && btn && btn.hidden) {
    name = "home";
    btn = document.querySelector('.tabbtn[data-tab="home"]');
  }

  if (name === currentTab) return ensureTabRendered(name);
  const prevTab = currentTab;

  if (prevTab) {
    rememberScroll(prevTab);
    notifyTabHidden(prevTab);
  }

  currentTab = name;

  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));

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
    setTab(btn.dataset.tab);
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
  root.firstElementChild.remove();
  if (reason === "user" && modalStack.length > 0) {
    root.appendChild(modalStack.pop());
  } else {
    modalStack.length = 0;
  }
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
    if (options.stack && root.firstElementChild) {
      modalStack.push(root.firstElementChild);
      root.firstElementChild.remove();
    } else {
      modalStack.length = 0;
      root.innerHTML = "";
    }
    root.insertAdjacentHTML("beforeend", `<div class="modal-overlay" data-close="1"><div class="modal" role="dialog">${html}</div></div>`);
    const overlay = root.firstElementChild;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) window.closeModal();
    });
    return overlay.querySelector(".modal");
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

// Live-update balance display anywhere on the page
window.kov.on("balance:update", function(data) {
  var els = document.querySelectorAll(".wallet-balance-value strong");
  els.forEach(function(el) { el.textContent = data.balance; });
});

window.closeModal = function () {
  return closeActiveModal("user");
};

async function renderBrowserLogin() {
  tabButtons.forEach((button) => { button.disabled = true; });
  viewEl.innerHTML = `
    <div class="card" style="max-width:560px;margin:24px auto;padding:28px;text-align:center">
      <h2 style="margin-top:0">Войти в Ковчег</h2>
      <p>Подтвердите свою личность через Telegram. После этого сайт откроет тот же профиль и все возможности, что и Mini App.</p>
      <a id="browser-login" class="btn primary" target="_blank" rel="noopener" style="display:inline-flex;margin:12px 0">Открыть бота в Telegram</a>
      <p id="browser-login-status" style="margin-bottom:0;color:var(--muted)">Подготавливаем защищённый вход…</p>
    </div>`;
  const link = document.getElementById("browser-login");
  const status = document.getElementById("browser-login-status");
  try {
    const login = await post("/auth/web/start");
    link.href = login.login_url;
    status.textContent = "Нажмите кнопку, затем в Telegram нажмите «Старт». Сайт откроется автоматически.";
    const timer = setInterval(async () => {
      try {
        const result = await post("/auth/web/complete", { token: login.token });
        if (result.authenticated) {
          clearInterval(timer);
          status.textContent = "Вход подтверждён. Загружаем Ковчег…";
          location.reload();
        }
      } catch (_) {
        // Temporary network failures should not interrupt the waiting screen.
      }
    }, 2500);
    setTimeout(() => {
      clearInterval(timer);
      if (!document.hidden) status.textContent = "Ссылка истекла. Обновите страницу и запросите новую.";
    }, (login.expires_in || 600) * 1000);
  } catch (error) {
    link.remove();
    status.textContent = `Не удалось начать вход: ${error.message}`;
  }
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
  try {
    const me = await get("/api/profile/me");
    window.kov.me = me.user;
    pendingLoginGifts = me.login_gifts || [];
    // Админка спрятана: в нижнюю навигацию НЕ выводится. Вход — тройным нажатием
    // по иконке справа сверху на «Главной» (см. home.js).
    // Глобальный поллер мультиплеера: приглашения и сессии приходят без перезагрузки.
    if (window.kov.me) initMultiplayer();
  } catch (err) {
    // non-critical — admin button stays hidden
  }
  // Без подтверждённой личности Telegram приложение не запускаем (иначе доступ к чужому профилю).
  if (!window.kov.me) {
    await renderBrowserLogin();
    return;
  }
  let initial = "home";
  try {
    const saved = localStorage.getItem("kovcheg.tab");
    // The hidden admin screen is never restored without its explicit gesture.
    if (saved && saved !== "admin" && RENDERERS[saved]) initial = saved;
  } catch (_) {}
  try {
    await setTab(initial);
    showPendingLoginGifts(pendingLoginGifts);
  } catch (_) {
    // `ensureTabRendered` already left a retryable error inside this tab. Do
    // not replace #view: doing so would detach every cached container and make
    // subsequent navigation point to dead DOM nodes.
    const failed = containers[initial];
    if (failed) failed.style.display = "";
  }
})();
