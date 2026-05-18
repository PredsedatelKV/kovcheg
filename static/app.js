import { renderHome } from "/static/pages/home.js";
import { renderProfile } from "/static/pages/profile.js";
import { renderKoverna } from "/static/pages/koverna.js";
import { renderArcade } from "/static/pages/arcade.js";
import { renderAdmin } from "/static/pages/admin.js";
import { initSettings } from "/static/pages/settings.js";
import { get } from "/static/api.js";

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor && tg.setHeaderColor("secondary_bg_color");
}

try {
  initSettings();
} catch (e) {
  console.error("Settings init failed:", e);
}

const TABS = {
  home: renderHome,
  profile: renderProfile,
  koverna: renderKoverna,
  arcade: renderArcade,
  admin: renderAdmin,
};

const viewEl = document.getElementById("view");
const tabButtons = document.querySelectorAll(".tabbtn");

function setTab(name) {
  console.log("setTab:", name);
  if (!TABS[name]) {
    console.error("Unknown tab:", name);
    name = "home";
  }
  if (typeof TABS[name] !== "function") {
    console.error("Tab not a function:", name, TABS[name]);
    viewEl.innerHTML = `<div class="card"><h3>Ошибка</h3><p>Вкладка "${name}" не загружается. Попробуй обновить страницу (Ctrl+F5).</p><button class="btn" onclick="location.reload()">Перезагрузить</button></div>`;
    return;
  }
  const btn = document.querySelector(`.tabbtn[data-tab="${name}"]`);
  if (btn && btn.hidden) name = "home";
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (viewEl.scrollTo) viewEl.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
  TABS[name](viewEl).catch((err) => {
    console.error("Tab render error:", name, err);
    viewEl.innerHTML = `<div class="card"><h3>Ошибка загрузки вкладки</h3><p>${err.message}</p><button class="btn" onclick="location.reload()">Перезагрузить</button></div>`;
  });
  localStorage.setItem("kovcheg.tab", name);
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

// Pre-fetch /me to figure out admin status; show or hide the Admin tab accordingly.
(async () => {
  try {
    const me = await get("/api/profile/me");
    window.kov && (window.kov.me = me.user);
    if (me.user && me.user.is_admin) {
      document.querySelectorAll(".admin-only").forEach((el) => el.removeAttribute("hidden"));
    }
  } catch (err) {
    console.warn("Failed to fetch /me for admin gate", err);
  }
  const initial = localStorage.getItem("kovcheg.tab") || "home";
  setTab(initial);
})();

// Global helpers
window.kov = {
  setTab,
  toast(msg) {
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

window.closeModal = function () {
  document.getElementById("modal-root").innerHTML = "";
};
