// Персонаж в стиле Minecraft-скина и примерочная.
//
// Персонаж рисуется SVG в сетке 16×32 с shape-rendering="crispEdges" — тот же
// приём, что в static/img/villager.svg. Скин задаётся ФОРМОЙ + ПАЛИТРОЙ, а не
// отдельной картинкой: так новый скин добавляется одной строкой данных, а не
// новым ассетом, и все скины гарантированно совпадают по пропорциям.
//
// Каноничные пропорции Minecraft в этой сетке:
//   голова  (4,0)  8×8
//   руки    (0,8)  и (12,8)  4×12
//   торс    (4,8)  8×12
//   ноги    (4,20) 8×12
import { get, post } from "/static/api.js?v=270";
import { playUISound } from "/static/pages/settings.js?v=274";

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const SKIN_SLOTS = ["head", "torso", "legs", "feet"];

export const SLOT_LABELS = {
  head: "Голова",
  torso: "Торс",
  legs: "Штаны",
  feet: "Ноги",
};

// Базовое тело: кожа, шорты и лицо. Персонаж без скинов выглядит именно так.
const SKIN_TONE = "#c98d63";
const SKIN_SHADE = "#b07a54";
const SHORTS = "#3f4d66";

const BODY = [
  // голова
  { x: 4, y: 0, w: 8, h: 8, fill: SKIN_TONE },
  { x: 4, y: 0, w: 8, h: 1, fill: SKIN_SHADE },
  // глаза и рот
  { x: 5, y: 3, w: 2, h: 1, fill: "#ffffff" },
  { x: 6, y: 3, w: 1, h: 1, fill: "#2f4b7c" },
  { x: 9, y: 3, w: 2, h: 1, fill: "#ffffff" },
  { x: 9, y: 3, w: 1, h: 1, fill: "#2f4b7c" },
  { x: 6, y: 5, w: 4, h: 1, fill: SKIN_SHADE },
  // торс и руки
  { x: 4, y: 8, w: 8, h: 12, fill: SKIN_TONE },
  { x: 0, y: 8, w: 4, h: 12, fill: SKIN_TONE },
  { x: 12, y: 8, w: 4, h: 12, fill: SKIN_TONE },
  // шорты — единственная одежда по умолчанию
  { x: 4, y: 20, w: 8, h: 5, fill: SHORTS },
  { x: 4, y: 20, w: 8, h: 1, fill: "#33405a" },
  // ноги
  { x: 4, y: 25, w: 3, h: 7, fill: SKIN_TONE },
  { x: 9, y: 25, w: 3, h: 7, fill: SKIN_TONE },
];

// Формы скинов. Каждая — функция палитры, чтобы одна форма давала разные скины.
const SHAPES = {
  hair: (c) => [
    { x: 4, y: 0, w: 8, h: 3, fill: c.main },
    { x: 4, y: 3, w: 1, h: 2, fill: c.main },
    { x: 11, y: 3, w: 1, h: 2, fill: c.main },
    { x: 4, y: 0, w: 8, h: 1, fill: c.light },
  ],
  ushanka: (c) => [
    { x: 4, y: 0, w: 8, h: 3, fill: c.main },
    { x: 3, y: 1, w: 1, h: 5, fill: c.light },
    { x: 12, y: 1, w: 1, h: 5, fill: c.light },
    { x: 4, y: 0, w: 8, h: 1, fill: c.light },
    { x: 7, y: 1, w: 2, h: 1, fill: c.accent },
  ],
  helmet: (c) => [
    { x: 4, y: 0, w: 8, h: 3, fill: c.main },
    { x: 3, y: 1, w: 1, h: 5, fill: c.main },
    { x: 12, y: 1, w: 1, h: 5, fill: c.main },
    // Нащёчники прижаты к краям, иначе закрывают глаза.
    { x: 4, y: 3, w: 1, h: 3, fill: c.main },
    { x: 11, y: 3, w: 1, h: 3, fill: c.main },
    { x: 4, y: 0, w: 8, h: 1, fill: c.light },
    { x: 7, y: 0, w: 2, h: 3, fill: c.accent },
  ],
  crown: (c) => [
    { x: 4, y: 2, w: 8, h: 1, fill: c.main },
    { x: 4, y: 0, w: 2, h: 2, fill: c.main },
    { x: 7, y: 0, w: 2, h: 2, fill: c.main },
    { x: 10, y: 0, w: 2, h: 2, fill: c.main },
    { x: 4, y: 1, w: 8, h: 1, fill: c.light },
    { x: 7, y: 1, w: 2, h: 1, fill: c.accent },
  ],
  shirt: (c) => [
    { x: 4, y: 8, w: 8, h: 9, fill: c.main },
    { x: 0, y: 8, w: 4, h: 4, fill: c.main },
    { x: 12, y: 8, w: 4, h: 4, fill: c.main },
    { x: 4, y: 8, w: 8, h: 1, fill: c.light },
  ],
  telnyashka: (c) => [
    { x: 4, y: 8, w: 8, h: 9, fill: c.main },
    { x: 0, y: 8, w: 4, h: 9, fill: c.main },
    { x: 12, y: 8, w: 4, h: 9, fill: c.main },
    { x: 4, y: 10, w: 8, h: 1, fill: c.accent },
    { x: 4, y: 12, w: 8, h: 1, fill: c.accent },
    { x: 4, y: 14, w: 8, h: 1, fill: c.accent },
    { x: 4, y: 16, w: 8, h: 1, fill: c.accent },
  ],
  armor: (c) => [
    { x: 4, y: 8, w: 8, h: 11, fill: c.main },
    { x: 0, y: 8, w: 4, h: 7, fill: c.main },
    { x: 12, y: 8, w: 4, h: 7, fill: c.main },
    { x: 4, y: 8, w: 8, h: 1, fill: c.light },
    { x: 6, y: 11, w: 4, h: 4, fill: c.accent },
    { x: 4, y: 18, w: 8, h: 1, fill: c.dark || c.accent },
  ],
  robe: (c) => [
    { x: 4, y: 8, w: 8, h: 12, fill: c.main },
    { x: 0, y: 8, w: 4, h: 11, fill: c.main },
    { x: 12, y: 8, w: 4, h: 11, fill: c.main },
    { x: 4, y: 8, w: 8, h: 1, fill: c.light },
    { x: 7, y: 9, w: 2, h: 8, fill: c.accent },
    { x: 4, y: 19, w: 8, h: 1, fill: c.accent },
  ],
  pants: (c) => [
    { x: 4, y: 17, w: 8, h: 8, fill: c.main },
    { x: 4, y: 25, w: 3, h: 4, fill: c.main },
    { x: 9, y: 25, w: 3, h: 4, fill: c.main },
    { x: 4, y: 17, w: 8, h: 1, fill: c.light },
  ],
  padded: (c) => [
    { x: 4, y: 17, w: 8, h: 8, fill: c.main },
    { x: 4, y: 25, w: 3, h: 5, fill: c.main },
    { x: 9, y: 25, w: 3, h: 5, fill: c.main },
    { x: 4, y: 20, w: 8, h: 1, fill: c.accent },
    { x: 4, y: 23, w: 8, h: 1, fill: c.accent },
    { x: 4, y: 26, w: 8, h: 1, fill: c.accent },
  ],
  greaves: (c) => [
    { x: 4, y: 17, w: 8, h: 8, fill: c.main },
    { x: 4, y: 25, w: 3, h: 5, fill: c.main },
    { x: 9, y: 25, w: 3, h: 5, fill: c.main },
    { x: 4, y: 17, w: 8, h: 1, fill: c.light },
    { x: 5, y: 20, w: 2, h: 3, fill: c.accent },
    { x: 9, y: 20, w: 2, h: 3, fill: c.accent },
  ],
  shoes: (c) => [
    { x: 4, y: 29, w: 3, h: 3, fill: c.main },
    { x: 9, y: 29, w: 3, h: 3, fill: c.main },
    { x: 4, y: 29, w: 3, h: 1, fill: c.light },
    { x: 9, y: 29, w: 3, h: 1, fill: c.light },
  ],
  boots: (c) => [
    { x: 4, y: 27, w: 3, h: 5, fill: c.main },
    { x: 9, y: 27, w: 3, h: 5, fill: c.main },
    { x: 4, y: 27, w: 3, h: 1, fill: c.light },
    { x: 9, y: 27, w: 3, h: 1, fill: c.light },
    { x: 4, y: 31, w: 3, h: 1, fill: c.accent },
    { x: 9, y: 31, w: 3, h: 1, fill: c.accent },
  ],
};

// Реестр скинов: code совпадает с Item.code на сервере.
export const SKINS = {
  // --- голова ---
  skin_head_hair: { slot: "head", shape: "hair", palette: { main: "#5a3a22", light: "#6f4a2c" } },
  skin_head_ushanka: { slot: "head", shape: "ushanka", palette: { main: "#6d4c41", light: "#8d6e63", accent: "#c62828" } },
  skin_head_iron_helm: { slot: "head", shape: "helmet", palette: { main: "#9aa3b2", light: "#c3cad6", accent: "#6e7787" } },
  skin_head_crown: { slot: "head", shape: "crown", palette: { main: "#ffd54a", light: "#fff2a8", accent: "#e53935" } },
  // --- торс ---
  skin_torso_tshirt: { slot: "torso", shape: "shirt", palette: { main: "#4a90d9", light: "#63a4e6" } },
  skin_torso_telnyashka: { slot: "torso", shape: "telnyashka", palette: { main: "#f2f5fb", light: "#ffffff", accent: "#2f6fd0" } },
  skin_torso_chainmail: { slot: "torso", shape: "armor", palette: { main: "#8e97a6", light: "#b6bfcd", accent: "#69727f", dark: "#5a626e" } },
  skin_torso_mantle: { slot: "torso", shape: "robe", palette: { main: "#6b2fb5", light: "#8a4fd4", accent: "#ffd54a" } },
  // --- штаны ---
  skin_legs_jeans: { slot: "legs", shape: "pants", palette: { main: "#38537a", light: "#456394" } },
  skin_legs_vatniki: { slot: "legs", shape: "padded", palette: { main: "#5b6b3f", light: "#6d7f4c", accent: "#4a5733" } },
  skin_legs_plates: { slot: "legs", shape: "greaves", palette: { main: "#8e97a6", light: "#b6bfcd", accent: "#69727f" } },
  skin_legs_parade: { slot: "legs", shape: "pants", palette: { main: "#1f2a44", light: "#2c3a5c", accent: "#ffd54a" } },
  // --- ноги ---
  skin_feet_sneakers: { slot: "feet", shape: "shoes", palette: { main: "#e0e4ec", light: "#ffffff" } },
  skin_feet_sapogi: { slot: "feet", shape: "boots", palette: { main: "#3e2b20", light: "#54392a", accent: "#241a13" } },
  skin_feet_bercy: { slot: "feet", shape: "boots", palette: { main: "#2b2f36", light: "#3c424c", accent: "#171a1f" } },
  skin_feet_golden: { slot: "feet", shape: "boots", palette: { main: "#ffd54a", light: "#fff2a8", accent: "#c79a12" } },
};

// Слои рисуются снизу вверх, чтобы одежда корпуса перекрывала штаны на поясе.
const LAYER_ORDER = ["feet", "legs", "torso", "head"];

function rectsFor(code) {
  const skin = SKINS[code];
  if (!skin) return [];
  const shape = SHAPES[skin.shape];
  return shape ? shape(skin.palette) : [];
}

/** SVG персонажа в текущем комплекте. loadout — {head, torso, legs, feet} с кодами. */
export function renderCharacterSVG(loadout = {}, options = {}) {
  const rects = [...BODY];
  for (const slot of LAYER_ORDER) {
    const code = loadout && loadout[slot];
    if (code) rects.push(...rectsFor(code));
  }
  const body = rects
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`)
    .join("");
  const cls = options.className ? ` ${options.className}` : "";
  return `<svg class="character-svg${cls}" viewBox="0 0 16 32" shape-rendering="crispEdges"
    role="img" aria-label="Персонаж">${body}</svg>`;
}

/** Превью одного скина: тело приглушено, сам скин в цвете. */
function skinPreviewSVG(code) {
  const ghost = BODY.map(
    (r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}" opacity="0.18"/>`,
  ).join("");
  const skin = rectsFor(code)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`)
    .join("");
  return `<svg class="character-svg" viewBox="0 0 16 32" shape-rendering="crispEdges"
    aria-hidden="true">${ghost}${skin}</svg>`;
}

function rarityClass(rarity) {
  return `rr-${String(rarity || "Обычный")}`;
}

/** Примерочная: персонаж и принадлежащие игроку вещи по слотам. */
export async function openWardrobe(options = {}) {
  let profile;
  try {
    profile = await get("/api/profile/me", { force: true });
  } catch (error) {
    window.kov.toast(error.message || "Не удалось загрузить примерочную");
    return;
  }

  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2 class="wardrobe-title">Примерочная</h2>
    <div class="wardrobe">
      <div class="wardrobe-figure" id="wardrobe-figure"></div>
      <div class="wardrobe-slots" id="wardrobe-slots"></div>
    </div>
  `);

  const figureEl = modal.querySelector("#wardrobe-figure");
  const slotsEl = modal.querySelector("#wardrobe-slots");
  let loadout = profile.skin_loadout || {};
  let inventory = profile.skin_inventory || (profile.inventory || []).filter((row) => row.item?.skin_slot);

  function ownedFor(slot) {
    return inventory.filter((row) => row.item && row.item.skin_slot === slot && row.quantity > 0);
  }

  function draw() {
    figureEl.innerHTML = renderCharacterSVG(loadout);
    slotsEl.innerHTML = SKIN_SLOTS.map((slot) => {
      const owned = ownedFor(slot);
      const cells = owned.length
        ? owned
            .map((row) => {
              const active = loadout[slot] === row.item.code;
              return `
                <div class="wardrobe-skin-card">
                  <button class="wardrobe-skin ${rarityClass(row.item.rarity)}${active ? " is-on" : ""}"
                          type="button" data-slot="${slot}" data-item-id="${row.item.id}"
                          data-active="${active ? "1" : "0"}" title="${escapeHtml(row.item.name)}">
                    ${skinPreviewSVG(row.item.code)}
                    <span class="wardrobe-skin-name">${escapeHtml(row.item.name)}</span>
                  </button>
                  <div class="wardrobe-skin-actions">
                    <button type="button" class="wardrobe-item-action" data-skin-action="gift" data-item-id="${row.item.id}">Подарить</button>
                    <button type="button" class="wardrobe-item-action" data-skin-action="sell" data-item-id="${row.item.id}">Продать</button>
                  </div>
                </div>`;
            })
            .join("")
        : `<div class="wardrobe-empty">Скинов пока нет</div>`;
      return `
        <div class="wardrobe-slot">
          <div class="wardrobe-slot-head">${SLOT_LABELS[slot]}</div>
          <div class="wardrobe-skin-row">${cells}</div>
        </div>`;
    }).join("");
  }

  async function apply(button) {
    if (button.disabled) return;
    const slot = button.dataset.slot;
    const wasActive = button.dataset.active === "1";
    button.disabled = true;
    try {
      // Повторный клик по надетому скину снимает его.
      const fresh = wasActive
        ? await post("/api/profile/skins/unequip", { slot })
        : await post("/api/profile/skins/equip", { slot, item_id: Number(button.dataset.itemId) });
      loadout = fresh.skin_loadout || {};
      inventory = fresh.skin_inventory || inventory;
      playUISound("click");
      draw();
      window.kov.emit && window.kov.emit("skins:update", { loadout });
    } catch (error) {
      button.disabled = false;
      window.kov.toast(error.message || "Не удалось сменить скин");
    }
  }

  slotsEl.addEventListener("click", (event) => {
    const action = event.target.closest(".wardrobe-item-action");
    if (action) {
      const row = inventory.find((entry) => entry.item.id === Number(action.dataset.itemId));
      const callback = action.dataset.skinAction === "gift" ? options.onGift : options.onSell;
      if (row && typeof callback === "function") {
        window.closeModal();
        setTimeout(() => callback(row), 80);
      }
      return;
    }
    const button = event.target.closest(".wardrobe-skin");
    if (button) apply(button);
  });

  draw();
  return modal;
}

/** Компактная карточка персонажа в Профиле. */
export async function mountCharacterCard(root, options = {}) {
  const mount = root.querySelector("#character-card");
  if (!mount) return;

  let loadout = {};
  try {
    loadout = (await get("/api/profile/skins")) || {};
  } catch (_) {
    // Персонаж рисуется и без комплекта — в базовом виде.
  }

  const worn = SKIN_SLOTS.filter((slot) => loadout[slot]).length;
  mount.innerHTML = `
    <div class="card character-card" role="button" tabindex="0">
      <div class="character-figure">${renderCharacterSVG(loadout)}</div>
      <div class="character-body">
        <div class="character-title">Персонаж</div>
        <div class="character-sub">${worn ? `Надето ${worn} из 4` : "Без скинов"}</div>
      </div>
    </div>`;

  const card = mount.querySelector(".character-card");
  const open = () => { playUISound("click"); openWardrobe(options); };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  // Комплект мог смениться в примерочной — перерисовываем фигуру на месте.
  if (window.kov && window.kov.on) {
    if (typeof mount._skinUnsubscribe === "function") mount._skinUnsubscribe();
    mount._skinUnsubscribe = window.kov.on("skins:update", (data) => {
      const figure = mount.querySelector(".character-figure");
      if (!figure || !data) return;
      figure.innerHTML = renderCharacterSVG(data.loadout || {});
      const sub = mount.querySelector(".character-sub");
      const count = SKIN_SLOTS.filter((slot) => (data.loadout || {})[slot]).length;
      if (sub) sub.textContent = count ? `Надето ${count} из 4` : "Без скинов";
    });
  }
}
