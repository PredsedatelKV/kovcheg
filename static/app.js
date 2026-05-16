import { renderHome } from "/static/pages/home.js";
import { renderProfile } from "/static/pages/profile.js";
import { renderKoverna } from "/static/pages/koverna.js";

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // Apply Telegram theme colors lightly — keep our brand though
  tg.setHeaderColor?.("secondary_bg_color");
}

const TABS = {
  home: renderHome,
  profile: renderProfile,
  koverna: renderKoverna,
};

const viewEl = document.getElementById("view");
const tabButtons = document.querySelectorAll(".tabbtn");

function setTab(name) {
  if (!TABS[name]) name = "home";
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  viewEl.scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0 });
  TABS[name](viewEl).catch((err) => {
    viewEl.innerHTML = `<div class="card"><h3>Ошибка</h3><p>${err.message}</p><button class="btn" onclick="location.reload()">Перезагрузить</button></div>`;
    console.error(err);
  });
  localStorage.setItem("kovcheg.tab", name);
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

const initial = localStorage.getItem("kovcheg.tab") || "home";
setTab(initial);

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
