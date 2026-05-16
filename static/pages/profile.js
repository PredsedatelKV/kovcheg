import { get, post } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
        <button class="see-all">Смотреть все ›</button>
      </div>
      <div class="inv-grid">
        ${data.inventory.length === 0
          ? `<div class="empty" style="grid-column: 1/-1">Пока пусто. Купи что-нибудь в Коверне или получи задание.</div>`
          : data.inventory
              .slice(0, 8)
              .map(
                (row) => `
                  <div class="inv-cell" data-item-id="${row.item.id}">
                    <span class="qty">×${row.quantity}</span>
                    <div class="ic">${row.item.icon}</div>
                    <div class="name">${escapeHtml(row.item.name)}</div>
                    <div class="rare">${escapeHtml(row.item.rarity)}</div>
                    <div class="acts">
                      ${row.item.can_gift ? `<button class="btn btn-outline btn-sm" data-action="gift" data-item-id="${row.item.id}">Подарить</button>` : ""}
                      ${row.item.can_activate ? `<button class="btn btn-sm" data-action="activate" data-item-id="${row.item.id}">Активировать</button>` : ""}
                    </div>
                  </div>`,
              )
              .join("")}
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Кошелёк</h3>
      <div class="card-row" style="margin-top:8px">
        <div class="wallet-balance"><span class="coin">🪙</span> Баланс: <strong>${user.balance}</strong> монет</div>
      </div>
      <div class="wallet-actions">
        <button class="btn btn-outline" data-action="transfer">↗ Перевести</button>
        <button class="btn btn-outline" data-action="receive">↙ Получить</button>
      </div>
    </div>

    <h2 class="section-title">План</h2>
    ${
      data.daily_plan
        ? `<div class="card plan-card">
            <div class="plan-icon">📜</div>
            <div style="flex:1">
              <h3 class="card-title">${escapeHtml(data.daily_plan.name)}</h3>
              <p class="card-sub">Выполняйте задания каждый день и становитесь сильнее.</p>
              <span class="mandatory-tag">Обязательный</span>
            </div>
          </div>`
        : ""
    }

    <h2 class="section-title">Задания <button class="see-all">Смотреть все</button></h2>
    ${
      data.user_tasks.length === 0
        ? `<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>`
        : `<div class="tasks-list">${data.user_tasks
            .map(
              (ut) => `
              <div class="task-row" data-user-task-id="${ut.id}">
                <div class="ico">${ut.task.icon}</div>
                <div class="meta">
                  <h4>${escapeHtml(ut.task.name)}</h4>
                  <p>Прогресс: ${ut.progress} / ${ut.task.target_progress} · Награда: ${ut.task.reward}</p>
                </div>
                <span style="color: var(--success); font-size:18px">●</span>
              </div>`,
            )
            .join("")}</div>`
    }
  `;

  root.querySelectorAll('[data-action="gift"]').forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openGiftDialog(b.dataset.itemId);
    }),
  );
  root.querySelectorAll('[data-action="activate"]').forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await post("/api/profile/inventory/activate", { item_id: Number(b.dataset.itemId), recipient: "", quantity: 1 });
        window.kov.toast("Предмет активирован");
        renderProfile(root);
      } catch (err) {
        window.kov.toast(err.message);
      }
    }),
  );

  root.querySelector('[data-action="transfer"]').addEventListener("click", () => openTransferDialog(user));
  root.querySelector('[data-action="receive"]').addEventListener("click", () => openReceiveDialog(user));

  root.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = Number(row.dataset.userTaskId);
      const ut = data.user_tasks.find((u) => u.id === id);
      if (ut) openUserTaskDialog(ut, root);
    });
  });
}

function openTransferDialog(user) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Перевод монет</h2>
    <p style="color:var(--text-soft); font-size:13px">Баланс: ${user.balance} монет</p>
    <label class="field-label">Получатель (username без @ или Telegram ID)</label>
    <input class="input" id="recipient" placeholder="omar" />
    <label class="field-label">Сумма</label>
    <input class="input" id="amount" type="number" min="1" />
    <button class="btn" id="send-btn" style="margin-top:14px">Отправить</button>
  `);
  modal.querySelector("#send-btn").addEventListener("click", async () => {
    const recipient = modal.querySelector("#recipient").value.trim();
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

function openReceiveDialog(user) {
  window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Получить монеты</h2>
    <p style="color:var(--text-soft); font-size:14px; margin-top:8px">Скажи отправителю свой username или Telegram ID:</p>
    <div style="background: var(--surface-2); border-radius: 12px; padding: 14px; margin-top: 10px; text-align:center;">
      <div style="font-size:13px; color:var(--text-soft)">Username</div>
      <div style="font-size:18px; font-weight:700">@${user.username || "—"}</div>
      <div style="font-size:13px; color:var(--text-soft); margin-top:10px">Telegram ID</div>
      <div style="font-size:18px; font-weight:700">${user.telegram_id}</div>
    </div>
    <button class="btn btn-secondary" style="margin-top:14px" onclick="closeModal()">Закрыть</button>
  `);
}

function openGiftDialog(itemId) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Подарить предмет</h2>
    <label class="field-label">Кому (username или Telegram ID)</label>
    <input class="input" id="r" />
    <label class="field-label">Количество</label>
    <input class="input" id="q" type="number" min="1" value="1" />
    <button class="btn" id="ok" style="margin-top:14px">Подарить</button>
  `);
  modal.querySelector("#ok").addEventListener("click", async () => {
    const recipient = modal.querySelector("#r").value.trim();
    const quantity = Number(modal.querySelector("#q").value);
    if (!recipient || !quantity) return window.kov.toast("Заполни поля");
    try {
      await post("/api/profile/inventory/gift", { recipient, item_id: Number(itemId), quantity });
      window.kov.toast("Подарено");
      window.closeModal();
      window.kov.setTab("profile");
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}

function openUserTaskDialog(ut, root) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="task-card-icon">${ut.task.icon}</div>
    <h2 style="text-align:center;margin-top:0">${escapeHtml(ut.task.name)}</h2>
    <div style="text-align:center; margin: 2px 0 10px"><span style="background:var(--primary-soft); color:var(--primary-700); padding: 3px 10px; border-radius:8px; font-size:12px; font-weight:600">В процессе</span></div>
    <p style="color:var(--text-soft); font-size:14px; margin: 0 0 14px">${escapeHtml(ut.task.description)}</p>
    <div class="task-card-reward">Награда: <span style="color: var(--accent)">🪙</span> ${ut.task.reward} монет</div>
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
