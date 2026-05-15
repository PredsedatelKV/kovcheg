import { get, post } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CATEGORIES = ["Все", "Ресурсы", "Ускорители", "Декор", "Другое"];

let state = {
  mode: "shop", // shop | market
  category: "Все",
};

export async function renderKoverna(root) {
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Коверна</h1>
        <div class="subtitle">${state.mode === "shop" ? "Магазин официальных товаров" : "Рынок игроков"}</div>
        <div class="subtitle" style="margin-top:4px">${state.mode === "shop" ? "Покупайте товары в магазине — они сразу попадут в ваш инвентарь." : "Покупайте товары у других жителей."}</div>
      </div>
      <div class="hero-art">🛒</div>
    </section>

    <div class="toggle" id="mode-toggle">
      <button data-mode="shop" class="${state.mode === "shop" ? "active" : ""}">🛍️ Магазин</button>
      <button data-mode="market" class="${state.mode === "market" ? "active" : ""}">🏷️ Рынок</button>
    </div>

    <div id="market-tools"></div>

    <div class="chips-row" id="cats">
      ${CATEGORIES.map((c) => `<button class="pill ${c === state.category ? "active" : ""}" data-cat="${c}">${c}</button>`).join("")}
    </div>

    <div id="content"></div>
  `;

  root.querySelectorAll("#mode-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      renderKoverna(root);
    }),
  );

  root.querySelectorAll("#cats .pill").forEach((b) =>
    b.addEventListener("click", () => {
      state.category = b.dataset.cat;
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
  const filtered = products.filter((p) => state.category === "Все" || p.item.category === state.category);
  const content = root.querySelector("#content");
  content.innerHTML =
    filtered.length === 0
      ? `<div class="empty">Нет товаров в этой категории</div>`
      : `<div class="product-grid">${filtered
          .map(
            (p) => `
            <div class="product">
              <div class="icon-big">${p.item.icon}</div>
              <div class="name">${escapeHtml(p.item.name)}</div>
              <div class="price"><span class="coin">🪙</span> ${p.price}</div>
              <button class="btn btn-sm" data-buy="${p.id}">Купить</button>
            </div>`,
          )
          .join("")}</div>`;

  content.querySelectorAll("[data-buy]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await post("/api/shop/buy", { product_id: Number(b.dataset.buy) });
        window.kov.toast("Куплено! Предмет в инвентаре");
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
  const filtered = listings.filter((l) => state.category === "Все" || l.item.category === state.category);
  const content = root.querySelector("#content");
  content.innerHTML =
    filtered.length === 0
      ? `<div class="empty">На рынке пока ничего — выставь товар, чтобы начать!</div>`
      : `<div class="product-grid">${filtered
          .map(
            (l) => `
            <div class="product">
              <div class="icon-big">${l.item.icon}</div>
              <div class="name">${escapeHtml(l.item.name)}</div>
              <div class="card-sub">от ${escapeHtml(l.seller_name)} · ×${l.quantity}</div>
              <div class="price" style="margin-top:6px"><span class="coin">🪙</span> ${l.price}</div>
              <button class="btn btn-sm" data-buy-listing="${l.id}">Купить</button>
            </div>`,
          )
          .join("")}</div>`;

  content.querySelectorAll("[data-buy-listing]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await post("/api/market/buy", { listing_id: Number(b.dataset.buyListing) });
        window.kov.toast("Куплено! Предмет в инвентаре");
        const r = document.getElementById("view");
        renderKoverna(r);
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
      .map((r) => `<option value="${r.item.id}" data-max="${r.quantity}">${r.item.icon} ${escapeHtml(r.item.name)} (есть ${r.quantity})</option>`)
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
                <div class="ico">${l.item.icon}</div>
                <div class="meta">
                  <div class="name">${escapeHtml(l.item.name)}</div>
                  <div class="author">×${l.quantity}</div>
                </div>
                <div class="price">🪙 ${l.price}</div>
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
