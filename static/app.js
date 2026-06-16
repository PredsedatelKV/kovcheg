import { renderHome } from "/static/pages/home.js?v=26";
import { renderProfile } from "/static/pages/profile.js?v=26";
import { renderKoverna } from "/static/pages/koverna.js?v=26";
import { renderArcade } from "/static/pages/arcade.js?v=26";
import { renderAdmin } from "/static/pages/admin.js?v=26";
import { initSettings, playUISound } from "/static/pages/settings.js?v=26";
import { get } from "/static/api.js?v=26";

console.log("[KOVCHEG] App starting...");

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
  admin: renderAdmin,
};

const viewEl = document.getElementById("view");
const tabButtons = document.querySelectorAll(".tabbtn");
const containers = {};

let currentTab = null;

async function setTab(name) {
  if (!RENDERERS[name]) name = "home";
  const btn = document.querySelector(`.tabbtn[data-tab="${name}"]`);
  if (btn && btn.hidden) name = "home";

  if (name === currentTab) return;
  const prevTab = currentTab;
  currentTab = name;

  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));

  if (!containers[name]) {
    const div = document.createElement("div");
    div.className = "tab-content";
    div.style.display = "none";
    viewEl.appendChild(div);
    containers[name] = div;
    await RENDERERS[name](div);
  }

  if (prevTab && containers[prevTab]) {
    containers[prevTab].style.display = "none";
  }

  const next = containers[name];
  next.style.display = "";
  next.classList.remove("tab-enter");
  void next.offsetWidth;
  next.classList.add("tab-enter");

  if (viewEl.scrollTo) viewEl.scrollTo({ top: 0 });
  localStorage.setItem("kovcheg.tab", name);
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    playUISound("click");
    setTab(btn.dataset.tab);
  });
});

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
  await setTab(initial);
  for (const name of Object.keys(RENDERERS)) {
    if (!containers[name]) {
      const div = document.createElement("div");
      div.className = "tab-content";
      div.style.display = "none";
      viewEl.appendChild(div);
      containers[name] = div;
      RENDERERS[name](div).catch(() => {});
    }
  }
})();

// Global helpers
window.kov = {
  setTab,
  /** Container element backing a given tab (where its content is rendered). */
  container(name) {
    return containers[name] || null;
  },
  /** Re-render a tab into its own container (NOT into #view). */
  rerender(name) {
    const c = containers[name];
    if (c && RENDERERS[name]) return RENDERERS[name](c);
  },
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

window.closeModal = function () {
  document.getElementById("modal-root").innerHTML = "";
};
