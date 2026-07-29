import { get, post, iconHtml, productImg } from "/static/api.js?v=279";

import { playUISound } from "/static/pages/settings.js?v=274";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = {
  mode: "shop", // shop | market
  category: "all",
  categories: [],
  shopProducts: [],
  marketListings: [],
};
const shopLoadVersions = new WeakMap();
const marketLoadVersions = new WeakMap();
const KOVBOX_SHOWCASE = [
  { code: "lootbox_common", name: "Обычный ковбокс", icon: "/static/img/items/lootbox_common.png?v=263" },
  { code: "lootbox_rare", name: "Редкий ковбокс", icon: "/static/img/items/lootbox_rare.png?v=263" },
  { code: "lootbox_epic", name: "Эпический ковбокс", icon: "/static/img/items/lootbox_epic.png?v=263" },
  { code: "lootbox_legendary", name: "Легендарный ковбокс", icon: "/static/img/items/lootbox_legendary.png?v=263" },
  { code: "lootbox_seasonal", name: "Сезонный ковбокс", icon: "/static/img/items/lootbox_seasonal.png", oldPrice: 59 },
  { code: "lootbox_mega", name: "Мегаковбокс с выбором предметов", icon: "/static/img/items/lootbox_mega.png" },
];

function renderKovboxShowcase(products = []) {
  const productByCode = new Map(products.map((product) => [product.item.code, product]));
  return `
    <section class="kovbox-shop-card" aria-labelledby="kovbox-shop-title">
      <h2 id="kovbox-shop-title">Ковбоксы</h2>
      <div class="kovbox-shop-grid">
        ${KOVBOX_SHOWCASE.map((box) => {
          const product = productByCode.get(box.code);
          return `
            <div class="kovbox-shop-item kovbox-${box.code}${product?.stock === 0 ? " product-out" : ""}">
              <img src="${box.icon}" alt="${box.name}" draggable="false" decoding="async">
              <div class="kovbox-shop-name">${box.name}</div>
              ${product ? `
                <div class="kovbox-shop-price">
                  ${iconHtml("/static/img/ui/kovbaks.png", "sm", "")}
                  ${box.oldPrice ? `<span class="kovbox-shop-old-price">${box.oldPrice}</span>` : ""}
                  <span>${product.price}</span>${product.stock === -1 ? "" : `<span>· ${product.stock} шт.</span>`}
                </div>
                <button class="btn btn-sm" data-buy="${product.id}" ${product.stock === 0 ? "disabled" : ""}>${product.stock === 0 ? "Нет" : "Купить"}</button>
              ` : ""}
            </div>`;
        }).join("")}
      </div>
    </section>`;
}

function availableCategories() {
  return (state.categories || []).filter(
    (category) => !["Ковбоксы", "Фрагменты"].includes(category.name),
  );
}

function renderCategoryFilters(root) {
  const mount = root.querySelector("#category-filters");
  if (!mount) return;
  const categories = availableCategories();
  if (state.category !== "all" && !categories.some((category) => category.name === state.category)) {
    state.category = "all";
  }
  mount.innerHTML = `
    <div class="chips-row koverna-category-filter" aria-label="Категории предметов">
      <button class="pill ${state.category === "all" ? "active" : ""}" data-category="all">Все</button>
      ${categories.map((category) => `<button class="pill ${state.category === category.name ? "active" : ""}" data-category="${escapeHtml(category.name)}">${escapeHtml(category.name)}</button>`).join("")}
    </div>`;
}

function paintShop(root) {
  const content = root.querySelector("#content");
  if (!content) return;
  const kovboxCodes = new Set(KOVBOX_SHOWCASE.map((box) => box.code));
  const products = state.shopProducts
    .filter((product) => !kovboxCodes.has(product.item.code))
    .filter((product) => state.category === "all" || product.item.category === state.category);
  content.innerHTML = products.length === 0
    ? `<div class="empty">В этой категории пока нет товаров</div>`
    : `<div class="product-grid shop-other-products">${products.map((p) => `
        <div class="product${p.stock === 0 ? " product-out" : ""}">
          ${productImg(p.item, "xl")}
          <div class="name">${escapeHtml(p.item.name)}</div>
          <div class="price">${iconHtml("/static/img/ui/kovbaks.png", "sm", "")} ${p.price} ${p.stock === -1 ? "" : `×${p.stock}`}</div>
          <button class="btn btn-sm" data-buy="${p.id}" ${p.stock === 0 ? "disabled" : ""}>${p.stock === 0 ? "Нет" : "Купить"}</button>
        </div>`).join("")}</div>`;
}

function paintMarket(root) {
  const content = root.querySelector("#content");
  if (!content) return;
  const listings = state.marketListings.filter(
    (listing) => state.category === "all" || listing.item.category === state.category,
  );
  content.innerHTML = listings.length === 0
    ? `<div class="empty">${state.marketListings.length ? "В этой категории пока нет объявлений" : "На рынке пока ничего — выставь товар, чтобы начать!"}</div>`
    : `<div class="product-grid">${listings.map((l) => `
        <div class="product${l.target_user_id ? " product-targeted" : ""}">
          ${l.target_user_id ? `<span class="targeted-badge">Только тебе</span>` : ""}
          ${productImg(l.item, "xl")}
          <div class="name">${escapeHtml(l.item.name)}</div>
          <div class="card-sub">от ${escapeHtml(l.seller_name)} · ×${l.quantity}</div>
          <div class="price" style="margin-top:6px">${iconHtml("/static/img/ui/kovbaks.png", "sm", "")} ${l.price}</div>
          <button class="btn btn-sm" data-buy-listing="${l.id}">Купить</button>
        </div>`).join("")}</div>`;
}

export async function renderKoverna(root) {
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Коверна</h1>
        <div class="subtitle" id="koverna-subtitle" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.mode === "shop" ? "Товары Ковчега с доставкой в инвентарь" : "Покупайте предметы у других граждан"}</div>
      </div>
      <div class="hero-art"><img src="/static/img/koverna_hero.svg" alt="Коверна" class="hero-img"/></div>
    </section>

    <div id="kovbox-showcase">${renderKovboxShowcase()}</div>

    <div class="card koverna-mode-card">
      <div class="toggle" id="mode-toggle">
        <button data-mode="shop" class="${state.mode === "shop" ? "active" : ""}">Магазин</button>
        <button data-mode="market" class="${state.mode === "market" ? "active" : ""}">Рынок</button>
      </div>
    </div>

    <div id="category-filters"></div>
    <div id="market-tools"></div>
    <div id="content"></div>
  `;

  if (root._kovernaClickHandler) root.removeEventListener("click", root._kovernaClickHandler);
  root._kovernaClickHandler = async (event) => {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) {
      if (state.mode === modeButton.dataset.mode) return;
      state.mode = modeButton.dataset.mode;
      state.category = "all";
      root.querySelectorAll("#mode-toggle button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
      const subtitle = root.querySelector("#koverna-subtitle");
      if (subtitle) subtitle.textContent = state.mode === "shop"
        ? "Товары Ковчега с доставкой в инвентарь"
        : "Покупайте предметы у других граждан";
      if (state.mode === "shop") await renderShop(root, true);
      else await renderMarket(root, true);
      return;
    }
    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      state.category = categoryButton.dataset.category;
      renderCategoryFilters(root);
      if (state.mode === "shop") paintShop(root);
      else paintMarket(root);
      return;
    }
    const buyButton = event.target.closest("[data-buy]");
    if (buyButton && !buyButton.disabled) {
      buyButton.disabled = true;
      try {
        const buyResult = await post("/api/shop/buy", { product_id: Number(buyButton.dataset.buy) });
        playUISound("win");
        window.kov.toast("Куплено! Предмет в инвентаре");
        if (buyResult?.balance != null && window.kov?.me) {
          window.kov.me.balance = buyResult.balance;
          window.kov.emit?.("balance:update", { balance: buyResult.balance });
        }
        await renderShop(root, true);
      } catch (error) {
        buyButton.disabled = false;
        window.kov.toast(error.message);
      }
      return;
    }
    const restockButton = event.target.closest("[data-restock-request]");
    if (restockButton && !restockButton.disabled) {
      openRestockRequestDialog(root);
      return;
    }
    const listingButton = event.target.closest("[data-buy-listing]");
    if (listingButton && !listingButton.disabled) {
      listingButton.disabled = true;
      try {
        const buyResult = await post("/api/market/buy", { listing_id: Number(listingButton.dataset.buyListing) });
        window.kov.toast("Куплено! Предмет в инвентаре");
        if (buyResult?.balance != null && window.kov?.me) {
          window.kov.me.balance = buyResult.balance;
          window.kov.emit?.("balance:update", { balance: buyResult.balance });
        }
        await renderMarket(root, true);
      } catch (error) {
        listingButton.disabled = false;
        window.kov.toast(error.message);
      }
    }
  };
  root.addEventListener("click", root._kovernaClickHandler);

  try {
    const [products, categories] = await Promise.all([
      get("/api/shop/products", { force: true }),
      get("/api/shop/categories"),
    ]);
    state.shopProducts = products;
    state.categories = categories;
    root.querySelector("#kovbox-showcase").innerHTML = renderKovboxShowcase(products);
    renderCategoryFilters(root);
  } catch (error) {
    root.querySelector("#kovbox-showcase").innerHTML = `${renderKovboxShowcase()}<div class="empty">Ошибка загрузки ковбоксов: ${escapeHtml(error.message)}</div>`;
  }

  if (state.mode === "shop") {
    await renderShop(root, true);
  } else {
    await renderMarket(root);
  }
}

async function renderShop(root, background) {
  const tools = root.querySelector("#market-tools");
  if (tools) {
    tools.innerHTML = `
      <div class="market-tools">
        <button class="btn btn-outline" data-restock-request>Заявка на пополнение</button>
      </div>`;
    get("/api/shop/restock-request/status", { force: true }).then((status) => {
      const button = tools.querySelector("[data-restock-request]");
      if (!button || status.can_submit) return;
      button.disabled = true;
      button.textContent = "Заявка отправлена";
    }).catch(() => {});
  }
  const content = root.querySelector("#content");
  const requestVersion = (shopLoadVersions.get(root) || 0) + 1;
  shopLoadVersions.set(root, requestVersion);
  if (content && !background) content.innerHTML = `<div class="empty">Загрузка…</div>`;
  let products;
  try {
    products = await get("/api/shop/products", { force: true });
  } catch (e) {
    if (content && shopLoadVersions.get(root) === requestVersion) content.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (state.mode !== "shop" || shopLoadVersions.get(root) !== requestVersion || root.querySelector("#content") !== content) return;
  state.shopProducts = products;
  const showcase = root.querySelector("#kovbox-showcase");
  if (showcase) showcase.innerHTML = renderKovboxShowcase(products);
  renderCategoryFilters(root);
  paintShop(root);
}

function openRestockRequestDialog(root) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Заявка на пополнение</h2>
    <label class="field-label" for="restock-request-text">Какой товар добавить?</label>
    <input class="input" id="restock-request-text" maxlength="30" autocomplete="off" placeholder="Название товара">
    <button class="btn" id="restock-request-submit" style="margin-top:14px">Отправить</button>
  `);
  const input = modal.querySelector("#restock-request-text");
  const button = modal.querySelector("#restock-request-submit");
  input.focus();
  button.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return window.kov.toast("Введите название товара");
    button.disabled = true;
    button.textContent = "Отправляем…";
    try {
      await post("/api/shop/restock-request", { text });
      window.closeModal();
      window.kov.toast("Заявка отправлена");
      await renderShop(root, true);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Отправить";
      window.kov.toast(error.message);
    }
  });
}

async function renderMarket(root, background) {
  const requestVersion = (marketLoadVersions.get(root) || 0) + 1;
  marketLoadVersions.set(root, requestVersion);
  const tools = root.querySelector("#market-tools");
  if (!tools) return;
  tools.innerHTML = `
    <div class="market-tools">
      <button class="btn btn-outline" id="sell-btn">＋ Продать</button>
      <button class="btn btn-secondary" id="my-listings-btn">Мои объявления</button>
    </div>
  `;
  tools.querySelector("#sell-btn").addEventListener("click", () => openSellDialog(root));
  tools.querySelector("#my-listings-btn").addEventListener("click", () => openMyListings(root));

  const content = root.querySelector("#content");
  if (content && !background) content.innerHTML = `<div class="empty">Загрузка…</div>`;
  let listings;
  try {
    listings = await get("/api/market/listings");
  } catch (e) {
    if (content && marketLoadVersions.get(root) === requestVersion) content.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (state.mode !== "market" || marketLoadVersions.get(root) !== requestVersion || root.querySelector("#content") !== content) return;
  state.marketListings = listings;
  renderCategoryFilters(root);
  paintMarket(root);
}

async function openSellDialog(root) {
  let inv;
  try {
    inv = await get("/api/market/inventory");
  } catch (e) {
    window.kov.toast(e.message);
    return;
  }
  inv = inv.filter((row) => row.item.can_gift);
  if (!inv.length) {
    window.kov.toast("Инвентарь пуст — нечего продавать");
    return;
  }
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Выставить на продажу</h2>
    <label class="field-label">Предмет</label>
    <select class="input" id="item">${inv
      .map((r) => `<option value="${r.item.id}" data-max="${r.quantity}">${escapeHtml(r.item.name)} (есть ${r.quantity})</option>`)
      .join("")}</select>
    <label class="field-label">Количество</label>
    <input class="input" id="qty" type="number" min="1" value="1" />
    <label class="field-label">Цена за лот</label>
    <input class="input" id="price" type="number" min="1" />
    <button class="btn" id="list-btn" style="margin-top:14px">Выставить</button>
  `);
  modal.querySelector("#list-btn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const item_id = Number(modal.querySelector("#item").value);
    const quantity = Number(modal.querySelector("#qty").value);
    const price = Number(modal.querySelector("#price").value);
    if (!item_id || !quantity || !price) return window.kov.toast("Заполни поля");
    button.disabled = true;
    button.textContent = "Выставляем…";
    try {
      await post("/api/market/list", { item_id, quantity, price });
      window.kov.toast("Выставлено!");
      window.closeModal();
      await renderMarket(root, true);
    } catch (e) {
      button.disabled = false;
      button.textContent = "Выставить";
      window.kov.toast(e.message);
    }
  });
}

async function openMyListings(root) {
  let mine;
  try {
    mine = await get("/api/market/my");
  } catch (e) {
    window.kov.toast(e.message);
    return;
  }
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Мои объявления</h2>
    <p style="color:var(--text-soft); font-size:13px; margin: 2px 0 12px">Ваши товары на рынке</p>
    ${
      mine.length === 0
        ? `<div class="empty">Ничего не выставлено</div>`
        : `<div style="display:flex; flex-direction:column; gap:8px">${mine
            .map(
              (l) => `
              <div class="listing-row">
                ${productImg(l.item, "md")}
                <div class="meta">
                  <div class="name">${escapeHtml(l.item.name)}</div>
                  <div class="author">×${l.quantity}</div>
                </div>
                <div class="price">${iconHtml("/static/img/ui/kovbaks.png", "sm", "")} ${l.price}</div>
                <button class="btn btn-sm btn-outline" data-unlist="${l.id}">Снять</button>
              </div>`,
            )
            .join("")}</div>`
    }
  `);
  modal.querySelectorAll("[data-unlist]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      const oldText = b.textContent;
      b.textContent = "Снимаем…";
      try {
        await post(`/api/market/unlist/${b.dataset.unlist}`);
        window.kov.toast("Снято с продажи");
        window.closeModal();
        await renderMarket(root, true);
      } catch (e) {
        b.disabled = false;
        b.textContent = oldText;
        window.kov.toast(e.message);
      }
    }),
  );
}
