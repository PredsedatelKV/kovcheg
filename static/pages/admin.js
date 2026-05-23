import { get, post, patch, del, iconHtml, productImg, uploadImage } from "/static/api.js?v=30";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function slugify(s = "") {
  return s
    .toLowerCase()
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

const SECTIONS = [
  { id: "users", label: "Игроки", icon: "/static/img/tabs/users.svg" },
  { id: "news", label: "Новости", icon: "/static/img/ui/mail.svg" },
  { id: "banners", label: "Карусель", icon: "/static/img/ui/castle.svg" },
  { id: "wheel", label: "Колесо", icon: "/static/img/ui/wheel.svg" },
  { id: "shop", label: "Магазин", icon: "/static/img/tabs/shop.svg" },
  { id: "market", label: "Рынок", icon: "/static/img/shop.svg" },
  { id: "tasks", label: "Задания", icon: "/static/img/tasks/scroll.svg" },
  { id: "quizzes", label: "Тесты", icon: "/static/img/ui/quiz.svg" },
  { id: "items", label: "Предметы", icon: "/static/img/ui/box.svg" },
  { id: "legal", label: "Тексты", icon: "/static/img/ui/legal.svg" },
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
      <div class="hero-head"><img src="/static/img/admin_emblem.svg" alt="" class="hero-img-head"/></div>
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
        `<option value="${i.id}" ${selectedId === i.id ? "selected" : ""}>${escapeHtml(i.name)}</option>`,
    )
    .join("");
}

function userOptions(selectedId = null) {
  return META.users
    .map(
      (u) =>
        `<option value="${u.id}" ${selectedId === u.id ? "selected" : ""}>${escapeHtml(u.first_name)}</option>`,
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
      <div class="admin-sub">TG ${u.telegram_id} · <img src="/static/img/ui/coin.svg" alt="" class="icon icon-sm inline-coin"/> ${u.balance} Ковбаксов</div>
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
        <input class="input input-sm" data-k="delta" type="number" placeholder="±Ковбаксы" style="max-width:120px"/>
        <input class="input input-sm" data-k="note" placeholder="комментарий" style="flex:1; min-width:120px"/>
        <button class="btn btn-sm" data-action="balance" data-id="${u.id}">Применить</button>
      </div>
      <hr class="admin-sep"/>
      <div class="row gap wrap">
        <select class="input input-sm" data-k="item" style="flex:1; min-width:160px">${itemOptions()}</select>
        <input class="input input-sm" data-k="invdelta" type="number" placeholder="±шт" style="max-width:100px"/>
        <button class="btn btn-sm" data-action="inv" data-id="${u.id}">В инвентарь</button>
      </div>
      <hr class="admin-sep"/>
      <div class="row gap">
        <button class="btn btn-sm" data-action="view-inv" data-id="${u.id}">Инвентарь</button>
      </div>
      <div class="user-inv-list" data-user-id="${u.id}" style="display:none"></div>
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
  body.querySelectorAll('[data-action="view-inv"]').forEach((b) =>
    b.addEventListener("click", async () => {
      const userId = b.dataset.id;
      const listEl = body.querySelector(`.user-inv-list[data-user-id="${userId}"]`);
      if (listEl.style.display === "block") {
        listEl.style.display = "none";
        return;
      }
      listEl.style.display = "block";
      listEl.innerHTML = `<div class="admin-sub">Загрузка…</div>`;
      try {
        const inv = await get(`/api/admin/users/${userId}/inventory`);
        if (inv.length === 0) {
          listEl.innerHTML = `<div class="admin-sub">Инвентарь пуст</div>`;
          return;
        }
        listEl.innerHTML = inv.map((r) => `
          <div class="admin-inv-row" data-inv-id="${r.id}">
            <img src="${escapeHtml(r.item.image_url || r.item.icon)}" alt="" class="icon icon-sm"/>
            <span>${escapeHtml(r.item.name)} × ${r.quantity}</span>
            <button class="btn btn-sm btn-danger" data-action="remove-inv" data-user-id="${userId}" data-inv-id="${r.id}">Удалить</button>
          </div>
        `).join("");
        listEl.querySelectorAll('[data-action="remove-inv"]').forEach((btn) => {
          btn.addEventListener("click", async () => {
            const uid = btn.dataset.userId;
            const iid = btn.dataset.invId;
            confirmAction("Удалить из инвентаря?", async () => {
              try {
                await del(`/api/admin/users/${uid}/inventory/${iid}`);
                window.kov.toast("Удалено");
                btn.closest(".admin-inv-row").remove();
                if (listEl.querySelectorAll(".admin-inv-row").length === 0) {
                  listEl.innerHTML = `<div class="admin-sub">Инвентарь пуст</div>`;
                }
              } catch (err) {
                window.kov.toast(err.message);
              }
            });
          });
        });
      } catch (err) {
        listEl.innerHTML = `<div class="admin-sub">Ошибка: ${escapeHtml(err.message)}</div>`;
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
        photoField("Фото", "JPG/PNG/WebP до 5 МБ", null, "image_url"),
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
          photoField("Фото", "JPG/PNG/WebP до 5 МБ", n.image_url, "image_url"),
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
  bindPhotoUploader(body);
  body.querySelector("#n-create").addEventListener("click", async () => {
    const photoEl = body.querySelector('.photo-uploader[data-photo-key="image_url"] .photo-value');
    const photoVal = photoEl ? photoEl.value : null;
    const payload = {
      title: body.querySelector("#n-title").value.trim(),
      image_url: photoVal,
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
      const photoEl = card.querySelector('.photo-uploader[data-photo-key="image_url"] .photo-value');
      const photoVal = photoEl ? photoEl.value : null;
      const payload = {
        title: card.querySelector('[data-k="title"]').value,
        image_url: photoVal,
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
        photoField("Фото 16:9", "JPG/PNG/WebP до 5 МБ", null, "image_url"),
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
          photoField("Фото 16:9", "JPG/PNG/WebP до 5 МБ", b.image_url, "image_url"),
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
  bindPhotoUploader(body);
  body.querySelector("#b-create").addEventListener("click", async () => {
    const photoEl = body.querySelector('.photo-uploader[data-photo-key="image_url"] .photo-value');
    const photoVal = photoEl ? photoEl.value : null;
    const payload = {
      image_url: photoVal,
      title: body.querySelector("#b-title").value.trim(),
      sort_order: Number(body.querySelector("#b-order").value) || 0,
      is_active: true,
    };
    if (!payload.image_url) return window.kov.toast("Загрузи фото");
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
      const photoEl = card.querySelector('.photo-uploader[data-photo-key="image_url"] .photo-value');
      const photoVal = photoEl ? photoEl.value : null;
      const payload = {
        image_url: photoVal,
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
            <option value="coins">Ковбаксы</option>
            <option value="item">предмет</option>
          </select>`,
        ),
        field("Значение (Ковбаксов)", `<input class="input" id="w-value" type="number" value="0"/>`),
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
              <option value="coins" ${p.kind === "coins" ? "selected" : ""}>Ковбаксы</option>
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
        field("В наличии (−1 = безлимит)", `<input class="input" id="s-stock" type="number" min="-1" value="-1"/>`),
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
          field("В наличии (−1 = безлимит)", `<input class="input" data-k="stock" type="number" min="-1" value="${p.stock ?? -1}"/>`),
        )}
        <div class="admin-sub">${p.stock === -1 ? "Безлимит" : p.stock === 0 ? "Закончился" : `Осталось: ${p.stock}`}</div>
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
      stock: Number(body.querySelector("#s-stock").value),
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
        stock: Number(card.querySelector('[data-k="stock"]').value),
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
        <div class="admin-sub">Продаёт: ${escapeHtml(l.seller_name)}${l.target_user_name ? ` → ${escapeHtml(l.target_user_name)}` : ""} · ${l.quantity} шт · <img src="/static/img/ui/coin.svg" alt="" class="icon icon-sm inline-coin"/> ${l.price}</div>
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
  const userTasks = await get("/api/admin/tasks/user");
  body.innerHTML = `
    ${cardBlock(
      "Новое задание / план",
      formGrid(
        field("Название", `<input class="input" id="t-name"/>`),
        field("Описание", `<textarea class="input" id="t-desc" rows="3"></textarea>`),
        field("Награда (Ковбаксов)", `<input class="input" id="t-reward" type="number" value="10"/>`),
        field("Цель", `<input class="input" id="t-target" type="number" value="1"/>`),
        field("Тип", `<select class="input" id="t-plan"><option value="0">Задание</option><option value="1">Ежедневный план</option></select>`),
      ) + `<button class="btn btn-sm" id="t-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (t) => `
      <div class="admin-card" data-id="${t.id}">
        <h3 class="admin-card-title">${escapeHtml(t.name)} ${t.is_daily_plan ? '<span class="admin-badge">план</span>' : ""}</h3>
        ${formGrid(
          field("Название", `<input class="input" data-k="name" value="${escapeHtml(t.name)}"/>`),
          field("Описание", `<textarea class="input" data-k="description" rows="3">${escapeHtml(t.description || "")}</textarea>`),
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
    <h3 class="admin-section-label">Задания игроков</h3>
    ${userTasks.length === 0
      ? `<div class="admin-sub" style="padding:8px 0">Нет активных заданий</div>`
      : userTasks
          .map(
            (ut) => `
        <div class="admin-card admin-card-user-task" data-ut-id="${ut.id}">
          <div class="admin-card-header">
            <div>
              <h3 class="admin-card-title">${escapeHtml(ut.task.name)}</h3>
              <div class="admin-sub">Игрок: <strong>${escapeHtml(ut.user_name)}</strong> · Статус: <span class="task-status task-status-${ut.status}">${statusLabel(ut.status)}</span></div>
              <div class="admin-sub">Начато: ${formatDate(ut.started_at)}${ut.finished_at ? ` · Завершено: ${formatDate(ut.finished_at)}` : ""}</div>
            </div>
          </div>
          ${ut.status === "in_progress"
            ? `<div class="row gap">
                <button class="btn btn-sm btn-success" data-action="approve-ut">Подтвердить выполнение</button>
              </div>`
            : ""}
        </div>`,
          )
          .join("")}
  `;
  body.querySelector("#t-create").addEventListener("click", async () => {
    const payload = {
      name: body.querySelector("#t-name").value.trim(),
      description: body.querySelector("#t-desc").value,
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
  body.querySelectorAll('[data-action="approve-ut"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".admin-card-user-task");
      const utId = card.dataset.utId;
      try {
        await post(`/api/admin/tasks/user/${utId}/approve`);
        window.kov.toast("Задание подтверждено");
        renderTasks(body);
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
  });
}

function statusLabel(status) {
  if (status === "in_progress") return "В процессе";
  if (status === "done") return "Выполнено";
  if (status === "cancelled") return "Отменено";
  return status;
}

function formatDate(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------- ITEMS ----------
function photoField(label, hint, currentUrl, key = "image_url") {
  const preview = currentUrl
    ? `<img src="${escapeHtml(currentUrl)}" alt=""/>`
    : `<span class="photo-empty">Нет фото</span>`;
  return `
    <label class="admin-field admin-field-photo">
      <span>${escapeHtml(label)}</span>
      <div class="photo-uploader" data-photo-key="${escapeHtml(key)}">
        <div class="photo-preview">${preview}</div>
        <div class="photo-controls">
          <input type="file" accept="image/*" class="photo-input" hidden/>
          <button type="button" class="btn btn-secondary btn-sm photo-pick">Загрузить фото</button>
          ${currentUrl ? `<button type="button" class="btn btn-danger btn-sm photo-clear">Убрать</button>` : ""}
          <input type="hidden" class="photo-value" value="${escapeHtml(currentUrl || "")}"/>
        </div>
        ${hint ? `<small class="photo-hint">${escapeHtml(hint)}</small>` : ""}
      </div>
    </label>
  `;
}

function bindPhotoUploader(scope) {
  scope.querySelectorAll(".photo-uploader").forEach((widget) => {
    const fileInput = widget.querySelector(".photo-input");
    const pickBtn = widget.querySelector(".photo-pick");
    const clearBtn = widget.querySelector(".photo-clear");
    const valueInput = widget.querySelector(".photo-value");
    const preview = widget.querySelector(".photo-preview");
    if (pickBtn) pickBtn.addEventListener("click", () => fileInput.click());
    if (fileInput) fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      pickBtn.disabled = true;
      pickBtn.textContent = "Загрузка…";
      try {
        const res = await uploadImage(file);
        valueInput.value = res.url;
        preview.innerHTML = `<img src="${res.url}" alt=""/>`;
        let resetBtn = widget.querySelector(".photo-clear");
        if (!resetBtn) {
          resetBtn = document.createElement("button");
          resetBtn.type = "button";
          resetBtn.className = "btn btn-danger btn-sm photo-clear";
          resetBtn.textContent = "Убрать";
          pickBtn.after(resetBtn);
          resetBtn.addEventListener("click", clearHandler);
        }
        window.kov.toast("Фото загружено");
      } catch (err) {
        window.kov.toast(err.message || "Не удалось загрузить");
      } finally {
        pickBtn.disabled = false;
        pickBtn.textContent = "Загрузить фото";
        fileInput.value = "";
      }
    });
    function clearHandler() {
      valueInput.value = "";
      preview.innerHTML = `<span class="photo-empty">Нет фото</span>`;
      const cb = widget.querySelector(".photo-clear");
      if (cb) cb.remove();
    }
    if (clearBtn) clearBtn.addEventListener("click", clearHandler);
  });
}

function readItemForm(card, fallback = {}) {
  const get = (k) => {
    const el = card.querySelector(`[data-k="${k}"]`);
    return el ? el.value : (fallback[k] || "");
  };
  return {
    name: get("name"),
    icon: get("icon"),
    image_url: (() => {
      const el = card.querySelector('.photo-uploader[data-photo-key="image_url"] .photo-value');
      return el ? el.value : null;
    })(),
    description: get("description"),
    category: get("category") || "Ресурсы",
  };
}

async function renderItems(body) {
  const rows = await get("/api/admin/items");
  body.innerHTML = `
    ${cardBlock(
      "Новый предмет",
      formGrid(
        field("Название", `<input class="input" id="i-name"/>`),
        photoField("Фото товара", "JPG/PNG/WebP до 5 МБ — покажется в Магазине и инвентаре", null, "image_url"),
        field("Иконка (fallback)", `<input class="input" id="i-icon" value="/static/img/ui/box.svg"/>`),
        field("Описание", `<textarea class="input" id="i-desc" rows="2"></textarea>`),
        field("Категория", `<input class="input" id="i-cat" value="Ресурсы"/>`),
      ) + `<button class="btn btn-sm" id="i-create">Добавить</button>`,
    )}
    ${rows
      .map(
        (i) => `
      <div class="admin-card admin-card-item" data-id="${i.id}">
        <div class="admin-card-header">
          ${productImg(i, "md")}
          <div>
            <h3 class="admin-card-title">${escapeHtml(i.name)}</h3>
            <div class="admin-badges"><span class="admin-badge">${escapeHtml(i.category)}</span></div>
          </div>
        </div>
        ${formGrid(
          field("Название", `<input class="input" data-k="name" value="${escapeHtml(i.name)}"/>`),
          photoField("Фото товара", "JPG/PNG/WebP до 5 МБ", i.image_url, "image_url"),
          field("Иконка (fallback)", `<input class="input" data-k="icon" value="${escapeHtml(i.icon)}"/>`),
          field("Описание", `<textarea class="input" data-k="description" rows="2">${escapeHtml(i.description || "")}</textarea>`),
          field("Категория", `<input class="input" data-k="category" value="${escapeHtml(i.category)}"/>`),
        )}
        <div class="row gap">
          <button class="btn btn-sm" data-action="save">Сохранить</button>
          <button class="btn btn-sm btn-danger" data-action="delete">Удалить</button>
        </div>
      </div>`,
      )
      .join("")}
  `;
  bindPhotoUploader(body);
  body.querySelector("#i-create").addEventListener("click", async () => {
    const newCard = body.querySelector(".admin-card");  // first card = the "new item" form
    const photoEl = newCard.querySelector('.photo-uploader[data-photo-key="image_url"] .photo-value');
    const photoVal = photoEl ? photoEl.value : null;
    const nameVal = body.querySelector("#i-name").value.trim();
    const slug = slugify(nameVal);
    const payload = {
      code: slug || `item_${Date.now()}`,
      name: nameVal,
      icon: body.querySelector("#i-icon").value.trim(),
      image_url: photoVal,
      description: body.querySelector("#i-desc").value,
      category: body.querySelector("#i-cat").value || "Ресурсы",
      rarity: "Обычный",
      can_gift: true,
      can_activate: false,
    };
    if (!payload.name) return window.kov.toast("Название обязательно");
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
      const form = readItemForm(card, orig);
      const payload = {
        code: orig.code,
        name: form.name,
        icon: form.icon,
        image_url: form.image_url,
        description: form.description,
        category: form.category,
        rarity: orig.rarity || "Обычный",
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
    card.querySelector('[data-action="delete"]').addEventListener("click", () =>
      confirmAction("Удалить предмет?", async () => {
        try {
          await del(`/api/admin/items/${id}`);
          window.kov.toast("Предмет удалён");
          renderItems(body);
        } catch (err) {
          window.kov.toast(err.message);
        }
      }),
    );
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

// ---------- QUIZZES ----------
async function renderQuizzes(body) {
  const rows = await get("/api/admin/quizzes");
  body.innerHTML = `
    ${cardBlock(
      "Новый тест",
      formGrid(
        field("Название", `<input class="input" id="q-title"/>`),
        field("Описание", `<textarea class="input" id="q-desc" rows="2"></textarea>`),
        field("Тип приза", `<select class="input" id="q-prize-kind"><option value="coins">Ковбаксы</option><option value="item">Предмет</option></select>`),
        field("Значение приза", `<input class="input" id="q-prize-value" type="number" value="0"/>`),
        field("Код предмета (если предмет)", `<input class="input" id="q-prize-item"/>`),
        field("Название приза (для отображения)", `<input class="input" id="q-prize-label"/>`),
        field("Порог 'Хорошо' (правильных ответов)", `<input class="input" id="q-threshold-good" type="number" value="5"/>`),
        field("Порог 'Отлично' (правильных ответов)", `<input class="input" id="q-threshold-excellent" type="number" value="8"/>`),
      ) + `<button class="btn btn-sm" id="q-create">Создать тест</button>`,
    )}
    ${rows
      .map(
        (q) => `
      <div class="admin-card" data-id="${q.id}">
        <h3 class="admin-card-title">${escapeHtml(q.title)} ${q.is_active ? '<span class="admin-badge">активен</span>' : ""}</h3>
        <div class="admin-sub">Приз: ${escapeHtml(q.prize_label)} · Хорошо: ${q.threshold_good}+ · Отлично: ${q.threshold_excellent}+ · Вопросов: ${q.questions.length}</div>
        <div class="row gap">
          <button class="btn btn-sm" data-action="edit-quiz">Редактировать</button>
          <button class="btn btn-sm" data-action="view-attempts">Попытки</button>
          <button class="btn btn-sm btn-danger" data-action="delete-quiz">Удалить</button>
        </div>
        <div class="quiz-questions-list" data-quiz-id="${q.id}" style="display:none">
          <hr class="admin-sep"/>
          <h4>Вопросы</h4>
          ${q.questions.map(
            (qq) => `
            <div class="admin-card admin-card-question" data-qid="${qq.id}">
              <div class="admin-sub"><strong>${escapeHtml(qq.text)}</strong></div>
              <div class="admin-sub">A: ${escapeHtml(qq.option_a)} | B: ${escapeHtml(qq.option_b)} | C: ${escapeHtml(qq.option_c)} | D: ${escapeHtml(qq.option_d)}</div>
              <div class="admin-sub">Правильный: <strong>${qq.correct_option.toUpperCase()}</strong></div>
              <div class="row gap">
                <button class="btn btn-sm" data-action="edit-question" data-qid="${qq.id}">Изменить</button>
                <button class="btn btn-sm btn-danger" data-action="delete-question" data-qid="${qq.id}">Удалить</button>
              </div>
            </div>
          `).join("")}
          ${q.questions.length < 10 ? `<button class="btn btn-sm" data-action="add-question" data-quiz-id="${q.id}">+ Добавить вопрос</button>` : ""}
        </div>
      </div>`,
      )
      .join("")}
  `;

  body.querySelector("#q-create").addEventListener("click", async () => {
    const payload = {
      title: body.querySelector("#q-title").value.trim(),
      description: body.querySelector("#q-desc").value,
      prize_kind: body.querySelector("#q-prize-kind").value,
      prize_value: Number(body.querySelector("#q-prize-value").value) || 0,
      prize_item_code: body.querySelector("#q-prize-item").value.trim() || null,
      prize_label: body.querySelector("#q-prize-label").value.trim(),
      threshold_good: Number(body.querySelector("#q-threshold-good").value) || 5,
      threshold_excellent: Number(body.querySelector("#q-threshold-excellent").value) || 8,
      is_active: true,
    };
    if (!payload.title) return window.kov.toast("Название обязательно");
    try {
      await post("/api/admin/quizzes", payload);
      window.kov.toast("Тест создан");
      renderQuizzes(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });

  body.querySelectorAll('[data-action="edit-quiz"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".admin-card");
      const id = card.dataset.id;
      const quiz = rows.find((r) => r.id === Number(id));
      if (!quiz) return;
      const qList = card.querySelector(".quiz-questions-list");
      qList.style.display = qList.style.display === "none" ? "block" : "none";
    });
  });

  body.querySelectorAll('[data-action="add-question"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const quizId = btn.dataset.quizId;
      openQuestionEditor(body, Number(quizId), null);
    });
  });

  body.querySelectorAll('[data-action="edit-question"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const qid = Number(btn.dataset.qid);
      const card = btn.closest(".admin-card");
      const quizId = Number(card.dataset.id);
      const quiz = rows.find((r) => r.id === quizId);
      const qq = quiz?.questions.find((q) => q.id === qid);
      if (!qq) return;
      openQuestionEditor(body, quizId, qq);
    });
  });

  body.querySelectorAll('[data-action="delete-question"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const qid = btn.dataset.qid;
      const card = btn.closest(".admin-card");
      const quizId = card.dataset.id;
      confirmAction("Удалить вопрос?", async () => {
        try {
          await del(`/api/admin/quizzes/${quizId}/questions/${qid}`);
          window.kov.toast("Вопрос удалён");
          renderQuizzes(body);
        } catch (err) {
          window.kov.toast(err.message);
        }
      });
    });
  });

  body.querySelectorAll('[data-action="delete-quiz"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".admin-card");
      const id = card.dataset.id;
      confirmAction("Удалить тест?", async () => {
        try {
          await del(`/api/admin/quizzes/${id}`);
          window.kov.toast("Тест удалён");
          renderQuizzes(body);
        } catch (err) {
          window.kov.toast(err.message);
        }
      });
    });
  });

  body.querySelectorAll('[data-action="view-attempts"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".admin-card");
      const id = card.dataset.id;
      const quiz = rows.find((r) => r.id === Number(id));
      const attempts = await get(`/api/admin/quizzes/${id}/attempts`);
      const meta = await get("/api/admin/meta");
      const userMap = {};
      meta.users.forEach((u) => { userMap[u.id] = u.first_name; });
      const gradeLabels = { bad: "Плохо", good: "Хорошо", excellent: "Отлично" };
      const html = attempts.map((a) => `
        <div class="admin-card">
          <div class="admin-sub"><strong>${escapeHtml(userMap[a.user_id] || "ID:" + a.user_id)}</strong> · ${gradeLabels[a.grade] || a.grade} · ${a.score}/${a.total} · ${formatDate(a.created_at)} ${a.prize_awarded ? "· ✅ Приз выдан" : "· ❌ Без приза"}</div>
        </div>
      `).join("");
      card.insertAdjacentHTML("afterend", `<div class="admin-card"><h3 class="admin-card-title">Попытки: ${escapeHtml(quiz?.title || "")}</h3>${html || "<div class='admin-sub'>Нет попыток</div>"}</div>`);
    });
  });
}

function openQuestionEditor(body, quizId, existing) {
  const isEdit = !!existing;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <button class="close" onclick="this.closest('.modal-overlay').remove()">×</button>
      <h3>${isEdit ? "Изменить" : "Добавить"} вопрос</h3>
      ${formGrid(
        field("Текст вопроса", `<input class="input" id="eq-text" value="${escapeHtml(existing?.text || "")}"/>`),
        field("Вариант A", `<input class="input" id="eq-a" value="${escapeHtml(existing?.option_a || "")}"/>`),
        field("Вариант B", `<input class="input" id="eq-b" value="${escapeHtml(existing?.option_b || "")}"/>`),
        field("Вариант C", `<input class="input" id="eq-c" value="${escapeHtml(existing?.option_c || "")}"/>`),
        field("Вариант D", `<input class="input" id="eq-d" value="${escapeHtml(existing?.option_d || "")}"/>`),
        field("Правильный", `<select class="input" id="eq-correct">
          <option value="a" ${existing?.correct_option === "a" ? "selected" : ""}>A</option>
          <option value="b" ${existing?.correct_option === "b" ? "selected" : ""}>B</option>
          <option value="c" ${existing?.correct_option === "c" ? "selected" : ""}>C</option>
          <option value="d" ${existing?.correct_option === "d" ? "selected" : ""}>D</option>
        </select>`),
      )}
      <div class="row gap">
        <button class="btn btn-sm" id="eq-save">Сохранить</button>
        <button class="btn btn-sm btn-secondary" id="eq-cancel">Отмена</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#eq-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector("#eq-save").addEventListener("click", async () => {
    const payload = {
      text: overlay.querySelector("#eq-text").value.trim(),
      option_a: overlay.querySelector("#eq-a").value.trim(),
      option_b: overlay.querySelector("#eq-b").value.trim(),
      option_c: overlay.querySelector("#eq-c").value.trim(),
      option_d: overlay.querySelector("#eq-d").value.trim(),
      correct_option: overlay.querySelector("#eq-correct").value,
      sort_order: 0,
    };
    if (!payload.text || !payload.option_a || !payload.option_b || !payload.option_c || !payload.option_d) {
      return window.kov.toast("Заполни все поля");
    }
    try {
      if (isEdit) {
        await patch(`/api/admin/quizzes/${quizId}/questions/${existing.id}`, payload);
        window.kov.toast("Вопрос обновлён");
      } else {
        await post(`/api/admin/quizzes/${quizId}/questions`, payload);
        window.kov.toast("Вопрос добавлен");
      }
      overlay.remove();
      renderQuizzes(body);
    } catch (err) {
      window.kov.toast(err.message);
    }
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
  quizzes: renderQuizzes,
  items: renderItems,
  legal: renderLegal,
};
