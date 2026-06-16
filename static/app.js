import { renderHome } from "/static/pages/home.js?v=43";
import { renderProfile } from "/static/pages/profile.js?v=44";
import { renderKoverna } from "/static/pages/koverna.js?v=40";
import { renderArcade } from "/static/pages/arcade.js?v=43";
import { renderAdmin } from "/static/pages/admin.js?v=43";
import { renderBattlePass } from "/static/pages/battlepass.js?v=113";
import { initSettings, playUISound } from "/static/pages/settings.js?v=40";
import { get } from "/static/api.js?v=40";

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor("secondary_bg_color");
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

let currentTab = null;

// Tab change listeners for cleanup
const tabListeners = {};

function onTabChange(name, fn) {
  if (!tabListeners[name]) tabListeners[name] = [];
  tabListeners[name].push(fn);
}

function notifyTabHidden(name) {
  const list = tabListeners[name];
  if (list) list.forEach(function(fn) { fn(); });
}

let _switching = false;

async function setTab(name) {
  if (_switching) return;
  if (!RENDERERS[name]) name = "home";
  const btn = document.querySelector(`.tabbtn[data-tab="${name}"]`);
  if (btn && btn.hidden) name = "home";

  if (name === currentTab) return;

  _switching = true;
  const prevTab = currentTab;

  if (prevTab) notifyTabHidden(prevTab);

  currentTab = name;

  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));

  if (prevTab && containers[prevTab]) {
    containers[prevTab].style.display = "none";
  }

  const needsRender = !containers[name] || name === "admin";

  if (needsRender) {
    if (containers[name]) containers[name].remove();
    const div = document.createElement("div");
    div.className = "tab-content";
    div.style.display = "";
    viewEl.appendChild(div);
    containers[name] = div;
    div.innerHTML = '<div class="card"><p>Загрузка…</p></div>';
    try {
      await RENDERERS[name](div);
      _finishTabSwitch(name);
    } finally {
      // Keep the guard up for the whole async render; release only once done.
      _switching = false;
    }
  } else {
    const next = containers[name];
    next.style.display = "";
    next.classList.remove("tab-enter");
    void next.offsetWidth;
    next.classList.add("tab-enter");

    if (viewEl.scrollTo) viewEl.scrollTo({ top: 0 });
    localStorage.setItem("kovcheg.tab", name);
    _switching = false;
  }
}

// Separate finalization for tabs that need async render
function _finishTabSwitch(name) {
  if (currentTab !== name) return; // user switched away during render
  const next = containers[name];
  if (!next) return;
  next.style.display = "";
  requestAnimationFrame(() => {
    next.classList.remove("tab-enter");
    void next.offsetWidth;
    next.classList.add("tab-enter");
  });
  if (viewEl.scrollTo) viewEl.scrollTo({ top: 0 });
  localStorage.setItem("kovcheg.tab", name);
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    playUISound("click");
    setTab(btn.dataset.tab);
  });
});

// Global helpers — set early so renderers can use them
window.kov = {
  setTab,
  onTabChange,
  getTab() { return currentTab; },
  // Re-render a tab into its own container (not the shared #view), so a renderer
  // can refresh itself without clobbering the structure of other tabs.
  rerender(name) {
    const div = containers[name];
    if (div && RENDERERS[name]) return RENDERERS[name](div);
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
  showModal(html) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="modal-overlay" data-close="1"><div class="modal" role="dialog">${html}</div></div>`;
    const overlay = root.firstElementChild;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
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
  document.getElementById("modal-root").innerHTML = "";
};

(async () => {
  try {
    const me = await get("/api/profile/me");
    window.kov.me = me.user;
    if (me.user && me.user.is_admin && me.user.username === "omarbutuev") {
      document.querySelectorAll(".admin-only").forEach((el) => el.removeAttribute("hidden"));
    }
  } catch (err) {
    // non-critical — admin button stays hidden
  }
  const initial = localStorage.getItem("kovcheg.tab") || "home";
  try {
    await setTab(initial);
  } catch (e) {
    document.getElementById('view').innerHTML = '<div class="card"><p style="color:var(--danger);padding:20px">Не удалось загрузить приложение: ' + e.message + '</p></div>';
  }
  for (const name of Object.keys(RENDERERS)) {
    if (!containers[name]) {
      const div = document.createElement("div");
      div.className = "tab-content";
      div.style.display = "none";
      viewEl.appendChild(div);
      containers[name] = div;
      RENDERERS[name](div).catch(function() {});
    }
  }
})();
