import { get, post, iconHtml, productImg } from "/static/api.js?v=39";

import { playUISound } from "/static/pages/settings.js?v=39";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GAME_META = {
  tictactoe: { name: "Крестики-нолики", icon: "/static/img/ui/tictactoe.svg" },
  checkers:  { name: "Шашки",           icon: "/static/img/ui/checkers.svg" },
  pingpong:  { name: "Пинг-понг",       icon: "/static/img/ui/pingpong.svg" },
};
let invitePollTimer = null;
let _profileRoot = null;
let _profileData = null;

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
  _profileRoot = root;
  _profileData = null;
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/profile/me");
  _profileData = data;
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

    <div class="card" data-section="inventory">
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

    <div class="card wallet-card" data-section="balance">
      <div class="inv-row-title">
        <h3 class="card-title">Баланс</h3>
      </div>
      <div class="wallet-row">
        <div class="wallet-balance-big">
          <img src="/static/img/ui/coin.svg" alt="" class="wallet-coin"/>
          <div class="wallet-balance-num">
            <div class="wallet-balance-value"><strong>${user.balance}</strong></div>
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
      <div class="wallet-xp-row">
        <img src="/static/img/item_icons/xp.svg" alt="" class="wallet-xp-icon"/>
        <div class="wallet-xp-text">Уровень ${Math.floor(user.xp / 100)} · ${user.xp % 100} / 100 XP</div>
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

    <div data-section="tasks">
      <h2 class="section-title">Задания ${data.user_tasks.length > 3 ? `<button class="see-all" data-action="all-mytasks">Смотреть все</button>` : ""}</h2>
      ${
        data.user_tasks.length === 0
          ? `<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>`
          : `<div class="tasks-list">${data.user_tasks.slice(0, 3).map(userTaskRow).join("")}</div>`
      }
    </div>
  `;

  loadChat(root);

  // Event delegation — all profile clicks handled here, no re-binding on section update
  root.addEventListener("click", function(e) {
    var d = _profileData;
    if (!d) return;
    var actionEl = e.target.closest("[data-action]");
    if (actionEl) {
      switch (actionEl.dataset.action) {
        case "transfer": openTransferDialog(d.user); return;
        case "transfer-history": openTransactionHistory(); return;
        case "all-inv": openAllInventory(d.inventory, root); return;
        case "all-mytasks": openAllMyTasks(d.user_tasks, root); return;
        case "open-battlepass": window.kov.setTab("battlepass"); return;
      }
    }
    var itemCell = e.target.closest("[data-item-id]");
    if (itemCell) {
      var id = Number(itemCell.dataset.itemId);
      var row = d.inventory.find(function(r) { return r.item.id === id; });
      if (row) openItemActionsDialog(row);
      return;
    }
    var taskRow = e.target.closest("[data-user-task-id]");
    if (taskRow) {
      var id = Number(taskRow.dataset.userTaskId);
      var ut = d.user_tasks.find(function(u) { return u.id === id; });
      if (ut) openUserTaskDialog(ut, root);
    }
  });
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
        { id: "tictactoe", name: "Крестики-нолики", icon: "/static/img/ui/tictactoe.svg" },
        { id: "checkers", name: "Шашки", icon: "/static/img/ui/checkers.svg" },
        { id: "pingpong", name: "Пинг-понг", icon: "/static/img/ui/pingpong.svg" },
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
      const players = await get("/api/profile/players");
      
      const modal = window.kov.showModal(`
        <button class="close" onclick="closeModal()">×</button>
        <h2>Выбери игрока</h2>
        <p class="card-sub">Игра: ${GAME_META[gameId]?.name || gameId}</p>
        <div class="player-picker-list">
          ${players.length === 0 ? '<div class="empty">Нет игроков</div>' : 
            players.map(p => `
              <div class="player-picker-item" data-id="${p.id}" data-online="${p.is_online}">
                <span class="player-avatar">${p.first_name?.[0] || "?"}</span>
                <span class="player-name">${escapeHtml(p.first_name || "Игрок")}</span>
                <span class="player-status ${p.is_online ? "online" : "offline"}">${p.is_online ? "●" : "✉"}</span>
              </div>
            `).join("")}
        </div>
      `);

      modal.querySelectorAll(".player-picker-item").forEach(item => {
        item.addEventListener("click", async () => {
          const playerId = Number(item.dataset.id);
          const isOnline = item.dataset.online === "true";
          closeModal();
          try {
            if (isOnline) {
              await post("/api/game/invite", { game: gameId, to_user_id: playerId });
              window.kov.toast("Приглашение отправлено!");
            } else {
              await post("/api/game/invite-telegram", { game: gameId, to_user_id: playerId });
              window.kov.toast("Приглашение отправлено в Telegram!");
            }
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

async function _updateSections(sectionNames) {
  var root = _profileRoot;
  if (!root) return;
  try {
    var data = await get("/api/profile/me");
    _profileData = data;
    var user = data.user;
    if (window.kov.me) Object.assign(window.kov.me, user);

    if (sectionNames.indexOf("balance") !== -1) {
      var el = root.querySelector('[data-section="balance"] .wallet-balance-value');
      if (el) el.innerHTML = "<strong>" + user.balance + "</strong>";
      var xpEl = root.querySelector('[data-section="balance"] .wallet-xp-text');
      if (xpEl) xpEl.textContent = "Уровень " + Math.floor(user.xp / 100) + " · " + (user.xp % 100) + " / 100 XP";
    }

    if (sectionNames.indexOf("inventory") !== -1) {
      var section = root.querySelector('[data-section="inventory"]');
      if (section) {
        var seeAll = data.inventory.length > 8 ? '<button class="see-all" data-action="all-inv">Смотреть все</button>' : "";
        var grid = data.inventory.length === 0
          ? '<div class="inv-grid"><div class="empty" style="grid-column: 1/-1">Пока пусто. Купи что-нибудь в Коверне или получи задание.</div></div>'
          : '<div class="inv-grid">' + data.inventory.slice(0, 8).map(invCell).join("") + "</div>";
        section.innerHTML = '<div class="inv-row-title"><h3 class="card-title">Инвентарь</h3>' + seeAll + "</div>" + grid;
      }
    }

    if (sectionNames.indexOf("tasks") !== -1) {
      var section = root.querySelector('[data-section="tasks"]');
      if (section) {
        var titleBtn = data.user_tasks.length > 3 ? '<button class="see-all" data-action="all-mytasks">Смотреть все</button>' : "";
        var body = data.user_tasks.length === 0
          ? '<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>'
          : '<div class="tasks-list">' + data.user_tasks.slice(0, 3).map(userTaskRow).join("") + "</div>";
        section.innerHTML = '<h2 class="section-title">Задания ' + titleBtn + "</h2>" + body;
      }
    }
  } catch (err) {}
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
      ${item.lootbox_pool_code ? `
      <button class="btn" id="ia-open-lootbox">
        <img src="/static/img/ui/box.svg" alt="" class="icon icon-md"/>
        <span>Открыть</span>
      </button>` : `
      <button class="btn" id="ia-activate">
        <img src="/static/img/ui/spark.svg" alt="" class="icon icon-md"/>
        <span>Активировать</span>
      </button>`}
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
  modal.querySelector("#ia-activate")?.addEventListener("click", async () => {
    try {
      await post("/api/profile/inventory/activate", { item_id: item.id, recipient: "", quantity: 1 });
      window.closeModal();
      _updateSections(["inventory", "balance"]);
      window.kov.toast(`✨ «${item.name}» активирован`);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
  modal.querySelector("#ia-open-lootbox")?.addEventListener("click", async () => {
    window.closeModal();
    try {
      var pools = await get("/api/battlepass/lootbox-pools");
      var pool = pools.find(function(p) { return p.code === item.lootbox_pool_code; });
      var poolItems = pool ? pool.entries : [];
      var result = await post("/api/battlepass/open-lootbox", { item_id: item.id });
      _updateSections(["inventory", "balance"]);
      if (poolItems.length >= 1) {
        await showLootboxRoulette(poolItems, result.item);
      } else {
        window.kov.toast("🎁 " + result.item.name);
      }
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
    <p style="color:var(--text-soft); font-size:13px">Баланс: <strong>${user.balance}</strong></p>
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
      window.closeModal();
      _updateSections(["balance"]);
      window.kov.toast("Отправлено");
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}

function fmtTxnDate(iso) {
  const d = new Date(iso);
  const opts = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" };
  return d.toLocaleString("ru-RU", opts).replace(",", "");
}

async function openTransactionHistory() {
  try {
    const txns = await get("/api/profile/transactions");
    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2>История операций</h2>
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
      window.closeModal();
      _updateSections(["inventory", "balance"]);
      window.kov.toast(`🎁 Подарено: «${item.name}» ×${quantity}`);
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
      window.closeModal();
      _updateSections(["inventory", "balance"]);
      window.kov.toast(`🏷️ Выставлено: «${item.name}» ×${quantity} за ${price} K/шт`);
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
      window.closeModal();
      _updateSections(["tasks"]);
      window.kov.toast("Задание прервано");
    } catch (e) {
      window.kov.toast(e.message);
    }
  });
}

function _lootboxTick(ctx) {
  var now = ctx.currentTime;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 1200 + Math.random() * 400;
  osc.type = "sine";
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  osc.start(now);
  osc.stop(now + 0.04);
}

function _lootboxFanfare(ctx) {
  var now = ctx.currentTime;
  var notes = [523, 659, 784, 1047];
  notes.forEach(function(freq, i) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    var t = now + i * 0.12;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function _rarityColor(r) {
  var r2 = (r || "").toLowerCase();
  if (r2.indexOf("легендар") !== -1 || r2.indexOf("legend") !== -1) return "#42a5f5";
  if (r2.indexOf("эпическ") !== -1 || r2.indexOf("epic") !== -1) return "#ab47bc";
  if (r2.indexOf("редк") !== -1 || r2.indexOf("rare") !== -1) return "#66bb6a";
  if (r2.indexOf("обычн") !== -1 || r2.indexOf("common") !== -1) return "#9e9e9e";
  return "#ffd700";
}

function showLootboxRoulette(poolItems, winItem) {
  var ctx = null;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {}

  // Prepare items: show all, highlight winner
  var items = poolItems.map(function(e) { return { name: e.item_name, icon: e.item_icon, rarity: e.item_rarity || "" }; });
  // If pool is empty, just show the winner
  if (items.length === 0) items = [{ name: winItem.name, icon: winItem.icon, rarity: "" }];
  // Ensure at least 8 items for smooth scroll
  while (items.length < 8) { items = items.concat(items); }
  // Winner index in the duplicated list
  var WIN_IDX = 20;
  // Pad up to WIN_IDX + visible count
  while (items.length < WIN_IDX + 12) { items = items.concat(poolItems.map(function(e) { return { name: e.item_name, icon: e.item_icon }; })); }
  // Place winner at WIN_IDX
  items[WIN_IDX] = { name: winItem.name, icon: winItem.icon, isWinner: true };

  var overlay = document.createElement("div");
  overlay.className = "lootbox-overlay";
  overlay.innerHTML =
    '<div class="lootbox-title">🎲 Открытие ковбокса</div>' +
    '<div class="lootbox-track-wrap"><div class="lootbox-track" id="lb-track"></div></div>' +
    '<div class="lootbox-result" id="lb-result">' +
      '<div class="lootbox-result-name" id="lb-win-name"></div>' +
      '<div class="lootbox-result-rarity" id="lb-win-rarity"></div>' +
      '<button class="btn lootbox-result-btn" id="lb-close">Отлично!</button>' +
    '</div>';
  document.body.appendChild(overlay);

  var track = overlay.querySelector("#lb-track");
  items.forEach(function(it, idx) {
    var div = document.createElement("div");
    div.className = "lootbox-track-item" + (it.isWinner ? " win-target" : "");
    div.dataset.idx = idx;
    var borderColor = _rarityColor(it.rarity);
    div.style.borderColor = borderColor;
    div.style.boxShadow = "0 0 6px " + borderColor + "44";
    div.innerHTML = '<img src="' + it.icon + '" alt=""/>';
    track.appendChild(div);
  });

  var itemW = 56; // 48px + 8px gap
  var targetOffset = -(WIN_IDX * itemW - track.parentElement.offsetWidth / 2 + itemW / 2);
  var startOffset = -(items.length * itemW - track.parentElement.offsetWidth) / 2;

  // Initial position (shuffled look)
  track.style.transform = "translateX(" + startOffset + "px)";

  // Tick during animation
  var tickInterval = null;
  var tickSpeed = 60;
  function startTick() {
    if (!ctx) return;
    tickInterval = setInterval(function() {
      _lootboxTick(ctx);
    }, tickSpeed);
  }
  function updateTickSpeed(slow) {
    if (tickInterval) clearInterval(tickInterval);
    tickSpeed = slow;
    if (tickSpeed > 0) {
      tickInterval = setInterval(function() {
        if (ctx) _lootboxTick(ctx);
      }, tickSpeed);
    }
  }

  // Animation phases
  startTick();

  // Phase 1: fast scroll to near-target (3s)
  var phase1Time = 2500;
  var phase1Start = startOffset;
  var phase1End = targetOffset + itemW * 8;
  var phase1StartTime = Date.now();

  function phase1() {
    var elapsed = Date.now() - phase1StartTime;
    var p = Math.min(1, elapsed / phase1Time);
    var eased = 1 - Math.pow(1 - p, 3);
    var x = phase1Start + (phase1End - phase1Start) * eased;
    track.style.transform = "translateX(" + x + "px)";
    if (p < 1) {
      requestAnimationFrame(phase1);
    } else {
      updateTickSpeed(200);
      // Phase 2: slow final positioning (1s)
      var phase2StartTime = Date.now();
      var phase2Start = x;
      var phase2End = targetOffset;
      function phase2() {
        var elapsed2 = Date.now() - phase2StartTime;
        var p2 = Math.min(1, elapsed2 / 800);
        var eased2 = 1 - Math.pow(1 - p2, 4);
        var x2 = phase2Start + (phase2End - phase2Start) * eased2;
        track.style.transform = "translateX(" + x2 + "px)";
        if (p2 < 1) {
          requestAnimationFrame(phase2);
        } else {
          // Done!
          updateTickSpeed(0);
          if (ctx) _lootboxFanfare(ctx);
          // Highlight winner
          var allItems = track.querySelectorAll(".lootbox-track-item");
          allItems.forEach(function(el) { el.classList.remove("active"); });
          var targetEl = track.querySelector(".win-target");
          if (targetEl) {
            targetEl.classList.remove("win-target");
            targetEl.classList.add("win");
          }
          // Show result
          var result = overlay.querySelector("#lb-result");
          result.querySelector("#lb-win-name").textContent = winItem.name;
          var rarColor = _rarityColor(winItem.rarity);
          var rarEl = result.querySelector("#lb-win-rarity");
          rarEl.textContent = winItem.rarity || "";
          rarEl.style.color = rarColor;
          result.classList.add("show");
        }
      }
      requestAnimationFrame(phase2);
    }
  }
  requestAnimationFrame(phase1);

  overlay.querySelector("#lb-close").addEventListener("click", function() {
    overlay.remove();
    if (tickInterval) clearInterval(tickInterval);
    if (ctx) ctx.close();
  });
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) { overlay.remove(); if (tickInterval) clearInterval(tickInterval); if (ctx) ctx.close(); }
  });
}
