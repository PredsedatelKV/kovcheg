import { get, post } from "../api.js";
import { escapeText } from "../ui.js";
import { customThumbnail, hasCustomModel, mountCustomScene } from "../games/custom-scene.js";
import { customChoice, openTreeStudio } from "./tree.js";
import { playUISound } from "./settings.js";

const SLOTS = ["head", "torso", "legs", "feet"];
const SLOT_NAMES = { head: "Голова", torso: "Одежда", legs: "Штаны", feet: "Обувь" };
const wardrobeStates = new WeakMap();

function personCodes(loadout) {
  return SLOTS.map(slot => {
    const code = loadout?.[slot];
    return code && hasCustomModel(code, true) ? code : `person_${slot === "head" ? "hair" : slot}_default`;
  });
}

function wardrobeState(profile) {
  let state = wardrobeStates.get(profile);
  if (state) return state;

  const pending = new Map();
  state = {
    revision: 0,
    update: () => {},
    current() {
      const loadout = { ...profile.skin_loadout };
      for (const [slot, { code }] of pending) loadout[slot] = code;
      return loadout;
    },
    choose(item) {
      const slot = item.skin_slot;
      const code = state.current()[slot] === item.code ? null : item.code;
      const saving = pending.size > 0;
      pending.set(slot, { code, id: item.id });
      state.revision += 1;
      state.update();
      if (!saving) void save();
    },
  };
  wardrobeStates.set(profile, state);
  return state;

  async function save() {
    // Serialize requests while keeping the newest preview for each slot.
    while (pending.size) {
      const [slot, choice] = pending.entries().next().value;
      try {
        const result = await post(choice.code ? "/api/profile/skins/equip" : "/api/profile/skins/unequip",
          choice.code ? { slot, item_id: choice.id } : { slot });
        profile.skin_inventory = result.skin_inventory;
        profile.skin_loadout = result.skin_loadout;
        window.kov.emit("skins:update", { loadout: result.skin_loadout });
      } catch (error) {
        window.kov.toast(error.message || "Не удалось сохранить одежду");
      }
      if (pending.get(slot) === choice) pending.delete(slot);
      state.revision += 1;
      state.update();
    }
  }
}

function studioHeader(title) {
  return `<header class="custom-studio-head">
    <h2>${escapeText(title)}</h2>
    <button type="button" class="close" aria-label="Закрыть" onclick="closeModal()">×</button>
  </header>`;
}

async function openCharacterStudio(profile, opener, updatePreview) {
  const state = wardrobeState(profile);
  const modal = window.kov.showModal(`
    ${studioHeader("Персонаж")}
    <div class="custom-stage-3d" tabindex="0" role="group" aria-label="Повернуть персонажа"></div>
    <div class="custom-wardrobe-list"></div>
  `, { opener, preserveScroll: true, label: "Персонаж" });
  modal.classList.add("custom-studio", "character-studio");
  const scene = mountCustomScene(modal.querySelector(".custom-stage-3d"), {
    base: "person", codes: personCodes(state.current()), interactive: true,
  });
  const list = modal.querySelector(".custom-wardrobe-list");

  function drawWardrobe() {
    const loadout = state.current();
    list.innerHTML = SLOTS.map(slot => {
      const owned = (profile.skin_inventory || []).filter(({ item }) => item.skin_slot === slot);
      if (!owned.length) return "";
      return `<section><h3>${SLOT_NAMES[slot]}</h3><div class="custom-decor-grid">${owned.map(({ item }) =>
        customChoice(item, loadout[slot] === item.code, "skin")
      ).join("")}</div></section>`;
    }).join("") || '<p class="empty">В примерочной пока нет предметов.</p>';
  }
  state.update = () => {
    const loadout = state.current();
    const codes = personCodes(loadout);
    updatePreview(codes);
    if (!modal.isConnected) return;
    scene.setDecorations(codes);
    const selected = new Set(SLOTS.map(slot => loadout[slot]));
    for (const button of list.querySelectorAll("[data-skin]")) {
      button.setAttribute("aria-pressed", String(selected.has(button.dataset.skin)));
    }
  };
  list.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-skin]");
    const row = profile.skin_inventory?.find(({ item }) => item.code === choice?.dataset.skin);
    if (!row) return;
    playUISound("click");
    state.choose(row.item);
  });
  drawWardrobe();

  // Refresh owned skins opened since the profile was first drawn.
  const revision = state.revision;
  try {
    const fresh = await get("/api/profile/me", { force: true });
    if (!modal.isConnected || state.revision !== revision) return;
    profile.skin_inventory = fresh.skin_inventory;
    profile.skin_loadout = fresh.skin_loadout;
    drawWardrobe();
    state.update();
  } catch (_) {}
}

export function skinRewardArt(item) {
  if (!SLOTS.includes(item.skin_slot) || !hasCustomModel(item.code)) return "";
  return `<img src="${customThumbnail(item.code)}" alt="" draggable="false">`;
}

export function mountCharacterCard(root, profile) {
  const mount = root.querySelector("#character-card");
  if (!mount) return;
  mount._customScenes?.forEach(scene => scene.dispose());
  mount.innerHTML = `
    <button type="button" class="custom-profile-card" data-open-custom="character">
      <span class="custom-profile-model" aria-hidden="true"></span>
      <strong>Персонаж</strong>
    </button>
    <button type="button" class="custom-profile-card" data-open-custom="tree">
      <span class="custom-profile-model" aria-hidden="true"></span>
      <strong>Ёлочка</strong>
    </button>`;
  const character = mount.querySelector('[data-open-custom="character"]');
  const tree = mount.querySelector('[data-open-custom="tree"]');
  const personView = mountCustomScene(character.firstElementChild, {
    base: "person", codes: personCodes(wardrobeState(profile).current()),
  });
  const treeView = mountCustomScene(tree.firstElementChild, { base: "tree", codes: profile.tree_loadout?.equipped || [] });
  mount._customScenes = [personView, treeView];

  character.addEventListener("click", () => {
    playUISound("click");
    void openCharacterStudio(profile, character, personView.setDecorations);
  });
  tree.addEventListener("click", () => {
    playUISound("click");
    openTreeStudio(profile, tree, treeView.setDecorations);
  });
}
