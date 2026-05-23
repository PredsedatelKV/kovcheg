import { get, post, iconHtml, productImg } from "/static/api.js?v=30";

import { playUISound } from "/static/pages/settings.js?v=30";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GAME_META = {
  tictactoe: { name: "Крестики-нолики", icon: "/static/img/ui/tic-tac-toe.svg" },
  checkers:  { name: "Шашки",           icon: "/static/img/ui/checkers.svg" },
  chess:     { name: "Шахматы",         icon: "/static/img/ui/chess.svg" },
  pingpong:  { name: "Пинг-понг",       icon: "/static/img/ui/pingpong.svg" },
  tanks:     { name: "Танчики",         icon: "/static/img/ui/tank.svg" },
};
let invitePollTimer = null;

function kovbaksWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "Ковбаксов";
  if (last === 1) return "Ковбакс";
  if (last >= 2 && last <= 4) return "Ковбакса";
  return "Ковбаксов";
}

function invCell(row) {
  return `
    <div class="inv-cell" data-item-id="${row.item.id}" data-qty="${row.quantity}">
      <span class="qty">×${row.quantity}</span>
      ${productImg(row.item, "lg")}
      <div class="name">${escapeHtml(row.item.name)}</div>
    </div>`;
}

function userTaskRow(ut) {
  return `
    <div class="task-row" data-user-task-id="${ut.id}">
      <div class="meta">
        <h4>${escapeHtml(ut.task.name)}</h4>
        <p>Награда: ${ut.task.reward} K</p>
      </div>
      <span style="color: var(--success); font-size:18px">●</span>
    </div>`;
}

export async function renderProfile(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/profile/me");
  const user = data.user;
  const photoOrEmoji = user.photo_url
    ? `<img src="${escapeHtml(user.photo_url)}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:14px" />`
    : `<img src="/static/img/villager.svg" alt="Житель" class="hero-img hero-img-head"/>`;

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
        ${data.inventory.length > 8 ? `<button class="see-all" data-action="all-inv">Смотреть все</button>` : ""}
      </div>
      <div class="inv-grid">
        ${data.inventory.length === 0
          ? `<div class="empty" style="grid-column: 1/-1">Пока пусто. Купи что-нибудь в Коверне или получи задание.</div>`
          : data.inventory.slice(0, 8).map(invCell).join("")}
      </div>
    </div>

    <div class="card wallet-card">
      <div class="inv-row-title">
        <h3 class="card-title">Кошелёк</h3>
      </div>
      <div class="wallet-row">
        <div class="wallet-balance-big">
          <img src="/static/img/ui/coin.svg" alt="" class="wallet-coin"/>
          <div class="wallet-balance-num">
            <div class="wallet-balance-value"><strong>${user.balance}</strong> <span class="wallet-balance-unit">${kovbaksWord(user.balance)}</span></div>
          </div>
        </div>
        <button class="btn btn-transfer-compact" data-action="transfer-history">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>
        <button class="btn btn-transfer-compact" data-action="transfer">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/>
            <polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="card chat-card">
      <div class="inv-row-title">
        <h3 class="card-title">Чат</h3>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="empty">Загрузка…</div>
      </div>
      <div class="chat-input-row">
        <button class="chat-game-btn" id="game-invite-toggle">
          <img src="/static/img/ui/gamepad.svg" alt="" width="24" height="24"/>
        </button>
        <button class="chat-sticker-btn" id="sticker-toggle">
          <img src="/static/img/ui/sticker_btn.svg" alt="" width="24" height="24"/>
        </button>
        <div class="chat-stickers" id="chat-stickers">
          <img src="/static/img/stickers/moshonka_hi.svg" alt="" class="chat-sticker" data-sticker="moshonka_hi"/>
          <img src="/static/img/stickers/moshonka_laugh.svg" alt="" class="chat-sticker" data-sticker="moshonka_laugh"/>
          <img src="/static/img/stickers/moshonka_angry.svg" alt="" class="chat-sticker" data-sticker="moshonka_angry"/>
          <img src="/static/img/stickers/moshonka_middle.svg" alt="" class="chat-sticker" data-sticker="moshonka_middle"/>
          <img src="/static/img/stickers/kovcheg.svg" alt="" class="chat-sticker" data-sticker="kovcheg"/>
          <img src="/static/img/stickers/mine.svg" alt="" class="chat-sticker" data-sticker="mine"/>
          <img src="/static/img/stickers/coin.svg" alt="" class="chat-sticker" data-sticker="coin"/>
          <img src="/static/img/stickers/heart.svg" alt="" class="chat-sticker" data-sticker="heart"/>
          <img src="/static/img/stickers/fire.svg" alt="" class="chat-sticker" data-sticker="fire"/>
        </div>
        <input type="text" class="chat-input" id="chat-input" placeholder="Написать сообщение…" maxlength="500"/>
        <button class="btn btn-sm chat-send-btn" id="chat-send-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
    </div>

    <h2 class="section-title">Задания ${data.user_tasks.length > 3 ? `<button class="see-all" data-action="all-mytasks">Смотреть все</button>` : ""}</h2>
    ${
      data.user_tasks.length === 0
        ? `<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>`
        : `<div class="tasks-list">${data.user_tasks.slice(0, 3).map(userTaskRow).join("")}</div>`
    }
  `;

  bindCellActions(root, data.inventory);
  root.querySelector('[data-action="transfer"]').addEventListener("click", () => openTransferDialog(user));
  root.querySelector('[data-action="transfer-history"]').addEventListener("click", () => openTransactionHistory());

  root.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = Number(row.dataset.userTaskId);
      const ut = data.user_tasks.find((u) => u.id === id);
      if (ut) openUserTaskDialog(ut, root);
    });
  });

  const allInvBtn = root.querySelector('[data-action="all-inv"]');
  if (allInvBtn) allInvBtn.addEventListener("click", () => openAllInventory(data.inventory, root));
  const allMyTasksBtn = root.querySelector('[data-action="all-mytasks"]');
  if (allMyTasksBtn) allMyTasksBtn.addEventListener("click", () => openAllMyTasks(data.user_tasks, root));

  loadChat(root);
  bindChatInput(root);
  checkPendingInvites(root);
  startInvitePoll(root);
}

function startInvitePoll(root) {
  clearInterval(invitePollTimer);
  invitePollTimer = setInterval(() => checkPendingInvites(root, true), 5000);
}

async function checkPendingInvites(root, silent) {
  try {
    const data = await get("/api/game/my-invites");
    const invites = data.invites || [];
    const pending = invites.filter(i => i.status === "pending" && i.to_user_id === window.kov.me?.id);
    
    if (pending.length > 0) {
      const existing = document.querySelector(".invite-modal-open");
      if (existing) return;

      const invite = pending[0];
      
      const modal = window.kov.showModal(`
        <button class="close" onclick="closeModal()">×</button>
        <h2>Приглашение на игру</h2>
        <p class="card-sub">${escapeHtml(invite.from_user_name)} приглашает тебя в ${GAME_META[invite.game]?.name || invite.game}</p>
        <div style="display:flex;gap:12px;margin-top:20px">
          <button class="btn btn-primary" id="accept-invite-btn">Принять</button>
          <button class="btn btn-outline" id="decline-invite-btn">Отклонить</button>
        </div>
      `);
      modal.classList.add("invite-modal-open");
      
      modal.querySelector("#accept-invite-btn").addEventListener("click", async () => {
        await post("/api/game/accept", { invite_id: invite.id });
        closeModal();
        window.kov.toast("Принято! Начинаем игру...");
        clearInterval(invitePollTimer);
        startGameInChat(invite.game, root);
      });
      
      modal.querySelector("#decline-invite-btn").addEventListener("click", async () => {
        await post("/api/game/decline", { invite_id: invite.id });
        closeModal();
      });
    }
  } catch (e) {}
}

function startGameInChat(game, root) {
  const container = root.querySelector("#chat-messages");
  if (!container) return;

  const inlineGames = ["tictactoe"];
  
  if (inlineGames.includes(game)) {
    const gameContainer = document.createElement("div");
    gameContainer.id = "game-in-chat";
    container.innerHTML = "";
    container.appendChild(gameContainer);
    
    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-sm";
    backBtn.textContent = "← Вернуться в чат";
    backBtn.style.marginBottom = "12px";
    backBtn.addEventListener("click", () => {
      gameContainer.remove();
      loadChat(root);
      startInvitePoll(root);
    });
    gameContainer.appendChild(backBtn);
    
    const gameTitle = document.createElement("h3");
    gameTitle.textContent = GAME_META[game]?.name || game;
    gameTitle.style.margin = "0 0 12px";
    gameContainer.appendChild(gameTitle);
    
    if (window.kov.arcade && window.kov.arcade[game]) {
      window.kov.arcade[game](gameContainer);
    }
  } else {
    if (window.kov.arcade && window.kov.arcade[game]) {
      window.kov.arcade[game]();
    }
  }
}

window.startGameInChat = startGameInChat;

async function loadChat(root) {
  const container = root.querySelector("#chat-messages");
  if (!container) return;
  try {
    const messages = await get("/api/chat/messages?limit=50");
    const me = window.kov.me;
    function nameColor(name) {
      if (name === "Магомет") return "#4CAF50";
      if (name === "Ибрагим") return "#9C27B0";
      return "#6CB6FB";
    }
    function toMSK(iso) {
      const d = new Date(iso);
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
    }
    if (messages.length === 0) {
      container.innerHTML = `<div class="empty">Чат пуст. Напиши первым!</div>`;
      return;
    }
    container.innerHTML = messages.map((m) => {
      const time = toMSK(m.created_at);
      const isMine = me && m.user_id === me.id;
      if (m.message_type === "sticker") {
        return `<div class="chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}"><div class="chat-msg-header"><span class="chat-msg-name" style="color:${isMine ? 'var(--primary)' : nameColor(m.user_name)}">${escapeHtml(m.user_name)}</span><span class="chat-msg-time">${time}</span></div><img src="/static/img/stickers/${escapeHtml(m.content)}.svg" alt="" class="chat-msg-sticker"/></div>`;
      }
      return `<div class="chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}"><div class="chat-msg-header"><span class="chat-msg-name" style="color:${isMine ? 'var(--primary)' : nameColor(m.user_name)}">${escapeHtml(m.user_name)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${escapeHtml(m.content)}</div></div>`;
    }).join("");
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<div class="empty">Ошибка загрузки</div>`;
  }
}

function bindChatInput(root) {
  const input = root.querySelector("#chat-input");
  const sendBtn = root.querySelector("#chat-send-btn");
  const stickerToggle = root.querySelector("#sticker-toggle");
  const stickersPanel = root.querySelector("#chat-stickers");
  const gameInviteToggle = root.querySelector("#game-invite-toggle");
  if (!input || !sendBtn) return;

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await post("/api/chat/send", { content: text, message_type: "text" });
      loadChat(root);
    } catch (err) {
      window.kov.toast(err.message);
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });

  if (stickerToggle && stickersPanel) {
    stickerToggle.addEventListener("click", () => {
      stickersPanel.classList.toggle("open");
    });
  }

  root.querySelectorAll(".chat-sticker").forEach((st) => {
    st.addEventListener("click", async () => {
      try {
        await post("/api/chat/send", { content: st.dataset.sticker, message_type: "sticker" });
        if (stickersPanel) stickersPanel.classList.remove("open");
        loadChat(root);
      } catch (err) {
        window.kov.toast(err.message);
      }
    });
  });

  if (gameInviteToggle) {
    gameInviteToggle.addEventListener("click", async () => {
      const games = [
        { id: "tictactoe", name: "Крестики-нолики", icon: "/static/img/ui/tic-tac-toe.svg" },
        { id: "checkers", name: "Шашки", icon: "/static/img/ui/checkers.svg" },
        { id: "pingpong", name: "Пинг-понг", icon: "/static/img/ui/pingpong.svg" },
        { id: "chess", name: "Шахматы", icon: "/static/img/ui/chess.svg" },
        { id: "tanks", name: "Танчики", icon: "/static/img/ui/tank.svg" },
      ];
      
      const modal = window.kov.showModal(`
        <button class="close" onclick="closeModal()">×</button>
        <h2>Пригласить к игре</h2>
        <div class="game-invite-games">
          ${games.map(g => `
            <div class="game-invite-game" data-game="${g.id}">
              <img src="${g.icon}" alt="" class="game-icon-img" width="48" height="48"/>
              <span class="game-name">${g.name}</span>
            </div>
          `).join("")}
        </div>
      `);

      modal.querySelectorAll(".game-invite-game").forEach(btn => {
        btn.addEventListener("click", async () => {
          const gameId = btn.dataset.game;
          closeModal();
          await showPlayerPicker(gameId, root);
        });
      });
    });
  }

  async function showPlayerPicker(gameId, root) {
    try {
      const data = await get("/api/game/online");
      const players = data.online || [];
      
      const modal = window.kov.showModal(`
        <button class="close" onclick="closeModal()">×</button>
        <h2>Выбери игрока</h2>
        <p class="card-sub">Игра: ${GAME_META[gameId]?.name || gameId}</p>
        <div class="player-picker-list">
          ${players.length === 0 ? '<div class="empty">Нет онлайн игроков</div>' : 
            players.map(p => `
              <div class="player-picker-item" data-id="${p.id}">
                <span class="player-avatar">${p.first_name?.[0] || "?"}</span>
                <span class="player-name">${escapeHtml(p.first_name || "Игрок")}</span>
                <span class="player-status online">●</span>
              </div>
            `).join("")}
        </div>
      `);

      modal.querySelectorAll(".player-picker-item").forEach(item => {
        item.addEventListener("click", async () => {
          const playerId = Number(item.dataset.id);
          closeModal();
          try {
            await post("/api/game/invite", { game: gameId, to_user_id: playerId });
            window.kov.toast("Приглашение отправлено!");
            loadChat(root);
          } catch (err) {
            window.kov.toast(err.message);
          }
        });
      });
    } catch (err) {
      window.kov.toast("Не удалось загрузить игроков");
    }
  }
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
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="item-actions-head">
      ${productImg(item, "xl")}
      <h2>${escapeHtml(item.name)}</h2>
      <p class="card-sub">${escapeHtml(item.description || "")}</p>
      <div class="item-meta">×${row.quantity}${item.category ? ` · ${escapeHtml(item.category)}` : ""}</div>
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
      <button class="btn" id="ia-activate">
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
    try {
      await post("/api/profile/inventory/activate", { item_id: item.id, recipient: "", quantity: 1 });
      window.kov.toast(`✨ «${item.name}» активирован`);
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
    <h2>Перевод K</h2>
    <p style="color:var(--text-soft); font-size:13px">Баланс: <strong>${user.balance}</strong> ${kovbaksWord(user.balance)}</p>
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

function fmtTxnDate(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

async function openTransactionHistory() {
  try {
    const txns = await get("/api/profile/transactions");
    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2>История операций</h2>
      <p class="card-sub" style="margin:0 0 12px">Последние ${txns.length} переводов и поступлений</p>
      <div style="max-height:60dvh;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
        ${txns.length === 0 ? '<div class="empty">Пока нет операций</div>' : txns.map(t => {
          const isIncoming = t.recipient_id === window.kov.me?.id;
          const otherName = isIncoming ? t.sender_name : t.recipient_name;
          const sign = isIncoming ? "+" : "−";
          const cls = isIncoming ? "txn-incoming" : "txn-outgoing";
          return `
            <div class="txn-row ${cls}">
              <div class="txn-info">
                <span class="txn-other">${escapeHtml(otherName || "—")}</span>
                ${t.note ? `<span class="txn-note">${escapeHtml(t.note)}</span>` : ""}
              </div>
              <div class="txn-right">
                <span class="txn-amount">${sign}${t.amount} K</span>
                <span class="txn-date">${fmtTxnDate(t.created_at)}</span>
              </div>
            </div>`;
        }).join("")}
      </div>
    `);
  } catch (e) {
    window.kov.toast(e.message);
  }
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
      window.kov.toast(`🎁 Подарено: «${item.name}» ×${quantity}`);
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
    <label class="field-label">Количество (макс. ${maxQty})</label>
    <input class="input" id="q" type="number" min="1" max="${maxQty}" value="1" />
    <label class="field-label">Цена за 1 шт (K)</label>
    <input class="input" id="p" type="number" min="1" value="10" />
    <p class="card-sub" style="font-size:12px; margin:8px 0 0">Предмет появится на рынке. Любой игрок сможет купить.</p>
    <button class="btn" id="ok" style="margin-top:14px">Выставить на рынок</button>
  `);

  modal.querySelector("#ok").addEventListener("click", async () => {
    const quantity = Number(modal.querySelector("#q").value);
    const price = Number(modal.querySelector("#p").value);
    if (!quantity || !price) return window.kov.toast("Заполни поля");
    try {
      await post("/api/market/list", { item_id: item.id, quantity, price });
      window.kov.toast(`🏷️ Выставлено: «${item.name}» ×${quantity} за ${price} K/шт`);
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
    <h2 style="text-align:center;margin-top:0">${escapeHtml(ut.task.name)}</h2>
    <div style="text-align:center; margin: 2px 0 10px"><span style="background:var(--primary-soft); color:var(--primary-700); padding: 3px 10px; border-radius:8px; font-size:12px; font-weight:600">В процессе</span></div>
    <p style="color:var(--text-soft); font-size:14px; margin: 0 0 14px">${escapeHtml(ut.task.description)}</p>
    <div class="task-card-reward">Награда: ${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${ut.task.reward} K</div>
    <button class="btn btn-secondary" style="margin-top:8px" onclick="closeModal()">Закрыть</button>
    <button class="btn btn-danger" id="cancel-ut" style="margin-top:8px">Прервать задание</button>
  `);

  modal.querySelector("#cancel-ut").addEventListener("click", async () => {
    try {
      await post(`/api/tasks/${ut.id}/cancel`);
      window.kov.toast("Задание прервано");
      window.closeModal();
      renderProfile(document.getElementById("view"));
    } catch (e) {
      window.kov.toast(e.message);
    }
  });
}

async function openQuiz(quizId, root) {
  let questions;
  try {
    questions = await get(`/api/quiz/${quizId}/start`);
  } catch (err) {
    window.kov.toast(err.message);
    return;
  }
  if (!questions.length) {
    window.kov.toast("В тесте нет вопросов");
    return;
  }

  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2 style="text-align:center;margin-top:0">Тест</h2>
    <div id="quiz-questions"></div>
    <button class="btn" id="quiz-submit" style="margin-top:16px">Ответить</button>
  `);

  const container = modal.querySelector("#quiz-questions");
  container.innerHTML = questions.map((q, i) => `
    <div class="quiz-q-block" data-qid="${q.id}">
      <p class="quiz-q-text">${i + 1}. ${escapeHtml(q.text)}</p>
      <div class="quiz-options">
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="a"/> <span>A</span> ${escapeHtml(q.option_a)}</label>
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="b"/> <span>B</span> ${escapeHtml(q.option_b)}</label>
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="c"/> <span>C</span> ${escapeHtml(q.option_c)}</label>
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="d"/> <span>D</span> ${escapeHtml(q.option_d)}</label>
      </div>
    </div>
  `).join("");

  modal.querySelector("#quiz-submit").addEventListener("click", async () => {
    const answers = {};
    let allAnswered = true;
    questions.forEach((q) => {
      const selected = modal.querySelector(`input[name="q-${q.id}"]:checked`);
      if (!selected) {
        allAnswered = false;
      } else {
        answers[q.id] = selected.value;
      }
    });
    if (!allAnswered) return window.kov.toast("Ответь на все вопросы");

    try {
      const result = await post("/api/quiz/submit", { quiz_id: quizId, answers });
      if (result.grade === "excellent") playUISound("win");
      else if (result.grade === "good") playUISound("cashout");
      else playUISound("lose");
      const gradeColors = { bad: "#e74c3c", good: "#f39c12", excellent: "#27ae60" };
      const c = gradeColors[result.grade] || "#888";
      modal.innerHTML = `
        <button class="close" onclick="closeModal()">×</button>
        <div style="text-align:center; padding: 20px 0">
          <div style="font-size:48px; margin-bottom:12px">${result.grade === "excellent" ? "🏆" : result.grade === "good" ? "👍" : "😔"}</div>
          <h2 style="color:${c}; margin:0 0 8px">${result.grade_label}</h2>
          <p style="font-size:20px; margin:0 0 16px">${result.score} из ${result.total} правильных</p>
          ${result.prize_awarded
            ? `<div class="quiz-prize-awarded">🎁 Приз получен: ${escapeHtml(result.prize_label)}</div>`
            : `<div class="quiz-prize-failed">Попробуй ещё раз в следующий раз</div>`}
          <button class="btn" style="margin-top:16px" onclick="closeModal()">Закрыть</button>
        </div>
      `;
      renderProfile(root);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}
