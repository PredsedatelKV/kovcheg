import { post } from "../api.js";
import { escapeText } from "../ui.js";
import { customThumbnail, hasCustomModel, mountCustomScene } from "../games/custom-scene.js";
import { playUISound } from "./settings.js";

const rarityClasses = { "Обычный": "common", "Редкий": "rare", "Эпический": "epic", "Легендарный": "legendary" };

export function customChoice(item, pressed, action) {
  return `<button class="custom-choice" type="button" data-${action}="${escapeText(item.code)}"
      aria-pressed="${pressed}" data-rarity="${rarityClasses[item.rarity] || "common"}">
    <img src="${hasCustomModel(item.code) ? customThumbnail(item.code) : escapeText(item.icon || "/static/img/ui/box.svg")}" alt="" draggable="false">
    <span class="custom-choice-name">${escapeText(item.name)}</span>
    <small>${escapeText(item.rarity || "Обычный")}</small>
  </button>`;
}

const studioStates = new WeakMap();

function studioState(profile) {
  if (!studioStates.has(profile)) {
    studioStates.set(profile, {
      confirmed: new Set(profile.tree_loadout?.equipped || []),
      pending: new Map(),
      sending: false,
      observers: new Set(),
    });
  }
  return studioStates.get(profile);
}

export function openTreeStudio(profile, opener, updatePreview) {
  const state = studioState(profile);
  const { pending, observers } = state;
  const catalog = profile.tree_catalog || [];
  const modal = window.kov.showModal(`
    <header class="custom-studio-head">
      <h2>Ёлочка</h2>
      <button type="button" class="close" aria-label="Закрыть" onclick="closeModal()">×</button>
    </header>
    <div class="custom-stage-3d" tabindex="0" role="group" aria-label="Повернуть ёлку"></div>
    <div class="custom-decor-grid" role="group" aria-label="Украшения">
      ${catalog.map(item => customChoice(item, state.confirmed.has(item.code), "decoration")).join("")}
    </div>
  `, { opener, preserveScroll: true, label: "Ёлочка" });
  modal.classList.add("custom-studio", "tree-studio");
  const scene = mountCustomScene(modal.querySelector(".custom-stage-3d"), {
    base: "tree", codes: [...state.confirmed], interactive: true,
  });
  const choices = [...modal.querySelectorAll("[data-decoration]")];

  function refresh() {
    const shown = new Set(state.confirmed);
    for (const [code, equipped] of pending) {
      if (equipped) shown.add(code);
      else shown.delete(code);
    }
    for (const update of observers) update([...shown]);
    updatePreview([...shown]);
  }

  async function save() {
    if (state.sending) return;
    state.sending = true;
    try {
      while (pending.size) {
        const [code, equipped] = pending.entries().next().value;
        try {
          const result = await post("/api/profile/tree/decorations", { code, equipped });
          state.confirmed = new Set(result.equipped);
          profile.tree_loadout = result;
        } catch (error) {
          window.kov.toast(error.message || "Не удалось сохранить украшение");
        }
        if (pending.get(code) === equipped) pending.delete(code);
        refresh();
      }
    } finally {
      state.sending = false;
    }
  }

  const update = (shown) => {
    if (!modal.isConnected) {
      observers.delete(update);
      return;
    }
    const current = new Set(shown);
    for (const button of choices) button.setAttribute("aria-pressed", String(current.has(button.dataset.decoration)));
    scene.setDecorations(shown);
  };
  observers.add(update);
  refresh();
  modal.addEventListener("click", (event) => {
    const button = event.target.closest("[data-decoration]");
    if (!button) return;
    const code = button.dataset.decoration;
    const equipped = button.getAttribute("aria-pressed") !== "true";
    pending.set(code, equipped);
    playUISound("click");
    refresh();
    void save();
  });
}
