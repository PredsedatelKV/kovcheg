import { get, post, patch, del, iconHtml, productImg, uploadImage } from "/static/api.js?v=229";

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
  { id: "lootboxes", label: "Ковбоксы", icon: "/static/img/ui/lootbox.svg" },
  { id: "legal", label: "Тексты", icon: "/static/img/ui/legal.svg" },
  { id: "battlepass", label: "Пропуск", icon: "/static/img/tabs/battlepass.svg" },
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
      <div class="hero-art"><img src="/static/img/admin_hero.svg" alt="Админ" class="hero-img"/></div>
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

  // Возврат на «Главную» одним нажатием по иконке справа сверху.
  const heroArt = root.querySelector(".hero-art");
  if (heroArt) {
    heroArt.style.cursor = "pointer";
    heroArt.addEventListener("click", () => window.kov.setTab("home"));
  }

  const body = root.querySelector("#admin-body");
  root.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.section;
      localStorage.setItem("kovcheg.admin.section", id);
      activate(id, true);
    });
  });

  async function activate(id, refreshMeta = true) {
    root.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("active", b.dataset.section === id));
    if (!body.hasChildNodes()) body.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
    body.setAttribute("aria-busy", "true");
    try {
      if (refreshMeta) META = await get("/api/admin/meta");
      await SECTION_RENDERERS[id](body);
    } catch (err) {
      body.innerHTML = `<div class="card"><h3>Ошибка</h3><p>${escapeHtml(err.message)}</p></div>`;
    } finally {
      body.removeAttribute("aria-busy");
    }
  }

  activate(initial, false);
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
      <div class="admin-sub">TG ${u.telegram_id} · <img src="/static/img/ui/coin.svg" alt="" class="icon icon-sm inline-coin"/> ${u.balance} Ковбаксов · <img src="/static/img/item_icons/xp.svg" alt="" class="icon icon-sm inline-coin"/> ${u.xp} XP</div>
      ${formGrid(
        field("Имя", `<input class="input" data-k="first_name" value="${escapeHtml(u.first_name)}"/>`),
        field("Должность", `<input class="input" data-k="role" value="${escapeHtml(u.role)}"/>`),
      )}
      <div class="row gap">
        <button class="btn btn-sm" data-action="save" data-id="${u.id}">Сохранить</button>
      </div>
      <hr class="admin-sep"/>
      <div class="row gap wrap">
        <input class="input input-sm" data-k="delta" type="text" placeholder="+N / -N / =N" style="max-width:140px"/>
        <input class="input input-sm" data-k="note" placeholder="комментарий" style="flex:1; min-width:120px"/>
        <button class="btn btn-sm" data-action="balance" data-id="${u.id}">Применить</button>
      </div>
      <hr class="admin-sep"/>
      <div class="row gap wrap">
        <input class="input input-sm" data-k="xpdelta" type="text" placeholder="+XP / -XP / =XP" style="max-width:140px" value="+10"/>
        <button class="btn btn-sm" data-action="xp-award" data-id="${u.id}">Дать XP</button>
        <button class="btn btn-sm btn-danger" data-action="reset-bp" data-id="${u.id}">Сброс пропуска</button>
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
      const raw = card.querySelector('[data-k="delta"]').value.trim();
      const note = card.querySelector('[data-k="note"]').value;
      if (!raw) return window.kov.toast("Укажи дельту");
      let mode = "add";
      let val = raw;
      if (raw.startsWith("=")) { mode = "set"; val = raw.slice(1); }
      else if (raw.startsWith("+")) { mode = "add"; val = raw.slice(1); }
      else if (raw.startsWith("-")) { mode = "sub"; val = raw.slice(1); }
      const delta = Number(val);
      if (!delta && delta !== 0) return window.kov.toast("Некорректное число");
      if (delta < 0) return window.kov.toast("Используй +N/-N/=N для указания операции");
      try {
        const result = await post(`/api/admin/users/${b.dataset.id}/balance`, { delta, note, mode });
        window.kov.toast("Баланс обновлён");
        if (window.kov.me && result && window.kov.me.id === result.id) {
          window.kov.me.balance = result.balance;
        }
        renderUsers(body);
      } catch (err) {
        window.kov.toast(err.message);
      }
    }),
  );
  body.querySelectorAll('[data-action="xp-award"]').forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".admin-card");
      const raw = card.querySelector('[data-k="xpdelta"]').value.trim();
      if (!raw) return window.kov.toast("Укажи XP");
      let mode = "add";
      let val = raw;
      if (raw.startsWith("=")) { mode = "set"; val = raw.slice(1); }
      else if (raw.startsWith("+")) { mode = "add"; val = raw.slice(1); }
      else if (raw.startsWith("-")) { mode = "sub"; val = raw.slice(1); }
      const amount = Number(val);
      if (!amount && amount !== 0) return window.kov.toast("Некорректное число");
      if (amount < 0) return window.kov.toast("Используй +N/-N/=N для указания операции");
      try {
        const result = await post("/api/battlepass/award-xp", { user_id: Number(b.dataset.id), amount, mode });
        const label = mode === "add" ? "+" : mode === "sub" ? "-" : "=";
        window.kov.toast(`XP: ${label}${amount} (всего ${result.xp})`);
        renderUsers(body);
      } catch (err) {
        window.kov.toast(err.message);
      }
    }),
  );
  body.querySelectorAll('[data-action="reset-bp"]').forEach((b) =>
    b.addEventListener("click", async () => {
      confirmAction("Сбросить пропуск игроку? Премиум и XP будут удалены.", async () => {
        try {
          await post("/api/admin/battlepass/reset/" + b.dataset.id);
          window.kov.toast("Пропуск сброшен");
          renderUsers(body);
        } catch (err) {
          window.kov.toast(err.message);
        }
      });
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
            <option value="xp">XP</option>
            <option value="item">Предмет</option>
            <option value="nothing">Ничего</option>
          </select>`,
        ),
        field("Количество", `<input class="input" id="w-value" type="number" value="0"/>`),
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
              <option value="xp" ${p.kind === "xp" ? "selected" : ""}>XP</option>
              <option value="item" ${p.kind === "item" ? "selected" : ""}>Предмет</option>
              <option value="nothing" ${p.kind === "nothing" ? "selected" : ""}>Ничего</option>
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
    const kind = body.querySelector("#w-kind").value;
    const value = Number(body.querySelector("#w-value").value) || 0;
    const itemCode = body.querySelector("#w-item").value || null;
    if (kind === "item" && !itemCode) return window.kov.toast("Выберите предмет");
    // Подпись необязательна — генерируем из типа и количества, если не задана.
    let label = body.querySelector("#w-label").value.trim();
    if (!label) {
      if (kind === "coins") label = value + " Ковбаксов";
      else if (kind === "xp") label = value + " XP";
      else if (kind === "item") {
        const it = META.items.find((i) => i.code === itemCode);
        label = it ? it.name : "Предмет";
      } else label = "Ничего";
    }
    const payload = {
      label,
      kind,
      value,
      item_code: kind === "item" ? itemCode : null,
      icon: body.querySelector("#w-icon").value.trim(),
      weight: Number(body.querySelector("#w-weight").value) || 10,
      sort_order: 0,
      is_active: true,
    };
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
        item_code: card.querySelector('[data-k="kind"]').value === "item" ? (card.querySelector('[data-k="item_code"]').value || null) : null,
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
        field("Цена", `<input class="input" id="s-price" type="number" min="1" value="100"/>`),
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
          field("Цена", `<input class="input" data-k="price" type="number" min="1" value="${p.price}"/>`),
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
    ${cardBlock("Рынок", '<div class="admin-sub">Рынок доступен только для просмотра. Активный лот создаётся и снимается игроком: сервер резервирует или возвращает предмет атомарно.</div>')}
    ${rows
      .map(
        (l) => `
      <div class="admin-card" data-id="${l.id}">
        <h3 class="admin-card-title"><img src="${escapeHtml(l.item.icon)}" class="icon icon-sm" alt=""/> ${escapeHtml(l.item.name)}</h3>
        <div class="admin-sub">Продаёт: ${escapeHtml(l.seller_name)}${l.target_user_name ? ` → ${escapeHtml(l.target_user_name)}` : ""} · ${l.quantity} шт · <img src="/static/img/ui/coin.svg" alt="" class="icon icon-sm inline-coin"/> ${l.price}</div>
      </div>`,
      )
      .join("")}
  `;
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
        field("Награда (XP)", `<input class="input" id="t-xp-reward" type="number" min="0" value="0"/>`),
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
          field("Награда XP", `<input class="input" data-k="xp_reward" type="number" min="0" value="${t.xp_reward || 0}"/>`),
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
      xp_reward: Number(body.querySelector("#t-xp-reward").value) || 0,
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
        xp_reward: Number(card.querySelector('[data-k="xp_reward"]').value) || 0,
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
        field("Значение приза", `<input class="input" id="q-prize-value" type="number" min="1" value="1"/>`),
        field("Код предмета (если предмет)", `<input class="input" id="q-prize-item"/>`),
        field("Название приза (для отображения)", `<input class="input" id="q-prize-label"/>`),
        field("Порог 'Хорошо' (правильных ответов)", `<input class="input" id="q-threshold-good" type="number" min="1" value="1"/>`),
        field("Порог 'Отлично' (правильных ответов)", `<input class="input" id="q-threshold-excellent" type="number" min="1" value="1"/>`),
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
          <button class="btn btn-sm btn-secondary" data-action="toggle-quiz">${q.is_active ? "Отключить" : "Активировать"}</button>
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
      prize_value: Number(body.querySelector("#q-prize-value").value) || 1,
      prize_item_code: body.querySelector("#q-prize-item").value.trim() || null,
      prize_label: body.querySelector("#q-prize-label").value.trim(),
      threshold_good: Number(body.querySelector("#q-threshold-good").value) || 5,
      threshold_excellent: Number(body.querySelector("#q-threshold-excellent").value) || 8,
      is_active: false,
    };
    if (!payload.title) return window.kov.toast("Название обязательно");
    try {
      await post("/api/admin/quizzes", payload);
      window.kov.toast("Черновик теста создан — добавьте вопросы и активируйте его");
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

  body.querySelectorAll('[data-action="toggle-quiz"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const card = btn.closest(".admin-card");
      const quiz = rows.find((row) => row.id === Number(card.dataset.id));
      if (!quiz) return;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = quiz.is_active ? "Отключаем…" : "Проверяем…";
      try {
        await patch(`/api/admin/quizzes/${quiz.id}`, {
          title: quiz.title,
          description: quiz.description || "",
          is_active: !quiz.is_active,
          prize_kind: quiz.prize_kind,
          prize_value: quiz.prize_value,
          prize_item_code: quiz.prize_item_code || null,
          prize_label: quiz.prize_label || "",
          threshold_good: quiz.threshold_good,
          threshold_excellent: quiz.threshold_excellent,
        });
        window.kov.toast(quiz.is_active ? "Тест отключён" : "Тест активирован");
        renderQuizzes(body);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = originalText;
        window.kov.toast(err.message);
      }
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
      // Идемпотентность: повторный клик не плодит карточки, а тогглит уже открытую.
      const existing = card.nextElementSibling;
      if (existing && existing.classList.contains("quiz-attempts-card") && existing.dataset.quizId === String(id)) {
        existing.remove();
        return;
      }
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
      // Удаляем любую ранее открытую карточку попыток для этого теста перед вставкой свежей.
      const prev = card.nextElementSibling;
      if (prev && prev.classList.contains("quiz-attempts-card") && prev.dataset.quizId === String(id)) {
        prev.remove();
      }
      card.insertAdjacentHTML("afterend", `<div class="admin-card quiz-attempts-card" data-quiz-id="${id}"><h3 class="admin-card-title">Попытки: ${escapeHtml(quiz?.title || "")}</h3>${html || "<div class='admin-sub'>Нет попыток</div>"}</div>`);
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

// ---------- KOVBOX EDITOR ----------
const LOOTBOX_RARITIES = ["Обычный", "Редкий", "Эпический", "Легендарный"];
const LOOTBOX_REWARD_LABELS = {
  item: "Предмет",
  kovbucks: "Ковбаксы",
  kovcoins: "Ковкойны",
  xp: "XP",
};

function lootboxDateValue(value) {
  if (!value) return "";
  // API stores naive UTC in SQLite.  Explicitly add Z so Moscow/local browser
  // time is displayed correctly and round-trips back through toISOString().
  const source = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + "Z";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function lootboxEntryTemplate(entry = {}) {
  const kind = entry.reward_kind || "item";
  const itemChoices = META.items
    .filter((item) => !item.lootbox_pool_code)
    .map((item) => `<option value="${item.id}" ${Number(entry.item_id) === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
  return `
    <div class="admin-card lootbox-entry" style="margin:8px 0;padding:10px">
      <div class="admin-form-grid">
        ${field("Тип", `<select class="input lb-entry-kind">${Object.entries(LOOTBOX_REWARD_LABELS).map(([value, label]) => `<option value="${value}" ${kind === value ? "selected" : ""}>${label}</option>`).join("")}</select>`)}
        ${field("Предмет", `<select class="input lb-entry-item"><option value="">—</option>${itemChoices}</select>`)}
        ${field("Мин.", `<input class="input lb-entry-min" type="number" min="1" max="1000000" value="${entry.amount_min || 1}"/>`)}
        ${field("Макс.", `<input class="input lb-entry-max" type="number" min="1" max="1000000" value="${entry.amount_max || 1}"/>`)}
        ${field("Вес", `<input class="input lb-entry-weight" type="number" min="1" max="1000000" value="${entry.weight || 10}"/>`)}
        ${field("Порядок", `<input class="input lb-entry-order" type="number" value="${entry.sort_order || 0}"/>`)}
        ${field("Гарантированно", `<select class="input lb-entry-guaranteed"><option value="false" ${!entry.is_guaranteed ? "selected" : ""}>Нет</option><option value="true" ${entry.is_guaranteed ? "selected" : ""}>Да</option></select>`)}
        ${field("Активна", `<select class="input lb-entry-active"><option value="true" ${entry.is_active !== false ? "selected" : ""}>Да</option><option value="false" ${entry.is_active === false ? "selected" : ""}>Нет</option></select>`)}
      </div>
      <div class="row gap"><span class="admin-sub lb-entry-percent">—</span><button class="btn btn-sm btn-danger lb-entry-remove" type="button">Удалить строку</button></div>
    </div>`;
}

function collectLootboxEntry(row) {
  const kind = row.querySelector(".lb-entry-kind").value;
  return {
    reward_kind: kind,
    item_id: kind === "item" ? Number(row.querySelector(".lb-entry-item").value) || null : null,
    amount_min: Number(row.querySelector(".lb-entry-min").value),
    amount_max: Number(row.querySelector(".lb-entry-max").value),
    weight: Number(row.querySelector(".lb-entry-weight").value),
    is_guaranteed: row.querySelector(".lb-entry-guaranteed").value === "true",
    is_active: row.querySelector(".lb-entry-active").value === "true",
    sort_order: Number(row.querySelector(".lb-entry-order").value) || 0,
  };
}

function refreshLootboxProbabilities(overlay) {
  const rows = Array.from(overlay.querySelectorAll(".lootbox-entry"));
  const random = rows.map((row) => ({ row, entry: collectLootboxEntry(row) }))
    .filter(({ entry }) => entry.is_active && !entry.is_guaranteed && Number.isFinite(entry.weight) && entry.weight > 0);
  const guaranteed = rows.map((row) => ({ row, entry: collectLootboxEntry(row) }))
    .filter(({ entry }) => entry.is_active && entry.is_guaranteed && Number.isFinite(entry.weight) && entry.weight > 0);
  const total = random.reduce((sum, value) => sum + value.entry.weight, 0);
  const guaranteedTotal = guaranteed.reduce((sum, value) => sum + value.entry.weight, 0);
  rows.forEach((row) => {
    const entry = collectLootboxEntry(row);
    const itemField = row.querySelector(".lb-entry-item").closest(".admin-field");
    itemField.style.display = entry.reward_kind === "item" ? "" : "none";
    const denominator = entry.is_guaranteed ? guaranteedTotal : total;
    row.querySelector(".lb-entry-percent").textContent = entry.is_active && denominator > 0
      ? `${entry.is_guaranteed ? "Шанс в гарантированном слоте" : "Нормализованный шанс"}: ${(entry.weight / denominator * 100).toFixed(2)}%`
      : "Не участвует в розыгрыше";
  });
  const totalEl = overlay.querySelector("#lb-weight-total");
  if (totalEl) totalEl.textContent = `Сумма активных случайных весов: ${total}`;
}

function validateLootboxPayload(payload) {
  if (!payload.code || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(payload.code)) return "Внутренний ID: 2–64 символа, латиница, цифры, _ или -";
  if (!payload.name) return "Название обязательно";
  if (!payload.image_url) return "Укажите ассет ковбокса";
  if (payload.sale_price != null && (!Number.isInteger(payload.sale_price) || payload.sale_price < 1 || payload.sale_price > 1000000000)) return "Цена продажи должна быть целым числом от 1 до 1 000 000 000";
  const active = payload.entries.filter((entry) => entry.is_active);
  if (payload.is_active && active.length === 0) return "Активный ковбокс не может быть пустым";
  for (const entry of payload.entries) {
    const numbers = [entry.amount_min, entry.amount_max, entry.weight, entry.sort_order];
    if (numbers.some((number) => !Number.isFinite(number) || !Number.isInteger(number))) return "Все числовые поля наград должны быть целыми";
    if (entry.amount_min < 1 || entry.amount_max < entry.amount_min) return "Проверьте диапазон количества награды";
    if (entry.weight < 1) return "Вес должен быть больше нуля";
    if (entry.reward_kind === "item" && !entry.item_id) return "Выберите предмет для каждой предметной награды";
  }
  const guaranteedCount = active.filter((entry) => entry.is_guaranteed).length;
  if (!payload.allow_duplicates && guaranteedCount && payload.guaranteed_slots > guaranteedCount) return "Без дубликатов число гарантированных слотов превышает число гарантированных наград";
  if (payload.min_user_level != null && payload.max_user_level != null && payload.max_user_level < payload.min_user_level) return "Максимальный уровень меньше минимального";
  if (payload.starts_at && payload.ends_at && new Date(payload.ends_at) <= new Date(payload.starts_at)) return "Дата окончания должна быть позже начала";
  return null;
}

function openLootboxEditor(body, existing = null) {
  const box = existing || {
    code: "", name: "", description: "", rarity: "Обычный",
    image_url: "/static/img/items/lootbox_common.svg", is_active: false,
    is_droppable: false, is_archived: false, assembly_weight: 10,
    sale_price: null, sale_currency: "kovbucks", min_user_level: null,
    max_user_level: null, sort_order: 0, starts_at: null, ends_at: null,
    daily_open_limit: 0, guaranteed_slots: 1, allow_duplicates: true,
    entries: [],
  };
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;max-height:92vh;overflow:auto">
      <button class="close" id="lb-editor-close" type="button">×</button>
      <h3>${existing ? "Редактировать" : "Создать"} ковбокс</h3>
      <div class="admin-form-grid">
        ${field("Внутренний ID", `<input class="input" id="lb-code" value="${escapeHtml(box.code)}" ${existing ? "disabled" : ""} placeholder="winter_2026"/>`)}
        ${field("Название", `<input class="input" id="lb-name" value="${escapeHtml(box.name)}"/>`)}
        ${field("Описание", `<textarea class="input" id="lb-description" rows="3">${escapeHtml(box.description || "")}</textarea>`)}
        ${field("Редкость", `<select class="input" id="lb-rarity">${LOOTBOX_RARITIES.map((rarity) => `<option ${box.rarity === rarity ? "selected" : ""}>${rarity}</option>`).join("")}</select>`)}
        ${field("Ассет", `<input class="input" id="lb-image" value="${escapeHtml(box.image_url)}"/>`)}
        ${field("Активен для открытия", `<select class="input" id="lb-active"><option value="true" ${box.is_active ? "selected" : ""}>Да</option><option value="false" ${!box.is_active ? "selected" : ""}>Нет</option></select>`)}
        ${field("Доступен для сборки/выпадения", `<select class="input" id="lb-droppable"><option value="true" ${box.is_droppable ? "selected" : ""}>Да</option><option value="false" ${!box.is_droppable ? "selected" : ""}>Нет</option></select>`)}
        ${field("Вес при сборке", `<input class="input" id="lb-assembly-weight" type="number" min="1" value="${box.assembly_weight || 10}"/>`)}
        ${field("Цена продажи", `<input class="input" id="lb-price" type="number" min="1" value="${box.sale_price ?? ""}" placeholder="не продаётся"/>`)}
        ${field("Валюта цены", `<select class="input" id="lb-currency"><option value="kovbucks" selected>Ковбаксы</option></select>`)}
        ${field("Мин. уровень", `<input class="input" id="lb-min-level" type="number" min="0" value="${box.min_user_level ?? ""}"/>`)}
        ${field("Макс. уровень", `<input class="input" id="lb-max-level" type="number" min="0" value="${box.max_user_level ?? ""}"/>`)}
        ${field("Порядок", `<input class="input" id="lb-order" type="number" value="${box.sort_order || 0}"/>`)}
        ${field("Начало", `<input class="input" id="lb-start" type="datetime-local" value="${lootboxDateValue(box.starts_at)}"/>`)}
        ${field("Окончание", `<input class="input" id="lb-end" type="datetime-local" value="${lootboxDateValue(box.ends_at)}"/>`)}
        ${field("Лимит открытий в сутки (0 — нет)", `<input class="input" id="lb-daily-limit" type="number" min="0" max="1000" value="${box.daily_open_limit || 0}"/>`)}
        ${field("Гарантированных слотов", `<input class="input" id="lb-slots" type="number" min="1" max="10" value="${box.guaranteed_slots || 1}"/>`)}
        ${field("Разрешить дубликаты", `<select class="input" id="lb-duplicates"><option value="true" ${box.allow_duplicates ? "selected" : ""}>Да</option><option value="false" ${!box.allow_duplicates ? "selected" : ""}>Нет</option></select>`)}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin:10px 0">
        <img id="lb-image-preview" src="${escapeHtml(box.image_url)}" alt="" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--border);border-radius:12px" onerror="this.src='/static/img/ui/box.svg'"/>
        <div class="admin-sub">Предпросмотр ассета · уже выданные ковбоксы используют актуальную конфигурацию; архивирование не удаляет экземпляры</div>
      </div>
      <div class="row gap wrap"><h4 style="margin:0;flex:1">Содержимое</h4><button class="btn btn-sm btn-secondary" id="lb-add-entry" type="button">+ Награда</button></div>
      <div id="lb-weight-total" class="admin-sub"></div>
      <div id="lb-entry-list">${(box.entries || []).map(lootboxEntryTemplate).join("")}</div>
      <div class="row gap" style="margin-top:12px">
        <button class="btn btn-sm" id="lb-save" type="button">Сохранить</button>
        <button class="btn btn-sm btn-secondary" id="lb-cancel" type="button">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let dirty = false;
  const unloadWarning = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
  window.addEventListener("beforeunload", unloadWarning);
  const cleanup = () => { window.removeEventListener("beforeunload", unloadWarning); overlay.remove(); };
  const requestClose = () => { if (!dirty || confirm("Закрыть редактор и потерять несохранённые изменения?")) cleanup(); };
  overlay.querySelector("#lb-editor-close").addEventListener("click", requestClose);
  overlay.querySelector("#lb-cancel").addEventListener("click", requestClose);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) requestClose(); });
  overlay.addEventListener("input", () => { dirty = true; refreshLootboxProbabilities(overlay); });
  overlay.addEventListener("change", () => { dirty = true; refreshLootboxProbabilities(overlay); });
  overlay.querySelector("#lb-image").addEventListener("input", (event) => {
    overlay.querySelector("#lb-image-preview").src = event.target.value || "/static/img/ui/box.svg";
  });

  function bindEntryButtons() {
    overlay.querySelectorAll(".lb-entry-remove").forEach((button) => {
      button.onclick = () => { button.closest(".lootbox-entry").remove(); dirty = true; refreshLootboxProbabilities(overlay); };
    });
  }
  bindEntryButtons();
  overlay.querySelector("#lb-add-entry").addEventListener("click", () => {
    overlay.querySelector("#lb-entry-list").insertAdjacentHTML("beforeend", lootboxEntryTemplate());
    dirty = true;
    bindEntryButtons();
    refreshLootboxProbabilities(overlay);
  });
  refreshLootboxProbabilities(overlay);

  overlay.querySelector("#lb-save").addEventListener("click", async () => {
    const nullableNumber = (selector) => {
      const value = overlay.querySelector(selector).value.trim();
      return value === "" ? null : Number(value);
    };
    const payload = {
      code: overlay.querySelector("#lb-code").value.trim(),
      name: overlay.querySelector("#lb-name").value.trim(),
      description: overlay.querySelector("#lb-description").value.trim(),
      rarity: overlay.querySelector("#lb-rarity").value,
      image_url: overlay.querySelector("#lb-image").value.trim(),
      is_active: overlay.querySelector("#lb-active").value === "true",
      is_droppable: overlay.querySelector("#lb-droppable").value === "true",
      is_archived: Boolean(box.is_archived),
      assembly_weight: Number(overlay.querySelector("#lb-assembly-weight").value),
      sale_price: nullableNumber("#lb-price"),
      sale_currency: overlay.querySelector("#lb-currency").value,
      min_user_level: nullableNumber("#lb-min-level"),
      max_user_level: nullableNumber("#lb-max-level"),
      sort_order: Number(overlay.querySelector("#lb-order").value) || 0,
      starts_at: overlay.querySelector("#lb-start").value ? new Date(overlay.querySelector("#lb-start").value).toISOString() : null,
      ends_at: overlay.querySelector("#lb-end").value ? new Date(overlay.querySelector("#lb-end").value).toISOString() : null,
      daily_open_limit: Number(overlay.querySelector("#lb-daily-limit").value) || 0,
      guaranteed_slots: Number(overlay.querySelector("#lb-slots").value),
      allow_duplicates: overlay.querySelector("#lb-duplicates").value === "true",
      entries: Array.from(overlay.querySelectorAll(".lootbox-entry")).map(collectLootboxEntry),
    };
    const error = validateLootboxPayload(payload);
    if (error) return window.kov.toast(error);
    const save = overlay.querySelector("#lb-save");
    save.disabled = true;
    try {
      if (existing) await patch(`/api/admin/lootboxes/${existing.id}`, payload);
      else await post("/api/admin/lootboxes", payload);
      dirty = false;
      cleanup();
      window.kov.toast("Ковбокс сохранён");
      renderLootboxes(body);
    } catch (error) {
      save.disabled = false;
      window.kov.toast(error.message);
    }
  });
}

async function renderLootboxes(body) {
  const rows = await get("/api/admin/lootboxes");
  const rarities = Array.from(new Set(rows.map((row) => row.rarity))).sort();
  body.innerHTML = `
    <div class="admin-card">
      <div class="row gap wrap">
        <input class="input input-sm" id="lb-search" placeholder="Поиск по названию или ID" style="flex:1;min-width:180px"/>
        <select class="input input-sm" id="lb-active-filter"><option value="">Все статусы</option><option value="active">Активные</option><option value="inactive">Отключённые</option><option value="archived">Архив</option></select>
        <select class="input input-sm" id="lb-rarity-filter"><option value="">Все редкости</option>${rarities.map((rarity) => `<option>${escapeHtml(rarity)}</option>`).join("")}</select>
        <button class="btn btn-sm" id="lb-create">Создать</button>
      </div>
      <div class="admin-sub" style="margin-top:8px">Вероятности задаются целыми весами; проценты нормализуются сервером автоматически.</div>
    </div>
    <div id="lb-list"></div>`;

  const list = body.querySelector("#lb-list");
  function draw() {
    const term = body.querySelector("#lb-search").value.trim().toLowerCase();
    const status = body.querySelector("#lb-active-filter").value;
    const rarity = body.querySelector("#lb-rarity-filter").value;
    const filtered = rows.filter((row) => {
      if (term && !`${row.name} ${row.code}`.toLowerCase().includes(term)) return false;
      if (rarity && row.rarity !== rarity) return false;
      if (status === "active" && (!row.is_active || row.is_archived)) return false;
      if (status === "inactive" && (row.is_active || row.is_archived)) return false;
      if (status === "archived" && !row.is_archived) return false;
      return true;
    });
    list.innerHTML = filtered.length ? filtered.map((row) => `
      <div class="admin-card" data-lb-id="${row.id}">
        <div style="display:flex;gap:12px;align-items:center">
          <img src="${escapeHtml(row.image_url)}" alt="" style="width:64px;height:64px;object-fit:contain;flex:0 0 auto" onerror="this.src='/static/img/ui/box.svg'"/>
          <div style="min-width:0;flex:1">
            <h3 class="admin-card-title">${escapeHtml(row.name)} ${row.is_archived ? '<span class="admin-badge">архив</span>' : row.is_active ? '<span class="admin-badge">активен</span>' : ""}</h3>
            <div class="admin-sub">${escapeHtml(row.code)} · ${escapeHtml(row.rarity)} · версия ${row.version} · случайный вес ${row.weight_total}</div>
            <div class="admin-sub">${row.entries.length} наград · гарант. слотов ${row.guaranteed_slots} · сборка вес ${row.assembly_weight}</div>
          </div>
        </div>
        <div class="row gap wrap" style="margin-top:10px">
          <button class="btn btn-sm" data-lb-action="edit">Редактировать</button>
          <button class="btn btn-sm btn-secondary" data-lb-action="duplicate">Дублировать</button>
          ${row.is_archived ? "" : '<button class="btn btn-sm btn-danger" data-lb-action="archive">Архивировать</button>'}
        </div>
      </div>`).join("") : '<div class="admin-card"><div class="admin-sub">Ковбоксы не найдены</div></div>';

    list.querySelectorAll("[data-lb-id]").forEach((card) => {
      const row = rows.find((value) => value.id === Number(card.dataset.lbId));
      card.querySelector('[data-lb-action="edit"]').addEventListener("click", () => openLootboxEditor(body, row));
      card.querySelector('[data-lb-action="duplicate"]').addEventListener("click", async (event) => {
        const button = event.currentTarget;
        if (button.disabled) return;
        const code = prompt("Новый внутренний ID", `${row.code}_copy`);
        if (!code) return;
        const name = prompt("Название копии", `${row.name} — копия`);
        if (!name) return;
        button.disabled = true;
        button.textContent = "Создаём…";
        try {
          await post(`/api/admin/lootboxes/${row.id}/duplicate`, { code: code.trim(), name: name.trim() });
          window.kov.toast("Копия создана отключённой");
          renderLootboxes(body);
        } catch (error) {
          button.disabled = false;
          button.textContent = "Дублировать";
          window.kov.toast(error.message);
        }
      });
      card.querySelector('[data-lb-action="archive"]')?.addEventListener("click", (event) => {
        const button = event.currentTarget;
        if (button.disabled) return;
        confirmAction("Архивировать ковбокс? Новые экземпляры перестанут выпадать, уже выданные сохранятся.", async () => {
          button.disabled = true;
          button.textContent = "Архивируем…";
          try {
            await post(`/api/admin/lootboxes/${row.id}/archive`);
            window.kov.toast("Ковбокс архивирован");
            renderLootboxes(body);
          } catch (error) {
            button.disabled = false;
            button.textContent = "Архивировать";
            window.kov.toast(error.message);
          }
        });
      });
    });
  }
  body.querySelector("#lb-create").addEventListener("click", () => openLootboxEditor(body));
  body.querySelector("#lb-search").addEventListener("input", draw);
  body.querySelector("#lb-active-filter").addEventListener("change", draw);
  body.querySelector("#lb-rarity-filter").addEventListener("change", draw);
  draw();
}

// ---------- BATTLE PASS ADMIN ----------
// Один активный сезон уже существует — админ редактирует только его призы по уровням.
var BP_KIND_ICONS = {
  xp: "/static/img/item_icons/xp.svg",
  coins: "/static/img/ui/coin.svg",
  item: "",
};
var BP_KIND_LABELS = { xp: "XP", coins: "Ковбаксы", item: "Предмет" };

async function renderBattlePassAdmin(body) {
  var seasons = [];
  try { seasons = await get("/api/admin/battlepass/seasons"); } catch (e) { seasons = []; }

  var season = seasons.find(function(s) { return s.is_active; }) || (seasons.length ? seasons[0] : null);

  if (!season) {
    body.innerHTML = cardBlock("Боевой пропуск",
      '<div class="admin-sub">Активный сезон не найден. Создайте его через миграцию/бэкенд.</div>');
    return;
  }

  var html = '<div class="admin-card">' +
    '<h3 class="admin-card-title">Сезон: ' + escapeHtml(season.name) +
      (season.is_active ? ' <span class="admin-badge">активен</span>' : '') + '</h3>' +
    '<div class="admin-sub">Уровней: ' + season.total_levels + ' · XP за уровень: ' + season.xp_per_level + '</div>' +
    '<div class="row gap" style="margin-top:8px">' +
      '<button class="btn btn-sm btn-secondary" id="bp-edit-season">Настройки сезона</button>' +
    '</div>' +
  '</div>';

  html += '<div class="admin-card">' +
    '<h3 class="admin-card-title">Призы по уровням</h3>' +
    '<div class="admin-sub" style="margin-bottom:8px">Нажмите на ячейку, чтобы добавить или изменить награду на уровне. Прокрутка ниже.</div>' +
    '<div id="bp-rewards-scroll" style="max-height:60vh;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>' +
  '</div>';

  body.innerHTML = html;

  body.querySelector("#bp-edit-season").addEventListener("click", function() {
    openBpSeasonEditor(body, season);
  });

  renderBPRewards(body, season);
}

function renderBPRewards(body, season) {
  var container = body.querySelector("#bp-rewards-scroll");
  if (!container) return;

  // Группируем награды: byLevel[level] = reward (только free-трек, одна награда на уровень).
  var byLevel = {};
  (season.rewards || []).forEach(function(r) {
    byLevel[r.level] = r;
  });

  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="position:sticky;top:0;background:var(--bg);z-index:1">' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);width:48px">Ур.</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Награда</th>';
  html += '</tr></thead><tbody>';

  for (var lvl = 1; lvl <= season.total_levels; lvl++) {
    html += '<tr style="border-bottom:1px solid var(--border)">';
    html += '<td style="padding:5px 8px;font-weight:700;color:var(--text);vertical-align:top">' + lvl + '</td>';
    var rw = byLevel[lvl] || null;
    html += '<td style="padding:4px 8px;vertical-align:top">';
    if (rw) {
      html += '<button class="bp-reward-cell" data-id="' + rw.id + '" type="button" ' +
        'style="display:flex;align-items:center;gap:6px;width:100%;text-align:left;background:var(--card,rgba(255,255,255,0.04));border:1px solid var(--border);border-radius:6px;padding:5px 8px;cursor:pointer;color:var(--text)">' +
        (rw.icon ? '<img src="' + escapeHtml(rw.icon) + '" style="width:18px;height:18px;flex-shrink:0" onerror="this.style.display=\'none\'"/>' : '') +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        escapeHtml(rw.label || ((BP_KIND_LABELS[rw.kind] || rw.kind) + " " + rw.value)) +
        '</span>' +
        '<span style="font-size:9px;color:var(--text-soft);text-transform:uppercase;flex-shrink:0">' + escapeHtml(BP_KIND_LABELS[rw.kind] || rw.kind) + '</span>' +
        '</button>';
    } else {
      html += '<button class="bp-reward-cell" data-lvl="' + lvl + '" type="button" ' +
        'style="width:100%;text-align:left;background:none;border:1px dashed var(--border);border-radius:6px;padding:5px 8px;cursor:pointer;color:var(--text-soft)">+ добавить</button>';
    }
    html += '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  // Один обработчик на ячейку: и для существующей награды (edit), и для пустой (add).
  container.querySelectorAll(".bp-reward-cell").forEach(function(b) {
    b.addEventListener("click", function() {
      if (b.dataset.id) {
        var rid = Number(b.dataset.id);
        var rw = (season.rewards || []).find(function(x) { return x.id === rid; });
        if (rw) openBpRewardEditor(body, rw, season);
      } else {
        var lvl = Number(b.dataset.lvl);
        openBpRewardEditor(body, {
          id: null, level: lvl, kind: "xp", value: 10,
          label: "", icon: BP_KIND_ICONS.xp, item_code: null,
        }, season);
      }
    });
  });
}

function openBpSeasonEditor(body, s) {
  var overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal"><button class="close" onclick="this.closest(\'.modal-overlay\').remove()">×</button>' +
    '<h3>Редактировать сезон</h3>' +
    formGrid(
      field("Название", '<input class="input" id="bpe-name" value="' + escapeHtml(s.name) + '"/>'),
      field("XP за уровень", '<input class="input" id="bpe-xpl" type="number" value="' + s.xp_per_level + '"/>'),
      field("Всего уровней", '<input class="input" id="bpe-total" type="number" value="' + s.total_levels + '"/>'),
      field("Активен", '<select class="input" id="bpe-active"><option value="true"' + (s.is_active ? ' selected' : '') + '>Да</option><option value="false"' + (!s.is_active ? ' selected' : '') + '>Нет</option></select>'),
    ) +
    '<div class="row gap"><button class="btn btn-sm" id="bpe-save">Сохранить</button><button class="btn btn-sm btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()">Отмена</button></div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector("#bpe-save").addEventListener("click", async function() {
    try {
      await post("/api/admin/battlepass/season", {
        id: s.id,
        name: overlay.querySelector("#bpe-name").value.trim(),
        xp_per_level: Number(overlay.querySelector("#bpe-xpl").value) || 100,
        total_levels: Number(overlay.querySelector("#bpe-total").value) || 30,
        is_active: overlay.querySelector("#bpe-active").value === "true",
      });
      window.kov.toast("Сезон сохранён");
      overlay.remove();
      renderBattlePassAdmin(body);
    } catch (e) { window.kov.toast(e.message); }
  });
}

function openBpRewardEditor(body, r, season) {
  var overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  var levelOpts = "";
  for (var lvl = 1; lvl <= season.total_levels; lvl++) {
    levelOpts += '<option value="' + lvl + '"' + (r.level === lvl ? ' selected' : '') + '>' + lvl + '</option>';
  }

  var kinds = ["xp", "coins", "item"];
  var kindOpts = kinds.map(function(k) {
    return '<option value="' + k + '"' + (r.kind === k ? ' selected' : '') + '>' + BP_KIND_LABELS[k] + '</option>';
  }).join("");

  var itemOpts = '<option value="">—</option>' + META.items.map(function(i) {
    return '<option value="' + i.code + '"' + (i.code === r.item_code ? ' selected' : '') + '>' + escapeHtml(i.name) + '</option>';
  }).join("");

  overlay.innerHTML = '<div class="modal"><button class="close" onclick="this.closest(\'.modal-overlay\').remove()">×</button>' +
    '<h3>' + (r.id ? "Награда" : "Новая награда") + '</h3>' +
    formGrid(
      field("Уровень", '<select class="input" id="bpre-level">' + levelOpts + '</select>'),
      field("Тип", '<select class="input" id="bpre-kind">' + kindOpts + '</select>'),
      field("Количество", '<input class="input" id="bpre-value" type="number" value="' + r.value + '"/>'),
      field("Предмет", '<select class="input" id="bpre-item">' + itemOpts + '</select>'),
    ) +
    '<div class="row gap"><button class="btn btn-sm" id="bpre-save">Сохранить</button>' + (r.id ? '<button class="btn btn-sm btn-danger" id="bpre-delete">Удалить</button>' : '') + '<button class="btn btn-sm btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()">Отмена</button></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var itemField = overlay.querySelector("#bpre-item").closest(".admin-field") || overlay.querySelector("#bpre-item").parentElement;
  function syncItemVisibility() {
    var kind = overlay.querySelector("#bpre-kind").value;
    if (itemField) itemField.style.display = (kind === "item") ? "" : "none";
  }
  syncItemVisibility();

  overlay.querySelector("#bpre-kind").addEventListener("change", syncItemVisibility);

  overlay.querySelector("#bpre-save").addEventListener("click", async function() {
    try {
      var kind = overlay.querySelector("#bpre-kind").value;
      var itemCode = overlay.querySelector("#bpre-item").value || null;
      var value = Number(overlay.querySelector("#bpre-value").value) || 0;
      if (kind === "item" && !itemCode) {
        window.kov.toast("Выберите предмет");
        return;
      }
      // Иконка и подпись генерируются автоматически.
      var icon = BP_KIND_ICONS[kind] || "";
      var label = "";
      if (kind === "xp") label = value + " XP";
      else if (kind === "coins") label = value + " Ковбаксов";
      else if (kind === "item") {
        var it = META.items.find(function(i) { return i.code === itemCode; });
        label = (it ? it.name : itemCode) + (value > 1 ? " ×" + value : "");
        if (it && it.icon) icon = it.icon;
      }
      await post("/api/admin/battlepass/reward", {
        id: r.id || null,
        season_id: season.id,
        level: Number(overlay.querySelector("#bpre-level").value) || r.level,
        kind: kind,
        value: value,
        label: label,
        icon: icon,
        item_code: kind === "item" ? itemCode : null,
      });
      window.kov.toast("Награда сохранена");
      overlay.remove();
      renderBattlePassAdmin(body);
    } catch (e) { window.kov.toast(e.message); }
  });

  // Кнопка удаления есть только у существующей награды (r.id). Для новой её нет — иначе querySelector вернёт null.
  var deleteBtn = overlay.querySelector("#bpre-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async function() {
      confirmAction("Удалить награду?", async function() {
        try {
          await del("/api/admin/battlepass/reward/" + r.id);
          window.kov.toast("Награда удалена");
          overlay.remove();
          renderBattlePassAdmin(body);
        } catch (e) { window.kov.toast(e.message); }
      });
    });
  }
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
  lootboxes: renderLootboxes,
  legal: renderLegal,
  battlepass: renderBattlePassAdmin,
};
