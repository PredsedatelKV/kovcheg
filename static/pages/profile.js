import { get, post, iconHtml, productImg } from "/static/api.js?v=213";

import { playUISound } from "/static/pages/settings.js?v=213";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GAME_META = {
  tictactoe: { name: "Крестики-нолики", icon: "/static/img/ui/tictactoe.svg" },
  checkers:  { name: "Шашки",           icon: "/static/img/ui/checkers.svg" },
  pingpong:  { name: "Пинг-понг",       icon: "/static/img/ui/pingpong.svg" },
};
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
      <div class="inv-row-title" style="display:flex;align-items:center;gap:8px">
        <h3 class="card-title" style="margin:0">Чат</h3>
        <div id="online-avatars" style="display:flex;gap:-4px;flex:1;overflow:hidden"></div>
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
  loadOnlineAvatars(root);

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
  // Приглашения и сетевые игры обрабатываются глобально (static/pages/multiplayer.js),
  // поэтому здесь поллинг приглашений больше не нужен.
}

const _AVATAR_COLORS = ["#4CAF50","#2196F3","#FF9800","#9C27B0","#E91E63","#00BCD4","#8BC34A","#FF5722"];

function avatarHtml(p, size) {
  // Аватарка из Telegram-профиля, иначе цветной кружок с инициалом.
  if (p && p.photo_url) {
    return `<img src="${escapeHtml(p.photo_url)}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;flex-shrink:0"/>`;
  }
  const initial = ((p && p.first_name) || "?")[0].toUpperCase();
  const color = _AVATAR_COLORS[((p && p.id) || 0) % _AVATAR_COLORS.length];
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.45)}px;font-weight:700;color:#fff;flex-shrink:0">${initial}</div>`;
}

// Аватарки игроков для перехода в профиль — показываются ВСЕГДА (онлайн — первыми).
async function loadOnlineAvatars(root) {
  try {
    const data = await get("/api/profile/players");
    const container = root.querySelector("#online-avatars");
    if (!container) return;
    if (!data || data.length === 0) { container.innerHTML = ""; return; }
    const players = [...data]
      .sort((a, b) => (a.is_online === b.is_online ? 0 : a.is_online ? -1 : 1))
      .slice(0, 12);
    container.innerHTML = players.map((p, idx) => {
      const ring = p.is_online ? "#4CAF50" : "var(--border)";
      const dot = p.is_online
        ? '<span style="position:absolute;right:-1px;bottom:-1px;width:8px;height:8px;border-radius:50%;background:#4CAF50;border:1.5px solid var(--bg)"></span>'
        : "";
      // Первая аватарка отступает вправо от слова «Чат», остальные перекрываются.
      const ml = idx === 0 ? "10px" : "-8px";
      return `<div data-player-id="${p.id}" title="${escapeHtml(p.first_name || "Игрок")}" style="position:relative;cursor:pointer;flex-shrink:0;margin-left:${ml};border-radius:50%;border:2px solid ${ring};line-height:0">${avatarHtml(p, 26)}${dot}</div>`;
    }).join("");
    container.querySelectorAll("[data-player-id]").forEach(el => {
      el.addEventListener("click", async () => {
        const pid = Number(el.dataset.playerId);
        try {
          const profile = await get("/api/profile/" + pid);
          const online = profile.is_online;
          window.kov.showModal(`
            <button class="close" onclick="closeModal()">×</button>
            <div style="text-align:center;padding:12px">
              <div style="margin:0 auto 8px;width:64px;height:64px">${avatarHtml(profile, 64)}</div>
              <h3 style="margin:0">${escapeHtml(profile.first_name || "Игрок")}</h3>
              ${profile.role ? '<div style="color:var(--text-muted);font-size:13px">' + escapeHtml(profile.role) + '</div>' : ''}
              ${profile.username ? '<div style="color:var(--text-muted);font-size:13px">@' + escapeHtml(profile.username) + '</div>' : ''}
              <div style="margin-top:8px;font-size:13px">Баланс: <strong>${profile.balance || 0}</strong> К</div>
              <div style="margin-top:4px;font-size:12px;color:${online ? '#4CAF50' : 'var(--text-muted)'}">${online ? '● онлайн' : 'не в сети'}</div>
            </div>
          `);
        } catch (e) { window.kov.toast(e.message); }
      });
    });
  } catch (e) { /* non-critical: avatars stay empty */ }
}

// Сетевые игры теперь в static/pages/multiplayer.js (модалка, общий поллер).

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
      // created_at — наивный UTC ("...T..."), без Z трактуется как локальное время.
      // Принудительно считаем как UTC и переводим в МСК.
      const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
    }
    if (messages.length === 0) {
      container.innerHTML = `<div class="empty">Чат пуст. Напиши первым!</div>`;
      return;
    }
    container.innerHTML = messages.map((m) => {
      const time = m.created_at_msk || toMSK(m.created_at);
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
    try {
      await post("/api/chat/send", { content: text, message_type: "text" });
      input.value = "";
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
          closeModal();
          try {
            // Сервер сам решает: онлайн — придёт в приложение, оффлайн — в Telegram.
            const r = await post("/api/game/invite", { game: gameId, to_user_id: playerId });
            window.kov.toast(r.delivered === "telegram" ? "Приглашение отправлено в Telegram!" : "Приглашение отправлено!");
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
      if (poolItems.length > 1) {
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

function showLootboxRoulette(poolItems, winItem) {
  var ctx = null;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {}

  var items = [];
  var REPEAT = 6;
  var totalPool = poolItems.length;
  for (var r = 0; r < REPEAT; r++) {
    for (var i = 0; i < totalPool; i++) {
      items.push({ name: poolItems[i].item_name, icon: poolItems[i].item_icon });
    }
  }
  var WIN_IDX = Math.floor(items.length / 2);
  items[WIN_IDX] = { name: winItem.name, icon: winItem.icon, isWinner: true };

  var overlay = document.createElement("div");
  overlay.className = "lootbox-overlay";
  overlay.innerHTML =
    '<div class="lootbox-title">Открытие ковбокса</div>' +
    '<div class="lootbox-track-wrap"><div class="lootbox-pointer"></div><div class="lootbox-track" id="lb-track"></div></div>' +
    '<div class="lootbox-result" id="lb-result">' +
      '<div class="lootbox-result-name" id="lb-win-name"></div>' +
      '<div class="lootbox-result-rarity" id="lb-win-rarity"></div>' +
      '<button class="btn lootbox-result-btn" id="lb-close">Отлично!</button>' +
    '</div>';
  document.body.appendChild(overlay);

  var track = overlay.querySelector("#lb-track");
  items.forEach(function(it) {
    var div = document.createElement("div");
    div.className = "lootbox-track-item" + (it.isWinner ? " win-target" : "");
    div.innerHTML = '<img src="' + it.icon + '" alt=""/>';
    track.appendChild(div);
  });

  var tickInterval = null;
  var tickSpeed = 50;

  function startTick() {
    if (!ctx) return;
    tickInterval = setInterval(function() { _lootboxTick(ctx); }, tickSpeed);
  }
  function stopTick() {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  }

  requestAnimationFrame(function() {
    var wrapW = track.parentElement.offsetWidth;
    if (!wrapW || wrapW < 50) wrapW = 340;
    var ITEM_W = 64;
    var targetX = -(WIN_IDX * ITEM_W - wrapW / 2 + ITEM_W / 2);
    var startX = targetX + wrapW * 8;

    track.style.transition = "none";
    track.style.transform = "translateX(" + startX + "px)";
    track.offsetHeight;

    startTick();

    track.style.transition = "transform 4.5s cubic-bezier(0.15, 0.85, 0.25, 1)";
    track.style.transform = "translateX(" + targetX + "px)";

    var slowTimers = [];
    [1500, 2500, 3500].forEach(function(t) {
      slowTimers.push(setTimeout(function() {
        stopTick();
        tickSpeed = Math.min(tickSpeed + 80, 300);
        startTick();
      }, t));
    });

    track.addEventListener("transitionend", function handler() {
      track.removeEventListener("transitionend", handler);
      stopTick();
      if (ctx) _lootboxFanfare(ctx);

      var targetEl = track.querySelector(".win-target");
      if (targetEl) {
        targetEl.classList.remove("win-target");
        targetEl.classList.add("win");
        targetEl.classList.add("win-rarity-" + (winItem.rarity || "Обычный"));
      }
      var result = overlay.querySelector("#lb-result");
      result.querySelector("#lb-win-name").textContent = winItem.name;
      result.querySelector("#lb-win-rarity").textContent = winItem.rarity || "";
      result.querySelector("#lb-win-rarity").className = "lootbox-result-rarity rr-" + (winItem.rarity || "Обычный");
      result.classList.add("show");
    });
  });

  overlay.querySelector("#lb-close").addEventListener("click", function() {
    overlay.remove();
  });
}
