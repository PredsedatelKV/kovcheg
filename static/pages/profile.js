import { get, post, iconHtml, productImg } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function invCell(row) {
  return `
    <div class="inv-cell" data-item-id="${row.item.id}" data-qty="${row.quantity}">
      <span class="qty">×${row.quantity}</span>
      ${productImg(row.item, "lg")}
      <div class="name">${escapeHtml(row.item.name)}</div>
      <div class="rare">${escapeHtml(row.item.rarity)}</div>
    </div>`;
}

function userTaskRow(ut) {
  return `
    <div class="task-row" data-user-task-id="${ut.id}">
      <div class="ico">${iconHtml(ut.task.icon, "md", ut.task.name)}</div>
      <div class="meta">
        <h4>${escapeHtml(ut.task.name)}</h4>
        <p>Прогресс: ${ut.progress} / ${ut.task.target_progress} · Награда: ${ut.task.reward}</p>
      </div>
      <span style="color: var(--success); font-size:18px">●</span>
    </div>`;
}

export async function renderProfile(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/profile/me");
  const user = data.user;
  const photoOrEmoji = user.photo_url
    ? `<img src="${escapeHtml(user.photo_url)}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`
    : `<img src="/static/img/head.svg" alt="Гражданин" class="hero-img hero-img-head"/>`;

  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${escapeHtml(user.first_name || "Гражданин")}</h1>
        <div class="subtitle">Должность: ${escapeHtml(user.role)}</div>
        <div class="subtitle">Ограничения: ${escapeHtml(user.restrictions || "-")}</div>
      </div>
      <div class="hero-head">${photoOrEmoji}</div>
    </section>

    <div class="card">
      <div class="inv-row-title">
        <h3 class="card-title">Инвентарь</h3>
        ${data.inventory.length > 8 ? `<button class="see-all" data-action="all-inv">Смотреть все ›</button>` : ""}
      </div>
      <div class="inv-grid">
        ${data.inventory.length === 0
          ? `<div class="empty" style="grid-column: 1/-1">Пока пусто. Купи что-нибудь в Коверне или получи задание.</div>`
          : data.inventory.slice(0, 8).map(invCell).join("")}
      </div>
    </div>

    <div class="card wallet-card">
      <h3 class="card-title">Кошелёк</h3>
      <div class="wallet-row">
        <div class="wallet-balance-big">
          <img src="/static/img/ui/coin.svg" alt="" class="wallet-coin"/>
          <div class="wallet-balance-num">
            <div class="wallet-balance-label">Баланс</div>
            <div class="wallet-balance-value"><strong>${user.balance}</strong> <span class="wallet-balance-unit">Ковбаксов</span></div>
          </div>
        </div>
        <button class="btn btn-transfer-compact" data-action="transfer">
          <img src="/static/img/ui/coin.svg" alt="" class="icon icon-sm"/>
          <span>Перевести</span>
        </button>
      </div>
    </div>

    <h2 class="section-title">План</h2>
    ${
      data.daily_plan
        ? `<div class="card plan-card">
            <div class="plan-icon">${iconHtml(data.daily_plan.icon, "lg", "План")}</div>
            <div style="flex:1">
              <h3 class="card-title">${escapeHtml(data.daily_plan.name)}</h3>
              <p class="card-sub">Выполняйте задания каждый день и становитесь сильнее.</p>
              <span class="mandatory-tag">Обязательный</span>
            </div>
          </div>`
        : ""
    }

    <h2 class="section-title">Задания ${data.user_tasks.length > 3 ? `<button class="see-all" data-action="all-mytasks">Смотреть все</button>` : ""}</h2>
    ${
      data.user_tasks.length === 0
        ? `<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>`
        : `<div class="tasks-list">${data.user_tasks.slice(0, 3).map(userTaskRow).join("")}</div>`
    }
  `;

  bindCellActions(root, data.inventory);
  root.querySelector('[data-action="transfer"]').addEventListener("click", () => openTransferDialog(user));

  root.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = Number(row.dataset.userTaskId);
      const ut = data.user_tasks.find((u) => u.id === id);
      if (ut) openUserTaskDialog(ut, root);
    });
  });

  root.querySelector('[data-action="all-inv"]')?.addEventListener("click", () => openAllInventory(data.inventory, root));
  root.querySelector('[data-action="all-mytasks"]')?.addEventListener("click", () => openAllMyTasks(data.user_tasks, root));
}

function bindCellActions(scope, inventory) {
  scope.querySelectorAll(".inv-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const id = Number(cell.dataset.itemId);
      const row = inventory.find((r) => r.item.id === id);
      if (row) openItemActionsDialog(row);
    });
  });
}

function openItemActionsDialog(row) {
  const item = row.item;
  const canGift = item.can_gift;
  const canActivate = item.can_activate;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="item-actions-head">
      ${productImg(item, "xl")}
      <h2>${escapeHtml(item.name)}</h2>
      <p class="card-sub">${escapeHtml(item.description || "")}</p>
      <div class="item-meta">×${row.quantity} · ${escapeHtml(item.rarity)}${item.category ? ` · ${escapeHtml(item.category)}` : ""}</div>
    </div>
    <div class="item-actions-grid">
      <button class="btn btn-outline" id="ia-gift" ${canGift ? "" : "disabled"}>
        <img src="/static/img/ui/gift.svg" alt="" class="icon icon-md"/>
        <span>Подарить</span>
      </button>
      <button class="btn btn-outline" id="ia-sell">
        <img src="/static/img/ui/coin.svg" alt="" class="icon icon-md"/>
        <span>Продать</span>
      </button>
      <button class="btn" id="ia-activate" ${canActivate ? "" : "disabled"}>
        <img src="/static/img/ui/spark.svg" alt="" class="icon icon-md"/>
        <span>Активировать</span>
      </button>
    </div>
  `);

  modal.querySelector("#ia-gift").addEventListener("click", () => {
    if (!canGift) return;
    window.closeModal();
    setTimeout(() => openGiftDialog(item, row.quantity), 80);
  });
  modal.querySelector("#ia-sell").addEventListener("click", () => {
    window.closeModal();
    setTimeout(() => openSellDialog(item, row.quantity), 80);
  });
  modal.querySelector("#ia-activate").addEventListener("click", async () => {
    if (!canActivate) return;
    try {
      await post("/api/profile/inventory/activate", { item_id: item.id, recipient: "", quantity: 1 });
      window.kov.toast("Предмет активирован");
      window.closeModal();
      const r = document.getElementById("view");
      renderProfile(r);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}

function openAllInventory(inventory) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Инвентарь</h2>
    <p class="card-sub" style="margin: 0 0 14px">Все предметы из твоего инвентаря.</p>
    ${inventory.length === 0
      ? `<div class="empty">Пока пусто.</div>`
      : `<div class="inv-grid">${inventory.map(invCell).join("")}</div>`}
  `);
  bindCellActions(modal, inventory);
}

function openAllMyTasks(myTasks, root) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Мои задания</h2>
    <p class="card-sub" style="margin: 0 0 14px">Активные задания в работе.</p>
    ${myTasks.length === 0
      ? `<div class="empty">Нет активных заданий.</div>`
      : `<div class="tasks-list">${myTasks.map(userTaskRow).join("")}</div>`}
  `);
  modal.querySelectorAll(".task-row").forEach((row) =>
    row.addEventListener("click", () => {
      const id = Number(row.dataset.userTaskId);
      const ut = myTasks.find((u) => u.id === id);
      if (!ut) return;
      window.closeModal();
      setTimeout(() => openUserTaskDialog(ut, root), 80);
    }),
  );
}

async function openTransferDialog(user) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Перевод Ковбаксов</h2>
    <p style="color:var(--text-soft); font-size:13px">Баланс: <strong>${user.balance}</strong> Ковбаксов</p>
    <label class="field-label">Кому</label>
    <select class="input" id="recipient">
      <option value="">Загрузка…</option>
    </select>
    <label class="field-label">Сумма</label>
    <input class="input" id="amount" type="number" min="1" placeholder="100" />
    <button class="btn btn-transfer-confirm" id="send-btn">Отправить</button>
  `);
  const select = modal.querySelector("#recipient");
  let players = [];
  try {
    players = await get("/api/profile/players");
  } catch (err) {
    select.innerHTML = `<option value="">Не удалось загрузить</option>`;
    window.kov.toast(err.message);
    return;
  }
  if (!players.length) {
    select.innerHTML = `<option value="">Нет других игроков</option>`;
    return;
  }
  select.innerHTML = players
    .map((p) => `<option value="uid:${p.id}">${escapeHtml(p.first_name)}</option>`)
    .join("");

  modal.querySelector("#send-btn").addEventListener("click", async () => {
    const recipient = select.value;
    const amount = Number(modal.querySelector("#amount").value);
    if (!recipient || !amount) return window.kov.toast("Заполни поля");
    try {
      await post("/api/profile/transfer", { recipient, amount });
      window.kov.toast("Отправлено");
      window.closeModal();
      window.kov.setTab("profile");
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}

async function openGiftDialog(item, maxQty) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Подарить «${escapeHtml(item.name)}»</h2>
    <label class="field-label">Кому</label>
    <select class="input" id="r"><option value="">Загрузка…</option></select>
    <label class="field-label">Количество (макс. ${maxQty})</label>
    <input class="input" id="q" type="number" min="1" max="${maxQty}" value="1" />
    <button class="btn" id="ok" style="margin-top:14px">Подарить</button>
  `);
  const select = modal.querySelector("#r");
  let players = [];
  try {
    players = await get("/api/profile/players");
  } catch (err) {
    select.innerHTML = `<option value="">Не удалось загрузить</option>`;
    window.kov.toast(err.message);
    return;
  }
  if (!players.length) {
    select.innerHTML = `<option value="">Нет других игроков</option>`;
    return;
  }
  select.innerHTML = players
    .map((p) => `<option value="uid:${p.id}">${escapeHtml(p.first_name)}</option>`)
    .join("");

  modal.querySelector("#ok").addEventListener("click", async () => {
    const recipient = select.value;
    const quantity = Number(modal.querySelector("#q").value);
    if (!recipient || !quantity) return window.kov.toast("Заполни поля");
    try {
      await post("/api/profile/inventory/gift", { recipient, item_id: item.id, quantity });
      window.kov.toast("Подарено");
      window.closeModal();
      renderProfile(document.getElementById("view"));
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}

async function openSellDialog(item, maxQty) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Продать «${escapeHtml(item.name)}»</h2>
    <label class="field-label">Кому</label>
    <select class="input" id="r"><option value="">Загрузка…</option></select>
    <label class="field-label">Количество (макс. ${maxQty})</label>
    <input class="input" id="q" type="number" min="1" max="${maxQty}" value="1" />
    <label class="field-label">Цена (Ковбаксов)</label>
    <input class="input" id="p" type="number" min="1" value="10" />
    <p class="card-sub" style="font-size:12px; margin:8px 0 0">Предмет уйдёт в инвентарь покупателя, как только он подтвердит покупку в Коверне.</p>
    <button class="btn" id="ok" style="margin-top:14px">Выставить</button>
  `);
  const select = modal.querySelector("#r");
  let players = [];
  try {
    players = await get("/api/profile/players");
  } catch (err) {
    select.innerHTML = `<option value="">Не удалось загрузить</option>`;
    window.kov.toast(err.message);
    return;
  }
  if (!players.length) {
    select.innerHTML = `<option value="">Нет других игроков</option>`;
    return;
  }
  select.innerHTML = players
    .map((p) => `<option value="uid:${p.id}">${escapeHtml(p.first_name)}</option>`)
    .join("");

  modal.querySelector("#ok").addEventListener("click", async () => {
    const recipient = select.value;
    const quantity = Number(modal.querySelector("#q").value);
    const price = Number(modal.querySelector("#p").value);
    if (!recipient || !quantity || !price) return window.kov.toast("Заполни поля");
    try {
      await post("/api/profile/inventory/sell", { recipient, item_id: item.id, quantity, price });
      window.kov.toast("Выставлено на продажу");
      window.closeModal();
      renderProfile(document.getElementById("view"));
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}

function openUserTaskDialog(ut, root) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="task-card-icon">${iconHtml(ut.task.icon, "xl", ut.task.name)}</div>
    <h2 style="text-align:center;margin-top:0">${escapeHtml(ut.task.name)}</h2>
    <div style="text-align:center; margin: 2px 0 10px"><span style="background:var(--primary-soft); color:var(--primary-700); padding: 3px 10px; border-radius:8px; font-size:12px; font-weight:600">В процессе</span></div>
    <p style="color:var(--text-soft); font-size:14px; margin: 0 0 14px">${escapeHtml(ut.task.description)}</p>
    <div class="task-card-reward">Награда: ${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${ut.task.reward} Ковбаксов</div>
    <button class="btn btn-secondary" onclick="closeModal()">Закрыть</button>
    <button class="btn btn-danger" id="cancel-ut" style="margin-top:8px">Прервать задание</button>
  `);
  modal.querySelector("#cancel-ut").addEventListener("click", async () => {
    try {
      await post(`/api/tasks/${ut.id}/cancel`);
      window.kov.toast("Задание прервано");
      window.closeModal();
      renderProfile(root);
    } catch (e) {
      window.kov.toast(e.message);
    }
  });
}
