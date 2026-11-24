import { get, post } from "../api.js";
import { escapeText } from "../ui.js";
import { customThumbnail, hasCustomModel, mountCustomScene } from "../games/custom-scene.js";
import { customChoice, openTreeStudio } from "./tree.js";
import { playUISound } from "./settings.js";

const SLOTS = ["head", "torso", "legs", "feet"];
const SLOT_NAMES = { head: "Голова", torso: "Одежда", legs: "Штаны", feet: "Обувь" };

function personCodes(loadout) {
  const chosen = SLOTS.map(slot => loadout?.[slot]).filter(Boolean);
  if (!loadout?.head) chosen.push("person_hair_default");
  return chosen;
}

function studioHeader(title) {
  return `<header class="custom-studio-head">
    <h2>${escapeText(title)}</h2>
    <button type="button" class="close" aria-label="Закрыть" onclick="closeModal()">×</button>
  </header>`;
}

async function openCharacterStudio(profile, opener, updatePreview) {
  let loadout = profile.skin_loadout || {};
  let inventory = profile.skin_inventory || [];
  const modal = window.kov.showModal(`
    ${studioHeader("Персонаж")}
    <div class="custom-stage-3d" tabindex="0" role="group" aria-label="Повернуть персонажа"></div>
    <div class="custom-wardrobe-list"></div>
  `, { opener, preserveScroll: true, label: "Персонаж" });
  modal.classList.add("custom-studio", "character-studio");
  const scene = mountCustomScene(modal.querySelector(".custom-stage-3d"), {
    base: "person", codes: personCodes(loadout), interactive: true,
  });
  const list = modal.querySelector(".custom-wardrobe-list");
  let busy = false;

  function draw() {
    list.innerHTML = SLOTS.map(slot => {
      const owned = inventory.filter(({ item }) => item.skin_slot === slot);
      if (!owned.length) return "";
      return `<section><h3>${SLOT_NAMES[slot]}</h3><div class="custom-decor-grid">${owned.map(({ item }) =>
        customChoice(item, loadout[slot] === item.code, "skin")
      ).join("")}</div></section>`;
    }).join("") || '<p class="empty">В примерочной пока нет предметов.</p>';
    scene.setDecorations(personCodes(loadout));
    updatePreview(personCodes(loadout));
  }
  list.addEventListener("click", async (event) => {
    const choice = event.target.closest("[data-skin]");
    const row = inventory.find(({ item }) => item.code === choice?.dataset.skin);
    if (busy || !row) return;
    const { item } = row;
    const slot = item.skin_slot;
    busy = true;
    choice.disabled = true;
    playUISound("click");
    try {
      const active = loadout[slot] === item.code;
      const result = await post(active ? "/api/profile/skins/unequip" : "/api/profile/skins/equip",
        active ? { slot } : { slot, item_id: item.id });
      inventory = profile.skin_inventory = result.skin_inventory;
      loadout = profile.skin_loadout = result.skin_loadout;
      window.kov.emit("skins:update", { loadout });
      if (modal.isConnected) draw();
    } catch (error) {
      choice.disabled = false;
      window.kov.toast(error.message || "Не удалось сменить одежду");
    } finally {
      busy = false;
    }
  });
  draw();

  // Refresh owned skins opened since the profile was first drawn.
  try {
    const fresh = await get("/api/profile/me", { force: true });
    if (!modal.isConnected || busy) return;
    inventory = profile.skin_inventory = fresh.skin_inventory;
    loadout = profile.skin_loadout = fresh.skin_loadout;
    draw();
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
  const personView = mountCustomScene(character.firstElementChild, { base: "person", codes: personCodes(profile.skin_loadout) });
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
