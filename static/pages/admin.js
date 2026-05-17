import { get, post, patch, del, iconHtml } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SECTIONS = [
  { id: "users", label: "Игроки", icon: "/static/img/tabs/profile.svg" },
  { id: "news", label: "Новости", icon: "/static/img/ui/mail.svg" },
  { id: "banners", label: "Карусель", icon: "/static/img/ui/castle.svg" },
  { id: "wheel", label: "Колесо", icon: "/static/img/ui/wheel.svg" },
  { id: "shop", label: "Магазин", icon: "/static/img/tabs/koverna.svg" },
  { id: "market", label: "Рынок", icon: "/static/img/shop.svg" },
  { id: "tasks", label: "Задания", icon: "/static/img/tasks/scroll.svg" },
  { id: "items", label: "Предметы", icon: "/static/img/ui/box.svg" },
  { id: "legal", label: "Тексты", icon: "/static/img/ui/book.svg" },
];

let META = { items: [], users: [] };

export async function renderAdmin(root) {
  root.innerHTML = `<div class="card"><p>Загрузка админ-панели…</p></div>`;
  try {
    META = await get("/api/admin/meta");
  } catch (err) {
    root.innerHTML = `<div class="card"><h3>Ошибка</h3><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const stored = localStorage.getItem("kovcheg.admin.section") || "users";
  const initial = SECTIONS.find((s) => s.id === stored) ? stored : "users";

  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Админ</h1>
        <div class="subtitle">Полный контроль над Ковчегом.</div>
      </div>
      <div class="hero-head"><img src="/static/img/tabs/admin.svg" alt="" class="hero-img"/></div>
    </section>

    <div class="admin-tabs">
      ${SECTIONS.map(
        (s) => `<button class="admin-tab" data-section="${s.id}">
          <img src="${s.icon}" alt="" class="icon icon-sm"/><span>${escapeHtml(s.label)}</span>
        </button>`,
      ).join("")}
    </div>

    <div id="admin-body"></div>
  `;

  const body = root.querySelector("#admin-body");
  root.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.section;
      localStorage.setItem("kovcheg.admin.section", id);
      activate(id);
    });
  });

  async function activate(id) {
    root.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("active", b.dataset.section === id));
    body.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
    try {
      META = await get("/api/admin/meta");
      await SECTION_RENDERERS[id](body);
    } catch (err) {
      body.innerHTML = `<div class="card"><h3>Ошибка</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  activate(initial);
}

// ---------- helpers ----------
function itemOptions(selectedId = null) {
  return META.items
    .map(
      (i) =>
        `<option value="${i.id}" ${selectedId === i.id ? "selected" : ""}>${escapeHtml(i.name)} (${escapeHtml(i.code)})</option>`,
    )
    .join("");
}

function userOptions(selectedId = null) {
  return META.users
    .map(
      (u) =>
        `<option value="${u.id}" ${selectedId === u.id ? "selected" : ""}>${escapeHtml(u.first_name)} (@${escapeHtml(u.username || "")})</option>`,
    )
    .join("");
}

function cardBlock(title, inner) {
  return `<div class="admin-card"><h3 class="admin-card-title">${escapeHtml(title)}</h3>${inner}</div>`;
}

function field(label, inputHtml) {
  return `<label class="admin-field"><span>${escapeHtml(label)}</span>${inputHtml}</label>`;
}

function formGrid(...rows) {
  return `<div class="admin-form-grid">${rows.join("")}</div>`;
}

async function refresh(body, sectionId) {
  await SECTION_RENDERERS[sectionId](body);
}

function confirmAction(msg, fn) {
  if (confirm(msg)) return fn();
}

// ---------- USERS ----------
async function renderUsers(body) {
  const rows = await get("/api/admin/users");
  body.innerHTML = rows
    .map(
      (u) => `
    <div class="admin-card">
      <h3 class="admin-card-title">${escapeHtml(u.first_name)} ${u.is_admin ? '<span class="admin-badge">admin</span>' : ""}</h3>
      <div class="admin-sub">@${escapeHtml(u.username || "")} · TG ${u.telegram_id} · 🪙 ${u.balance}</div>
      ${formGrid(
        field("Имя", `<input class="input" data-k="first_name" value="${escapeHtml(u.first_name)}"/>`),
        field("Должность", `<input class="input" data-k="role" value="${escapeHtml(u.role)}"/>`),
        field("Ограничения", `<input class="input" data-k="restrictions" value="${escapeHtml(u.restrictions || "")}"/>`),
      )}
      <div class="row gap">
        <button class="btn btn-sm" data-action="save" data-id="${u.id}">Сохранить</button>
      </div>
      <hr class="admin-sep"/>
      <div class="row gap wrap">
        <input class="input input-sm" data-k="delta" type="number" placeholder="±монеты" style="max-width:120px"/>
        <input class="input input-sm" data-k="note" placeholder="комментарий" style="flex:1; min-width:120px"/>
        <button class="btn btn-sm" data-action="balance" data-id="${u.id}">Применить</button>
      </div>
      <hr class="admin-sep"/>
      <div class="row gap wrap">
        <select class="input input-sm" data-k="item" style="flex:1; min-width:160px">${itemOptions()}</select>
        <input class="input input-sm" data-k="invdelta" type="number" placeholder="±шт" style="max-width:100px"/>
        <button class="btn btn-sm" data-action="inv" data-id="${u.id}">В инвентарь</button>
      </div>
    </div>
  `,
    )
    .join("");

  body.querySelectorAll('[data-action="save"]').forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".admin-card");
      const payload = {
        first_name: card.querySelector('[data-k="first_name"]').value,
        role: card.querySelector('[data-k="role"]').value,
        restrictions: card.querySelector('[data-k="restrictions"]').value,
      };
      try {
        await patch(`/api/admin/users/${b.dataset.id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    }),
  );
  body.querySelectorAll('[data-action="balance"]').forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".admin-card");
      const delta = Number(card.querySelector('[data-k="delta"]').value);
      const note = card.querySelector('[data-k="note"]').value;
      if (!delta) return window.kov.toast("Укажи дельту");
      try {
        await post(`/api/admin/users/${b.dataset.id}/balance`, { delta, note });
        window.kov.toast("Баланс обновлён");
        renderUsers(body);
      } catch (err) {
        window.kov.toast(err.message);
      }
    }),
  );
  body.querySelectorAll('[data-action="inv"]').forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".admin-card");
      const item_id = Number(card.querySelector('[data-k="item"]').value);
      const delta = Number(card.querySelector('[data-k="invdelta"]').value);
      if (!item_id || !delta) return window.kov.toast("Заполни поля");
      try {
        await post(`/api/admin/users/${b.dataset.id}/inventory`, { item_id, delta });
        window.kov.toast("Инвентарь обновлён");
      } catch (err) {
        window.kov.toast(err.message);
      }
    }),
  );
}

// ---------- NEWS ----------
async function renderNews(body) {
  const rows = await get("/api/admin/news");
  body.innerHTML = `
    ${cardBlock(
      "Новая новость",
      formGrid(
        field("Заголовок", `<input class="input" id="n-title"/>`),
        field("URL картинки", `<input class="input" id="n-image"/>`),
        field("Текст", `<textarea class="input" id="n-body" rows="4"></textarea>`),
      ) + `<button class="btn btn-sm" id="n-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (n) => `
      <div class="admin-card" data-id="${n.id}">
        ${n.image_url ? `<img src="${escapeHtml(n.image_url)}" class="admin-thumb" alt=""/>` : ""}
        ${formGrid(
          field("Заголовок", `<input class="input" data-k="title" value="${escapeHtml(n.title)}"/>`),
          field("URL картинки", `<input class="input" data-k="image_url" value="${escapeHtml(n.image_url || "")}"/>`),
          field("Текст", `<textarea class="input" data-k="body" rows="3">${escapeHtml(n.body || "")}</textarea>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#n-create").addEventListener("click", async () => {
    const payload = {
      title: body.querySelector("#n-title").value.trim(),
      image_url: body.querySelector("#n-image").value.trim(),
      body: body.querySelector("#n-body").value,
      is_active: true,
    };
    if (!payload.title) return window.kov.toast("Заголовок обязателен");
    try {
      await post("/api/admin/news", payload);
      window.kov.toast("Создано");
      renderNews(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        title: card.querySelector('[data-k="title"]').value,
        image_url: card.querySelector('[data-k="image_url"]').value,
        body: card.querySelector('[data-k="body"]').value,
        is_active: true,
      };
      try {
        await patch(`/api/admin/news/${id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Удалить новость?", async () => {
        try {
          await del(`/api/admin/news/${id}`);
          renderNews(body);
        } catch (err) {
          window.kov.toast(err.message);
        }
      }),
    );
  });
}

// ---------- BANNERS ----------
async function renderBanners(body) {
  const rows = await get("/api/admin/banners");
  body.innerHTML = `
    ${cardBlock(
      "Новый баннер",
      formGrid(
        field("URL картинки 16:9", `<input class="input" id="b-image"/>`),
        field("Заголовок", `<input class="input" id="b-title"/>`),
        field("Порядок", `<input class="input" id="b-order" type="number" value="0"/>`),
      ) + `<button class="btn btn-sm" id="b-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (b) => `
      <div class="admin-card" data-id="${b.id}">
        <img src="${escapeHtml(b.image_url)}" class="admin-thumb" alt=""/>
        ${formGrid(
          field("URL", `<input class="input" data-k="image_url" value="${escapeHtml(b.image_url)}"/>`),
          field("Заголовок", `<input class="input" data-k="title" value="${escapeHtml(b.title)}"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#b-create").addEventListener("click", async () => {
    const payload = {
      image_url: body.querySelector("#b-image").value.trim(),
      title: body.querySelector("#b-title").value.trim(),
      sort_order: Number(body.querySelector("#b-order").value) || 0,
      is_active: true,
    };
    if (!payload.image_url) return window.kov.toast("URL обязателен");
    try {
      await post("/api/admin/banners", payload);
      window.kov.toast("Создано");
      renderBanners(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        image_url: card.querySelector('[data-k="image_url"]').value,
        title: card.querySelector('[data-k="title"]').value,
        sort_order: 0,
        is_active: true,
      };
      try {
        await patch(`/api/admin/banners/${id}`, payload);
        window.kov.toast("Сохранено");
        renderBanners(body);
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Удалить баннер?", async () => {
        await del(`/api/admin/banners/${id}`);
        renderBanners(body);
      }),
    );
  });
}

// ---------- WHEEL ----------
async function renderWheel(body) {
  const rows = await get("/api/admin/wheel");
  body.innerHTML = `
    ${cardBlock(
      "Новый сектор",
      formGrid(
        field("Название", `<input class="input" id="w-label"/>`),
        field(
          "Тип",
          `<select class="input" id="w-kind">
            <option value="coins">монеты</option>
            <option value="item">предмет</option>
          </select>`,
        ),
        field("Значение (монет)", `<input class="input" id="w-value" type="number" value="0"/>`),
        field(
          "Предмет (если предмет)",
          `<select class="input" id="w-item"><option value="">—</option>${META.items.map((i) => `<option value="${i.code}">${escapeHtml(i.name)}</option>`).join("")}</select>`,
        ),
        field("Иконка (URL)", `<input class="input" id="w-icon" value="/static/img/ui/coin.svg"/>`),
        field("Вес", `<input class="input" id="w-weight" type="number" value="10" min="1"/>`),
      ) + `<button class="btn btn-sm" id="w-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (p) => `
      <div class="admin-card" data-id="${p.id}">
        <h3 class="admin-card-title"><img src="${escapeHtml(p.icon)}" class="icon icon-sm" alt=""/> ${escapeHtml(p.label)}</h3>
        ${formGrid(
          field("Название", `<input class="input" data-k="label" value="${escapeHtml(p.label)}"/>`),
          field(
            "Тип",
            `<select class="input" data-k="kind">
              <option value="coins" ${p.kind === "coins" ? "selected" : ""}>монеты</option>
              <option value="item" ${p.kind === "item" ? "selected" : ""}>предмет</option>
            </select>`,
          ),
          field("Значение", `<input class="input" data-k="value" type="number" value="${p.value}"/>`),
          field(
            "Предмет",
            `<select class="input" data-k="item_code"><option value="">—</option>${META.items.map((i) => `<option value="${i.code}" ${i.code === p.item_code ? "selected" : ""}>${escapeHtml(i.name)}</option>`).join("")}</select>`,
          ),
          field("Иконка", `<input class="input" data-k="icon" value="${escapeHtml(p.icon)}"/>`),
          field("Вес", `<input class="input" data-k="weight" type="number" value="${p.weight}" min="1"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#w-create").addEventListener("click", async () => {
    const payload = {
      label: body.querySelector("#w-label").value.trim(),
      kind: body.querySelector("#w-kind").value,
      value: Number(body.querySelector("#w-value").value) || 0,
      item_code: body.querySelector("#w-item").value || null,
      icon: body.querySelector("#w-icon").value.trim(),
      weight: Number(body.querySelector("#w-weight").value) || 10,
      sort_order: 0,
      is_active: true,
    };
    if (!payload.label) return window.kov.toast("Название обязательно");
    try {
      await post("/api/admin/wheel", payload);
      window.kov.toast("Создано");
      renderWheel(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        label: card.querySelector('[data-k="label"]').value,
        kind: card.querySelector('[data-k="kind"]').value,
        value: Number(card.querySelector('[data-k="value"]').value) || 0,
        item_code: card.querySelector('[data-k="item_code"]').value || null,
        icon: card.querySelector('[data-k="icon"]').value,
        weight: Number(card.querySelector('[data-k="weight"]').value) || 10,
        sort_order: 0,
        is_active: true,
      };
      try {
        await patch(`/api/admin/wheel/${id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Удалить сектор?", async () => {
        await del(`/api/admin/wheel/${id}`);
        renderWheel(body);
      }),
    );
  });
}

// ---------- SHOP ----------
async function renderShop(body) {
  const rows = await get("/api/admin/shop");
  body.innerHTML = `
    ${cardBlock(
      "Новый товар в магазине",
      formGrid(
        field("Предмет", `<select class="input" id="s-item">${itemOptions()}</select>`),
        field("Цена", `<input class="input" id="s-price" type="number" min="0" value="100"/>`),
      ) + `<button class="btn btn-sm" id="s-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (p) => `
      <div class="admin-card" data-id="${p.id}">
        <h3 class="admin-card-title"><img src="${escapeHtml(p.item.icon)}" class="icon icon-sm" alt=""/> ${escapeHtml(p.item.name)}</h3>
        ${formGrid(
          field("Предмет", `<select class="input" data-k="item_id">${itemOptions(p.item.id)}</select>`),
          field("Цена", `<input class="input" data-k="price" type="number" min="0" value="${p.price}"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#s-create").addEventListener("click", async () => {
    const payload = {
      item_id: Number(body.querySelector("#s-item").value),
      price: Number(body.querySelector("#s-price").value),
      is_active: true,
    };
    try {
      await post("/api/admin/shop", payload);
      window.kov.toast("Создано");
      renderShop(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        item_id: Number(card.querySelector('[data-k="item_id"]').value),
        price: Number(card.querySelector('[data-k="price"]').value),
        is_active: true,
      };
      try {
        await patch(`/api/admin/shop/${id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Удалить товар?", async () => {
        await del(`/api/admin/shop/${id}`);
        renderShop(body);
      }),
    );
  });
}

// ---------- MARKET ----------
async function renderMarket(body) {
  const rows = await get("/api/admin/market");
  body.innerHTML = `
    ${cardBlock(
      "Новое объявление на рынке",
      formGrid(
        field("Продавец", `<select class="input" id="m-seller">${userOptions()}</select>`),
        field("Предмет", `<select class="input" id="m-item">${itemOptions()}</select>`),
        field("Кол-во", `<input class="input" id="m-qty" type="number" min="1" value="1"/>`),
        field("Цена", `<input class="input" id="m-price" type="number" min="1" value="100"/>`),
      ) + `<button class="btn btn-sm" id="m-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (l) => `
      <div class="admin-card" data-id="${l.id}">
        <h3 class="admin-card-title"><img src="${escapeHtml(l.item.icon)}" class="icon icon-sm" alt=""/> ${escapeHtml(l.item.name)}</h3>
        <div class="admin-sub">Продаёт: ${escapeHtml(l.seller_name)} · ${l.quantity} шт · 🪙 ${l.price}</div>
        ${formGrid(
          field("Цена", `<input class="input" data-k="price" type="number" min="1" value="${l.price}"/>`),
          field("Кол-во", `<input class="input" data-k="quantity" type="number" min="1" value="${l.quantity}"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Снять</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#m-create").addEventListener("click", async () => {
    const payload = {
      seller_id: Number(body.querySelector("#m-seller").value),
      item_id: Number(body.querySelector("#m-item").value),
      quantity: Number(body.querySelector("#m-qty").value),
      price: Number(body.querySelector("#m-price").value),
      is_active: true,
    };
    try {
      await post("/api/admin/market", payload);
      window.kov.toast("Создано");
      renderMarket(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const row = rows.find((r) => r.id === Number(id));
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        seller_id: row.seller_id,
        item_id: row.item.id,
        quantity: Number(card.querySelector('[data-k="quantity"]').value),
        price: Number(card.querySelector('[data-k="price"]').value),
        is_active: true,
      };
      try {
        await patch(`/api/admin/market/${id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Снять объявление?", async () => {
        await del(`/api/admin/market/${id}`);
        renderMarket(body);
      }),
    );
  });
}

// ---------- TASKS ----------
async function renderTasks(body) {
  const rows = await get("/api/admin/tasks");
  body.innerHTML = `
    ${cardBlock(
      "Новое задание / план",
      formGrid(
        field("Название", `<input class="input" id="t-name"/>`),
        field("Описание", `<textarea class="input" id="t-desc" rows="3"></textarea>`),
        field("Иконка", `<input class="input" id="t-icon" value="/static/img/tasks/scroll.svg"/>`),
        field("Награда (монет)", `<input class="input" id="t-reward" type="number" value="10"/>`),
        field("Цель", `<input class="input" id="t-target" type="number" value="1"/>`),
        field("Тип", `<select class="input" id="t-plan"><option value="0">Задание</option><option value="1">Ежедневный план</option></select>`),
      ) + `<button class="btn btn-sm" id="t-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (t) => `
      <div class="admin-card" data-id="${t.id}">
        <h3 class="admin-card-title"><img src="${escapeHtml(t.icon)}" class="icon icon-sm" alt=""/> ${escapeHtml(t.name)} ${t.is_daily_plan ? '<span class="admin-badge">план</span>' : ""}</h3>
        ${formGrid(
          field("Название", `<input class="input" data-k="name" value="${escapeHtml(t.name)}"/>`),
          field("Описание", `<textarea class="input" data-k="description" rows="3">${escapeHtml(t.description || "")}</textarea>`),
          field("Иконка", `<input class="input" data-k="icon" value="${escapeHtml(t.icon)}"/>`),
          field("Награда", `<input class="input" data-k="reward" type="number" value="${t.reward}"/>`),
          field("Цель", `<input class="input" data-k="target_progress" type="number" value="${t.target_progress}"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#t-create").addEventListener("click", async () => {
    const payload = {
      name: body.querySelector("#t-name").value.trim(),
      description: body.querySelector("#t-desc").value,
      icon: body.querySelector("#t-icon").value.trim(),
      reward: Number(body.querySelector("#t-reward").value) || 0,
      target_progress: Number(body.querySelector("#t-target").value) || 1,
      is_active: true,
      is_daily_plan: body.querySelector("#t-plan").value === "1",
      sort_order: 0,
    };
    if (!payload.name) return window.kov.toast("Название обязательно");
    try {
      await post("/api/admin/tasks", payload);
      window.kov.toast("Создано");
      renderTasks(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const original = rows.find((r) => r.id === Number(id));
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        name: card.querySelector('[data-k="name"]').value,
        description: card.querySelector('[data-k="description"]').value,
        icon: card.querySelector('[data-k="icon"]').value,
        reward: Number(card.querySelector('[data-k="reward"]').value),
        target_progress: Number(card.querySelector('[data-k="target_progress"]').value),
        is_active: true,
        is_daily_plan: original.is_daily_plan,
        sort_order: 0,
      };
      try {
        await patch(`/api/admin/tasks/${id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Удалить задание?", async () => {
        await del(`/api/admin/tasks/${id}`);
        renderTasks(body);
      }),
    );
  });
}

// ---------- ITEMS ----------
async function renderItems(body) {
  const rows = await get("/api/admin/items");
  body.innerHTML = `
    ${cardBlock(
      "Новый предмет",
      formGrid(
        field("Код (англ.)", `<input class="input" id="i-code"/>`),
        field("Название", `<input class="input" id="i-name"/>`),
        field("Иконка", `<input class="input" id="i-icon" value="/static/img/ui/box.svg"/>`),
        field("Описание", `<textarea class="input" id="i-desc" rows="2"></textarea>`),
        field("Категория", `<input class="input" id="i-cat" value="Ресурсы"/>`),
        field("Редкость", `<input class="input" id="i-rare" value="Обычный"/>`),
      ) + `<button class="btn btn-sm" id="i-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (i) => `
      <div class="admin-card" data-id="${i.id}">
        <h3 class="admin-card-title"><img src="${escapeHtml(i.icon)}" class="icon icon-sm" alt=""/> ${escapeHtml(i.name)} <span class="admin-badge">${escapeHtml(i.code)}</span></h3>
        ${formGrid(
          field("Название", `<input class="input" data-k="name" value="${escapeHtml(i.name)}"/>`),
          field("Иконка", `<input class="input" data-k="icon" value="${escapeHtml(i.icon)}"/>`),
          field("Описание", `<textarea class="input" data-k="description" rows="2">${escapeHtml(i.description || "")}</textarea>`),
          field("Категория", `<input class="input" data-k="category" value="${escapeHtml(i.category)}"/>`),
          field("Редкость", `<input class="input" data-k="rarity" value="${escapeHtml(i.rarity)}"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  body.querySelector("#i-create").addEventListener("click", async () => {
    const payload = {
      code: body.querySelector("#i-code").value.trim(),
      name: body.querySelector("#i-name").value.trim(),
      icon: body.querySelector("#i-icon").value.trim(),
      description: body.querySelector("#i-desc").value,
      category: body.querySelector("#i-cat").value || "Ресурсы",
      rarity: body.querySelector("#i-rare").value || "Обычный",
      can_gift: true,
      can_activate: false,
    };
    if (!payload.code || !payload.name) return window.kov.toast("Код и название обязательны");
    try {
      await post("/api/admin/items", payload);
      window.kov.toast("Создано");
      renderItems(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  body.querySelectorAll('.admin-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const orig = rows.find((r) => r.id === Number(id));
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {
        code: orig.code,
        name: card.querySelector('[data-k="name"]').value,
        icon: card.querySelector('[data-k="icon"]').value,
        description: card.querySelector('[data-k="description"]').value,
        category: card.querySelector('[data-k="category"]').value,
        rarity: card.querySelector('[data-k="rarity"]').value,
        can_gift: orig.can_gift,
        can_activate: orig.can_activate,
      };
      try {
        await patch(`/api/admin/items/${id}`, payload);
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
  });
}

// ---------- LEGAL ----------
async function renderLegal(body) {
  const rows = await get("/api/admin/legal");
  body.innerHTML = rows
    .map(
      (t) => `
    <div class="admin-card" data-slug="${escapeHtml(t.slug)}">
      <h3 class="admin-card-title">${escapeHtml(t.title)}</h3>
      ${formGrid(
        field("Заголовок", `<input class="input" data-k="title" value="${escapeHtml(t.title)}"/>`),
        field("Текст", `<textarea class="input" data-k="body" rows="10">${escapeHtml(t.body)}</textarea>`),
      )}
      <div class="row gap">
        <button class="btn btn-sm" data-action="save">Сохранить</button>
      </div>
    </div>
  `,
    )
    .join("");

  body.querySelectorAll('.admin-card[data-slug]').forEach((card) => {
    const slug = card.dataset.slug;
    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await patch(`/api/admin/legal/${slug}`, {
          title: card.querySelector('[data-k="title"]').value,
          body: card.querySelector('[data-k="body"]').value,
        });
        window.kov.toast("Сохранено");
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
  });
}

const SECTION_RENDERERS = {
  users: renderUsers,
  news: renderNews,
  banners: renderBanners,
  wheel: renderWheel,
  shop: renderShop,
  market: renderMarket,
  tasks: renderTasks,
  items: renderItems,
  legal: renderLegal,
};
