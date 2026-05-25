import { get, post, iconHtml, productImg } from "/static/api.js?v=39";

import { playUISound } from "/static/pages/settings.js?v=39";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = {
  mode: "shop", // shop | market
};

export async function renderKoverna(root) {
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Коверна</h1>
        <div class="subtitle">${state.mode === "shop" ? "Магазин официальных товаров" : "Рынок игроков"}</div>
        <div class="subtitle" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.mode === "shop" ? "Товары с доставкой в инвентарь." : "Покупайте товары у других жителей."}</div>
      </div>
      <div class="hero-art"><img src="/static/img/shop.svg" alt="Лавка" class="hero-img"/></div>
    </section>

    <div class="toggle" id="mode-toggle">
      <button data-mode="shop" class="${state.mode === "shop" ? "active" : ""}">Магазин</button>
      <button data-mode="market" class="${state.mode === "market" ? "active" : ""}">Рынок</button>
    </div>

    <div id="market-tools"></div>
    <div id="content"></div>
  `;

  root.querySelectorAll("#mode-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      renderKoverna(root);
    }),
  );

  if (state.mode === "shop") {
    await renderShop(root);
  } else {
    await renderMarket(root);
  }
}

async function renderShop(root) {
  const products = await get("/api/shop/products");
  const content = root.querySelector("#content");
  content.innerHTML =
    products.length === 0
      ? `<div class="empty">В магазине пока пусто</div>`
      : `<div class="product-grid">${products
          .map(
            (p) => `
            <div class="product${p.stock === 0 ? " product-out" : ""}">
              ${productImg(p.item, "xl")}
              <div class="name">${escapeHtml(p.item.name)}</div>
              <div class="price">${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${p.price} ${p.stock === -1 ? "" : `×${p.stock}`}</div>
              <button class="btn btn-sm" data-buy="${p.id}" ${p.stock === 0 ? "disabled" : ""}>${p.stock === 0 ? "Нет" : "Купить"}</button>
            </div>`,
          )
          .join("")}</div>`;

  content.querySelectorAll("[data-buy]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await post("/api/shop/buy", { product_id: Number(b.dataset.buy) });
        playUISound("win");
        window.kov.toast("Куплено! Предмет в инвентаре");
        await renderShop(root);
      } catch (e) {
        window.kov.toast(e.message);
      }
    }),
  );
}

async function renderMarket(root) {
  const tools = root.querySelector("#market-tools");
  tools.innerHTML = `
    <div class="market-tools">
      <button class="btn btn-outline" id="sell-btn">＋ Продать</button>
      <button class="btn btn-secondary" id="my-listings-btn">Мои объявления</button>
    </div>
  `;
  tools.querySelector("#sell-btn").addEventListener("click", openSellDialog);
  tools.querySelector("#my-listings-btn").addEventListener("click", openMyListings);

  const listings = await get("/api/market/listings");
  const content = root.querySelector("#content");
  content.innerHTML =
    listings.length === 0
      ? `<div class="empty">На рынке пока ничего — выставь товар, чтобы начать!</div>`
      : `<div class="product-grid">${listings
          .map(
            (l) => `
            <div class="product${l.target_user_id ? " product-targeted" : ""}">
              ${l.target_user_id ? `<span class="targeted-badge">Только тебе</span>` : ""}
              ${productImg(l.item, "xl")}
              <div class="name">${escapeHtml(l.item.name)}</div>
              <div class="card-sub">от ${escapeHtml(l.seller_name)} · ×${l.quantity}</div>
              <div class="price" style="margin-top:6px">${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${l.price}</div>
              <button class="btn btn-sm" data-buy-listing="${l.id}">Купить</button>
            </div>`,
          )
          .join("")}</div>`;

  content.querySelectorAll("[data-buy-listing]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await post("/api/market/buy", { listing_id: Number(b.dataset.buyListing) });
        window.kov.toast("Куплено! Предмет в инвентаре");
        await renderMarket(root);
      } catch (e) {
        window.kov.toast(e.message);
      }
    }),
  );
}

async function openSellDialog() {
  const inv = await get("/api/market/inventory");
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
  modal.querySelector("#list-btn").addEventListener("click", async () => {
    const item_id = Number(modal.querySelector("#item").value);
    const quantity = Number(modal.querySelector("#qty").value);
    const price = Number(modal.querySelector("#price").value);
    if (!item_id || !quantity || !price) return window.kov.toast("Заполни поля");
    try {
      await post("/api/market/list", { item_id, quantity, price });
      window.kov.toast("Выставлено!");
      window.closeModal();
      renderKoverna(document.getElementById("view"));
    } catch (e) {
      window.kov.toast(e.message);
    }
  });
}

async function openMyListings() {
  const mine = await get("/api/market/my");
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
                <div class="price">${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${l.price}</div>
                <button class="btn btn-sm btn-outline" data-unlist="${l.id}">Снять</button>
              </div>`,
            )
            .join("")}</div>`
    }
  `);
  modal.querySelectorAll("[data-unlist]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await post(`/api/market/unlist/${b.dataset.unlist}`);
        window.kov.toast("Снято с продажи");
        window.closeModal();
        renderKoverna(document.getElementById("view"));
      } catch (e) {
        window.kov.toast(e.message);
      }
    }),
  );
}
