import { get, post, iconHtml, productImg, versionedAssetUrl } from "/static/api.js?v=284";

import { playUISound, getSettings, playManagedMedia } from "/static/pages/settings.js?v=284";
import { mountCharacterCard } from "/static/pages/character.js?v=274";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GAME_META = {
  tictactoe: { name: "Крестики-нолики", icon: "/static/img/ui/tictactoe.svg" },
  checkers:  { name: "Шашки",           icon: "/static/img/ui/checkers.svg" },
  pingpong:  { name: "Пинг-понг",       icon: "/static/img/ui/pingpong.svg" },
};
let _profileRoot = null;
let _profileData = null;

function makeLootboxRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return "lb_" + Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
  }
  return "lb_" + Date.now() + "_" + String(performance.now()).replace(".", "");
}

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
    <div class="inv-cell item-${escapeHtml(row.item.code)}" data-item-id="${row.item.id}" data-qty="${row.quantity}">
      <span class="qty">×${row.quantity}</span>
      ${productImg(row.item, "lg")}
      <div class="name">${escapeHtml(row.item.name)}</div>
    </div>`;
}

function taskRewardsHtml(t) {
  const rewards = [];
  if (Number(t.reward) > 0) rewards.push(`<span class="task-reward-badge">${iconHtml("/static/img/ui/kovbaks.png", "sm", "")} ${t.reward} ковбаксов</span>`);
  if (Number(t.xp_reward) > 0) rewards.push(`<span class="task-reward-badge">${iconHtml("/static/img/ui/xp.png", "sm", "")} ${t.xp_reward} XP</span>`);
  if (t.reward_item_id && Number(t.reward_item_quantity) > 0) {
    rewards.push(`<span class="task-reward-badge">${iconHtml(t.reward_item_icon || "/static/img/ui/box.svg", "sm", "")} ×${t.reward_item_quantity} ${escapeHtml(t.reward_item_name || "предмет")}</span>`);
  }
  return rewards.length ? `<span class="task-rewards">${rewards.join("")}</span>` : `<span class="task-rewards">Без награды</span>`;
}

function userTaskRow(ut) {
  return `
    <div class="task-row" data-user-task-id="${ut.id}">
      <div class="meta">
        <h4>${escapeHtml(ut.task.name)}</h4>
        <p>Награда: ${taskRewardsHtml(ut.task)}</p>
      </div>
      <span style="color: var(--success); font-size:18px">●</span>
    </div>`;
}

export async function renderProfile(root) {
  _profileRoot = root;
  _profileData = null;
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/profile/me", { force: true });
  data.inventory = (data.inventory || []).filter((row) => !row.item?.skin_slot);
  _profileData = data;
  const user = data.user;
  const photoOrEmoji = user.photo_url
    ? `<img src="${escapeHtml(user.photo_url)}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:14px" />`
    : `<img src="/static/img/villager.svg" alt="Житель" class="hero-img hero-img-head"/>`;

  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${escapeHtml(user.first_name || "Гражданин")}</h1>
        <div class="subtitle">${escapeHtml(user.role)}</div>
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

    <div class="profile-overview-grid">
      <div class="card wallet-card profile-overview-card" data-section="balance">
        <div class="inv-row-title profile-compact-title">
          <h3 class="card-title">Баланс</h3>
          <div class="wallet-actions">
            <button class="btn btn-transfer-compact" data-action="transfer-history" aria-label="История переводов">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
            <button class="btn btn-transfer-compact" data-action="transfer" aria-label="Перевести">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="wallet-balance-big">
          <img src="/static/img/ui/kovbaks.png" alt="" class="wallet-coin"/>
          <div class="wallet-balance-num">
            <div class="wallet-balance-value"><strong>${user.balance}</strong></div>
          </div>
        </div>
        <div class="wallet-xp-row">
          <img src="/static/img/ui/xp.png" alt="" class="wallet-xp-icon"/>
          <div class="wallet-xp-text wallet-level-value"><strong>${data.bp_level || 0}</strong></div>
        </div>
      </div>
      <div id="character-card" class="character-card-mount"></div>
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
      <h3 class="card-title profile-section-title">Задания ${data.user_tasks.length > 3 ? `<button class="see-all" data-action="all-mytasks">Смотреть все</button>` : ""}</h3>
      ${
        data.user_tasks.length === 0
          ? `<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>`
          : `<div class="tasks-list">${data.user_tasks.slice(0, 3).map(userTaskRow).join("")}</div>`
      }
    </div>
  `;

  mountCharacterCard(root, {
    onGift: (row) => openGiftDialog(row.item, row.quantity),
    onSell: (row) => openSellDialog(row.item, row.quantity),
  });
  loadChat(root);
  loadOnlineAvatars(root);

  // Event delegation — all profile clicks handled here, no re-binding on section update
  if (!root._profileDelegationBound) {
    root._profileDelegationBound = true;
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
  }
  bindChatInput(root);
  setTimeout(resumePendingLootboxReveal, 0);
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
              <div style="margin-top:10px;font-size:13px;display:flex;gap:14px;justify-content:center;align-items:center;flex-wrap:wrap">
                <span><strong>${profile.balance || 0}</strong> К</span>
                <span style="color:var(--primary);font-weight:600">Пропуск ур. ${profile.bp_level ?? 0}</span>
              </div>
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
    var data = await get("/api/profile/me", { force: true });
    data.inventory = (data.inventory || []).filter(function(row) { return !row.item || !row.item.skin_slot; });
    _profileData = data;
    var user = data.user;
    if (window.kov.me) Object.assign(window.kov.me, user);

    if (sectionNames.indexOf("balance") !== -1) {
      var el = root.querySelector('[data-section="balance"] .wallet-balance-value');
      if (el) el.innerHTML = "<strong>" + user.balance + "</strong>";
      var xpEl = root.querySelector('[data-section="balance"] .wallet-level-value strong');
      if (xpEl) xpEl.textContent = String(data.bp_level ?? 0);
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

    if (sectionNames.indexOf("character") !== -1) {
      mountCharacterCard(root, {
        onGift: (row) => openGiftDialog(row.item, row.quantity),
        onSell: (row) => openSellDialog(row.item, row.quantity),
      });
    }

    if (sectionNames.indexOf("tasks") !== -1) {
      var section = root.querySelector('[data-section="tasks"]');
      if (section) {
        var titleBtn = data.user_tasks.length > 3 ? '<button class="see-all" data-action="all-mytasks">Смотреть все</button>' : "";
        var body = data.user_tasks.length === 0
          ? '<div class="empty">Нет активных заданий. Начни задание на вкладке «Главная».</div>'
          : '<div class="tasks-list">' + data.user_tasks.slice(0, 3).map(userTaskRow).join("") + "</div>";
        section.innerHTML = '<h3 class="card-title profile-section-title">Задания ' + titleBtn + "</h3>" + body;
      }
    }
  } catch (err) {
    // Keep the last confirmed UI instead of replacing it with an error/skeleton.
    console.warn("Не удалось обновить разделы профиля", err);
    window.kov.toast("Не удалось обновить данные. Показано последнее сохранённое состояние.");
  }
}

function bindCellActions(scope, inventory, options = {}) {
  scope.querySelectorAll(".inv-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const id = Number(cell.dataset.itemId);
      const row = inventory.find((r) => r.item.id === id);
      if (row) openItemActionsDialog(row, options);
    });
  });
}

function openItemActionsDialog(row, options = {}) {
  const item = row.item;
  const canGift = item.can_gift;
  const assemblyCost = _profileData?.fragment_assembly_cost || 10;
  const isBoxFragment = item.code === "box_fragment";
  const isFailureFragment = item.code === "failure_fragment";
  const isFragment = isBoxFragment || isFailureFragment;
  const activeFragmentCost = isFailureFragment ? (_profileData?.failure_fragment_cost || 10) : assemblyCost;
  const canActivate = !item.lootbox_pool_code && (item.can_activate || isFragment);
  const activationLocked = isFragment && row.quantity < activeFragmentCost;
  const openRequestId = makeLootboxRequestId();
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="item-actions-head">
      ${productImg(item, "xl")}
      <h2>${escapeHtml(item.name)}</h2>
      <div class="item-meta">×${row.quantity}${item.category ? ` · ${escapeHtml(item.category)}` : ""}</div>
    </div>
    <div class="item-actions-grid">
      <button class="btn btn-outline" id="ia-gift" ${canGift ? "" : "disabled"}>
        <img src="/static/img/ui/gift.svg" alt="" class="icon icon-md"/>
        <span>Подарить</span>
      </button>
      ${canActivate ? `<button class="btn btn-outline" id="ia-activate" ${activationLocked ? "disabled" : ""} title="${activationLocked ? `Нужно ${activeFragmentCost} фрагментов` : ""}">
        <img src="/static/img/ui/spark.svg" alt="" class="icon icon-md"/>
        <span>${isFragment ? (activationLocked ? `Активировать · нужно ${activeFragmentCost}` : `Активировать · ×${activeFragmentCost}`) : "Активировать"}</span>
      </button>` : ""}
      ${row.item.skin_slot ? `<button class="btn btn-outline" id="ia-equip">
        <img src="/static/img/ui/spark.svg" alt="" class="icon icon-md"/>
        <span>Надеть</span>
      </button>` : ""}
      <button class="btn btn-outline" id="ia-sell" ${canGift ? "" : "disabled"}>
        <img src="/static/img/ui/kovbaks.png" alt="" class="icon icon-md"/>
        <span>Продать</span>
      </button>
      ${item.lootbox_pool_code ? `
      <button class="btn" id="ia-open-lootbox">
        <img src="/static/img/ui/box.svg" alt="" class="icon icon-md"/>
        <span>Открыть</span>
      </button>` : ""}
    </div>
  `, { stack: Boolean(options.stack) });

  modal.querySelector("#ia-gift").addEventListener("click", () => {
    if (!canGift) return;
    window.closeModal();
    setTimeout(() => openGiftDialog(item, row.quantity), 80);
  });
  modal.querySelector("#ia-sell").addEventListener("click", () => {
    if (!canGift) return;
    window.closeModal();
    setTimeout(() => openSellDialog(item, row.quantity), 80);
  });
  modal.querySelector("#ia-equip")?.addEventListener("click", async () => {
    const button = modal.querySelector("#ia-equip");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await post("/api/profile/skins/equip", {
        item_id: row.item.id,
        slot: row.item.skin_slot,
      });
      window.kov.toast(`«${row.item.name}» надет`);
      closeModal();
    } catch (error) {
      button.disabled = false;
      window.kov.toast(error.message || "Не удалось надеть скин");
    }
  });

  modal.querySelector("#ia-activate")?.addEventListener("click", async () => {
    const button = modal.querySelector("#ia-activate");
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (isFragment) {
        var assembled = await post(isFailureFragment
          ? "/api/profile/inventory/assemble-failure-fragments"
          : "/api/profile/inventory/assemble-fragments");
        window.kov.toast("🎁 Вы получили: " + assembled.item_name);
      } else {
        await post("/api/profile/inventory/activate", { item_id: item.id, recipient: "", quantity: 1 });
        window.kov.toast(`✨ «${item.name}» активирован`);
      }
      window.closeModal();
      _updateSections(["inventory", "balance", "character"]);
    } catch (err) {
      button.disabled = false;
      window.kov.toast(err.message);
    }
  });
  modal.querySelector("#ia-open-lootbox")?.addEventListener("click", async () => {
    const button = modal.querySelector("#ia-open-lootbox");
    if (button.disabled) return;
    button.disabled = true;
    // Initialise the shared WebAudio context while the user gesture is still
    // active; Telegram/iOS may block contexts created only after network awaits.
    playUISound("click");
    try {
      var result = await post("/api/profile/inventory/open-lootbox", {
        item_id: item.id,
        request_id: openRequestId,
      });
      window.closeModal();
      _updateSections(["inventory", "balance", "character"]);
      try { sessionStorage.setItem("kovcheg.pendingLootboxReveal", JSON.stringify(result)); } catch (_) {}
      showLootboxExperience(result);
    } catch (err) {
      button.disabled = false;
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
  bindCellActions(modal, inventory, { stack: true });
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

  modal.querySelector("#send-btn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const recipient = select.value;
    const amount = Number(modal.querySelector("#amount").value);
    if (!recipient || !amount) return window.kov.toast("Заполни поля");
    button.disabled = true;
    button.textContent = "Отправляем…";
    try {
      await post("/api/profile/transfer", { recipient, amount });
      window.closeModal();
      _updateSections(["balance"]);
      window.kov.toast("Отправлено");
    } catch (err) {
      button.disabled = false;
      button.textContent = "Отправить";
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

  modal.querySelector("#ok").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const recipient = select.value;
    const quantity = Number(modal.querySelector("#q").value);
    if (!recipient || !quantity) return window.kov.toast("Заполни поля");
    button.disabled = true;
    button.textContent = "Отправляем…";
    try {
      await post("/api/profile/inventory/gift", { recipient, item_id: item.id, quantity });
      window.closeModal();
      _updateSections(["inventory", "balance", "character"]);
      window.kov.toast(`🎁 Подарено: «${item.name}» ×${quantity}`);
    } catch (err) {
      button.disabled = false;
      button.textContent = "Подарить";
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
    <label class="field-label">Цена за весь лот (K)</label>
    <input class="input" id="p" type="number" min="1" value="100" />
    <p class="card-sub" style="font-size:12px; margin:8px 0 0">Предмет появится на рынке. Любой игрок сможет купить.</p>
    <button class="btn" id="ok" style="margin-top:14px">Выставить на рынок</button>
  `);

  modal.querySelector("#ok").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const quantity = Number(modal.querySelector("#q").value);
    const price = Number(modal.querySelector("#p").value);
    if (!quantity || !price) return window.kov.toast("Заполни поля");
    button.disabled = true;
    button.textContent = "Выставляем…";
    try {
      await post("/api/market/list", { item_id: item.id, quantity, price });
      window.closeModal();
      _updateSections(["inventory", "balance", "character"]);
      window.kov.toast(`🏷️ Выставлено: «${item.name}» ×${quantity} за ${price} K`);
    } catch (err) {
      button.disabled = false;
      button.textContent = "Выставить на рынок";
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
    <div class="task-card-reward">Награда: ${taskRewardsHtml(ut.task)}</div>
    <button class="btn btn-secondary" style="margin-top:8px" onclick="closeModal()">Закрыть</button>
    <button class="btn btn-danger" id="cancel-ut" style="margin-top:8px">Прервать задание</button>
  `);

  modal.querySelector("#cancel-ut").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Прерываем…";
    try {
      await post(`/api/tasks/${ut.id}/cancel`);
      window.closeModal();
      _updateSections(["tasks"]);
      window.kov.toast("Задание прервано");
    } catch (e) {
      button.disabled = false;
      button.textContent = "Прервать задание";
      window.kov.toast(e.message);
    }
  });
}

function resumePendingLootboxReveal() {
  if (document.querySelector(".lootbox-chest-overlay")) return;
  try {
    const raw = sessionStorage.getItem("kovcheg.pendingLootboxReveal");
    if (raw) showLootboxExperience(JSON.parse(raw));
  } catch (_) {
    try { sessionStorage.removeItem("kovcheg.pendingLootboxReveal"); } catch (_) {}
  }
}

function showLootboxExperience(result) {
  if (result?.opening_mode === "choice_v2" && !result.finalized) showMegaLootboxChoices(result);
  else showLootboxChest(result);
}

function showMegaLootboxChoices(result) {
  if (!Array.isArray(result?.choice_groups) || !result.choice_groups.length) {
    window.kov.toast("В мегаковбоксе не настроены варианты наград");
    return;
  }
  document.querySelector(".lootbox-chest-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "lootbox-chest-overlay lootbox-theme-mega mega-choice-overlay";
  overlay.innerHTML = `
    <div class="lootbox-chest-rays" aria-hidden="true"></div>
    <header class="lootbox-chest-head mega-choice-head">
      <div class="lootbox-chest-kicker">Открытие</div>
      <h2>${escapeHtml(result.pool?.name || "Мегаковбокс")}</h2>
      <div class="lootbox-remaining" id="mega-choice-progress"><span>${result.choice_groups.length}</span></div>
    </header>
    <div class="lootbox-collected" aria-hidden="true"></div>
    <div class="lootbox-reward-stage mega-choice-stage" id="mega-choice-stage"></div>
    <div class="lootbox-chest-floor">
      <button class="lootbox-chest-button" id="mega-chest-button" type="button" aria-label="Открыть мегаковбокс">
        <img src="${escapeHtml(result.pool?.image_url || "/static/img/ui/box.svg")}" alt="" id="mega-chest-image"/>
      </button>
      <div class="lootbox-chest-hint" id="mega-choice-hint">Нажмите на ковбокс</div>
      <button class="btn lootbox-chest-done" id="mega-choice-done" type="button" hidden>Забрать</button>
    </div>`;
  document.body.appendChild(overlay);
  const stage = overlay.querySelector("#mega-choice-stage");
  const progress = overlay.querySelector("#mega-choice-progress");
  const progressValue = progress.querySelector("span");
  const chestButton = overlay.querySelector("#mega-chest-button");
  const chestImage = overlay.querySelector("#mega-chest-image");
  const hint = overlay.querySelector("#mega-choice-hint");
  const done = overlay.querySelector("#mega-choice-done");
  const openSound = new Audio("/static/audio/lootbox/open.mp3?v=264");
  const bonusSounds = [1, 2, 3].map((number) => new Audio(`/static/audio/lootbox/bonus_${number}.ogg?v=264`));
  const allSounds = [openSound, ...bonusSounds];
  allSounds.forEach((audio) => {
    audio.preload = "auto";
    try { audio.load(); } catch (_) {}
  });
  const choices = [];
  let index = 0;
  let locked = false;
  let opened = false;

  async function playAudio(audio) {
    try {
      const settings = getSettings();
      if (!settings.uiSounds) return false;
      allSounds.forEach((sound) => { if (sound !== audio) { sound.pause(); sound.currentTime = 0; } });
      return await playManagedMedia(audio, settings.uiSoundsVolume);
    } catch (_) {
      return false;
    }
  }

  function rewardCard(reward) {
    const card = document.createElement("article");
    card.className = `lootbox-reward-card reward-${reward.presentation_kind || "item"} is-summary-visible`;
    card.innerHTML = `<img src="${escapeHtml(reward.icon || "/static/img/ui/box.svg")}" alt=""/><strong>${escapeHtml(reward.label || "Награда")}</strong><span>${escapeHtml(reward.rarity || "Награда")}</span>`;
    return card;
  }

  function finish(finalized) {
    progress.hidden = true;
    chestButton.hidden = true;
    stage.className = "lootbox-reward-stage lootbox-reward-summary";
    if (finalized.rewards.length === 1) stage.classList.add("is-one");
    else if (finalized.rewards.length === 3) stage.classList.add("is-three");
    stage.replaceChildren(...finalized.rewards.map(rewardCard));
    hint.textContent = "Все награды выбраны";
    done.hidden = false;
    try { sessionStorage.removeItem("kovcheg.pendingLootboxReveal"); } catch (_) {}
    _updateSections(["inventory", "balance"]);
    playUISound("win");
  }

  const renderGroup = () => {
    const group = result.choice_groups[index];
    progressValue.textContent = String(result.choice_groups.length - index);
    hint.textContent = "Выберите одну из двух наград";
    stage.innerHTML = group.options.map((option, optionIndex) => `
      <button class="mega-choice-card" type="button" data-choice="${optionIndex}">
        <img src="${escapeHtml(option.icon || "/static/img/ui/box.svg")}" alt=""/>
        <strong>${escapeHtml(option.label || "Награда")}</strong>
        <span>${escapeHtml(option.rarity || "Обычный")}</span>
      </button>`).join("");
    stage.querySelectorAll(".mega-choice-card").forEach((card) => {
      card.addEventListener("click", async () => {
        if (locked) return;
        locked = true;
        const choice = Number(card.dataset.choice);
        choices.push(choice);
        card.classList.add("is-selected");
        playAudio(bonusSounds[Math.min(index, bonusSounds.length - 1)]);
        await new Promise((resolve) => setTimeout(resolve, 360));
        index += 1;
        if (index < result.choice_groups.length) {
          locked = false;
          renderGroup();
          return;
        }
        try {
          const finalized = await post("/api/profile/inventory/choose-lootbox", {
            opening_id: result.opening_id,
            request_id: result.request_id,
            choices,
          });
          finish(finalized);
        } catch (error) {
          locked = false;
          // Stock may have changed while the player was choosing. Restart the
          // sequence so any earlier unavailable option can be replaced too.
          index = 0;
          choices.length = 0;
          renderGroup();
          window.kov.toast(error.message);
        }
      });
    });
  };
  chestButton.addEventListener("click", async () => {
    if (locked || opened) return;
    opened = true;
    locked = true;
    await playAudio(openSound);
    chestButton.classList.add("is-bumping");
    setTimeout(() => {
      chestImage.src = result.pool?.open_image_url || result.pool?.image_url || "/static/img/ui/box.svg";
    }, 220);
    const startChoices = () => {
      if (!locked) return;
      openSound.pause();
      locked = false;
      renderGroup();
    };
    setTimeout(startChoices, 2000);
  });
  done.addEventListener("click", () => {
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), 180);
  });
  requestAnimationFrame(() => chestButton.click());
}

function showLootboxChestLegacy(result) {
  if (!result?.pool || !Array.isArray(result.rewards) || !result.rewards.length) {
    window.kov.toast("Ковбокс открыт, но список наград не удалось показать");
    return;
  }
  document.querySelector(".lootbox-chest-overlay")?.remove();
  const themes = new Set(["common", "rare", "epic", "seasonal"]);
  const theme = themes.has(result.pool.code) ? result.pool.code : "common";
  const rewards = [...result.rewards].sort((a, b) => (a.reveal_order || 0) - (b.reveal_order || 0));
  const closedImage = versionedAssetUrl(result.pool.image_url || "/static/img/ui/box.svg");
  const openImage = versionedAssetUrl(result.pool.open_image_url || closedImage);
  [closedImage, openImage, ...rewards.map((reward) => reward.icon)].forEach((src) => {
    if (!src) return;
    const preload = new Image();
    preload.src = src;
  });

  const overlay = document.createElement("div");
  overlay.className = `lootbox-chest-overlay lootbox-theme-${theme}`;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Открытие: ${result.pool.name}`);
  overlay.innerHTML = `
    <div class="lootbox-chest-rays" aria-hidden="true"></div>
    <header class="lootbox-chest-head">
      <div class="lootbox-chest-kicker">Открытие</div>
      <h2>${escapeHtml(result.pool.name || "Ковбокс")}</h2>
      <div class="lootbox-remaining" id="lootbox-remaining"><span id="lootbox-remaining-value">${rewards.length}</span></div>
    </header>
    <div class="lootbox-collected" id="lootbox-collected" aria-label="Полученные награды" hidden></div>
    <div class="lootbox-reward-stage" id="lootbox-reward-stage" aria-live="polite"></div>
    <div class="lootbox-chest-floor">
      <button class="lootbox-chest-button" id="lootbox-chest-button" type="button" aria-label="Открыть следующую награду">
        <img src="${escapeHtml(closedImage)}" alt="${escapeHtml(result.pool.name || "Ковбокс")}" id="lootbox-chest-image" draggable="false"/>
      </button>
      <div class="lootbox-chest-hint" id="lootbox-chest-hint">Нажмите на ковбокс</div>
      <button class="btn lootbox-chest-done" id="lootbox-chest-done" type="button" hidden>Забрать</button>
    </div>`;
  document.body.appendChild(overlay);

  const chestButton = overlay.querySelector("#lootbox-chest-button");
  const chestImage = overlay.querySelector("#lootbox-chest-image");
  const stage = overlay.querySelector("#lootbox-reward-stage");
  const collected = overlay.querySelector("#lootbox-collected");
  const counter = overlay.querySelector("#lootbox-remaining");
  const counterValue = overlay.querySelector("#lootbox-remaining-value");
  const hint = overlay.querySelector("#lootbox-chest-hint");
  const done = overlay.querySelector("#lootbox-chest-done");
  let index = 0;
  let locked = false;
  let previousReward = null;
  let finished = false;
  const openSound = new Audio("/static/audio/lootbox/open.mp3?v=264");
  const specialSound = new Audio("/static/audio/lootbox/special.mp3?v=264");
  const bonusSounds = [1, 2, 3].map((number) => new Audio(`/static/audio/lootbox/bonus_${number}.ogg?v=264`));
  const allSounds = [openSound, specialSound, ...bonusSounds];
  allSounds.forEach((audio) => {
    audio.preload = "auto";
    try { audio.load(); } catch (_) {}
  });
  async function playAudio(audio) {
    try {
      const settings = getSettings();
      if (!settings.uiSounds) return false;
      allSounds.forEach((sound) => { if (sound !== audio) { sound.pause(); sound.currentTime = 0; } });
      return await playManagedMedia(audio, settings.uiSoundsVolume);
    } catch (_) {
      return false;
    }
  }
  function playAudioAndWait(audio, maxWait = 2200) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      audio.addEventListener("ended", finish, { once: true });
      playAudio(audio);
      setTimeout(finish, maxWait);
    });
  }

  function updateCounter() {
    const remaining = rewards.length - index;
    counterValue.textContent = String(remaining);
    const next = rewards[index];
    counter.classList.toggle("is-rainbow", remaining === 1 && next?.presentation_kind === "item");
  }

  function addCollected(reward) {
    // The counter already shows how many rewards remain. Previous rewards are
    // intentionally kept out of this area and appear together only at the end.
    return reward;
  }

  function rewardCard(reward) {
    const card = document.createElement("article");
    card.className = `lootbox-reward-card reward-${reward.presentation_kind || "item"}`;
    const tier = reward.item?.lootbox_reward_tier;
    if (tier === "special" || tier === "super_special") card.classList.add(`reward-tier-${tier}`);
    const image = document.createElement("img");
    image.src = reward.icon || "/static/img/ui/box.svg";
    image.alt = "";
    const title = document.createElement("strong");
    title.textContent = reward.label;
    const type = document.createElement("span");
    type.textContent = reward.presentation_kind === "item" ? (reward.rarity || "Предмет") : "Награда";
    card.append(image, title, type);
    return card;
  }

  function startSpecialSpin(card) {
    card.classList.add("is-special-spinning");
    void card.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.classList.add("is-visible");
        if (typeof card.animate !== "function") {
          card.classList.add("is-special-css-spin");
          return;
        }
        try {
          card._lootboxSpecialAnimation = card.animate([
            { opacity:1, transform:"perspective(760px) translate3d(0,16px,0) rotate3d(.14,1,0,0deg) scale(.82)" },
            { opacity:1, transform:"perspective(760px) translate3d(0,-5px,0) rotate3d(.14,1,0,360deg) scale(.94)", offset:.25 },
            { opacity:1, transform:"perspective(760px) translate3d(0,2px,0) rotate3d(.14,1,0,720deg) scale(1.02)", offset:.5 },
            { opacity:1, transform:"perspective(760px) translate3d(0,-2px,0) rotate3d(.14,1,0,1080deg) scale(1.05)", offset:.75 },
            { opacity:1, transform:"perspective(760px) translate3d(0,0,0) rotate3d(.14,1,0,1440deg) scale(1)" },
          ], {
            duration:4000,
            easing:"linear",
            fill:"forwards",
          });
        } catch (_) {
          card.classList.add("is-special-css-spin");
        }
      });
    });
  }

  function finishReveal() {
    if (finished) return;
    finished = true;
    addCollected(previousReward);
    previousReward = null;
    collected.hidden = true;
    counter.hidden = true;
    chestButton.hidden = true;
    stage.classList.add("lootbox-reward-summary");
    if (rewards.length === 1) stage.classList.add("is-one");
    else if (rewards.length === 3) stage.classList.add("is-three");
    stage.replaceChildren(...rewards.map((reward) => {
      const card = rewardCard(reward);
      card.classList.add("is-summary-visible");
      return card;
    }));
    hint.textContent = "Все награды собраны";
    done.hidden = false;
    playUISound("win");
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
  }

  async function revealNext() {
    if (locked || finished) return;
    if (index >= rewards.length) {
      finishReveal();
      return;
    }
    locked = true;
    chestButton.disabled = true;
    addCollected(previousReward);
    const reward = rewards[index];
    if (index === 0) {
      await playAudio(openSound);
      chestButton.classList.remove("is-bumping");
      void chestButton.offsetWidth;
      chestButton.classList.add("is-bumping");
      setTimeout(() => { chestImage.src = openImage; }, 160);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const card = rewardCard(reward);
    stage.replaceChildren(card);
    const specialFinal = index === rewards.length - 1 && reward.presentation_kind === "item";
    if (specialFinal) {
      playAudio(specialSound);
      startSpecialSpin(card);
    } else {
      playAudio(bonusSounds[Math.min(index, bonusSounds.length - 1)]);
      requestAnimationFrame(() => card.classList.add("is-visible"));
    }
    previousReward = reward;
    index += 1;
    updateCounter();
    hint.textContent = index < rewards.length ? "Нажмите ещё раз" : "Нажмите ещё раз, чтобы собрать";
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(reward.presentation_kind === "item" ? "heavy" : "medium"); } catch (_) {}
    setTimeout(() => {
      if (specialFinal) card.classList.add("is-special-revealed");
      locked = false;
      chestButton.disabled = false;
    }, specialFinal ? 4200 : (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 520));
  }

  function closeReveal() {
    try { sessionStorage.removeItem("kovcheg.pendingLootboxReveal"); } catch (_) {}
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), 180);
  }

  chestButton.addEventListener("click", revealNext);
  done.addEventListener("click", closeReveal);
  updateCounter();
  hint.textContent = "Открываем…";
  requestAnimationFrame(() => revealNext());
}

function showLootboxChest(result) {
  if (!result?.pool || !Array.isArray(result.rewards) || result.rewards.length !== 1) {
    window.kov.toast("Ковбокс должен содержать ровно одну награду");
    return;
  }
  document.querySelector(".lootbox-chest-overlay")?.remove();
  const themes = new Set(["common", "rare", "epic", "legendary", "seasonal", "mega", "consolation"]);
  const theme = themes.has(result.pool.code) ? result.pool.code : "common";
  const reward = result.rewards[0];
  const closedImage = versionedAssetUrl(result.pool.image_url || "/static/img/ui/box.svg");
  const sequence = Array.isArray(result.star_sequence) && result.star_sequence.length
    ? result.star_sequence.slice(0, 3)
    : [result.starting_stars || 1, result.starting_stars || 1, result.starting_stars || 1];
  let stars = Math.max(1, Math.min(4, Number(result.starting_stars) || 1));
  let tapIndex = 0;
  let locked = false;
  let finished = false;

  [closedImage, reward.icon].forEach((src) => {
    if (!src) return;
    const preload = new Image();
    preload.src = src;
  });

  const overlay = document.createElement("div");
  overlay.className = `lootbox-chest-overlay lootbox-theme-${theme} lootbox-star-opening`;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="lootbox-chest-rays" aria-hidden="true"></div>
    <header class="lootbox-chest-head">
      <div class="lootbox-chest-kicker">Открытие</div>
      <h2>${escapeHtml(result.pool.name || "Ковбокс")}</h2>
      <div class="lootbox-stars" id="lootbox-stars" aria-label="${stars} из 4 звёзд"></div>
    </header>
    <div class="lootbox-reward-stage" id="lootbox-reward-stage" aria-live="polite"></div>
    <div class="lootbox-chest-floor">
      <button class="lootbox-chest-button" id="lootbox-chest-button" type="button" aria-label="Улучшить ковбокс">
        <img src="${escapeHtml(closedImage)}" alt="${escapeHtml(result.pool.name || "Ковбокс")}" id="lootbox-chest-image" draggable="false"/>
      </button>
      <div class="lootbox-chest-hint" id="lootbox-chest-hint">Нажмите на ковбокс · 1 из 3</div>
      <button class="btn lootbox-chest-done" id="lootbox-chest-done" type="button" hidden>Забрать</button>
    </div>`;
  document.body.appendChild(overlay);

  const starsEl = overlay.querySelector("#lootbox-stars");
  const stage = overlay.querySelector("#lootbox-reward-stage");
  const chestButton = overlay.querySelector("#lootbox-chest-button");
  const hint = overlay.querySelector("#lootbox-chest-hint");
  const done = overlay.querySelector("#lootbox-chest-done");
  const specialSound = new Audio("/static/audio/lootbox/special.mp3?v=283");
  const bonusSounds = [1, 2, 3].map((number) => new Audio(`/static/audio/lootbox/bonus_${number}.ogg?v=283`));
  const allSounds = [specialSound, ...bonusSounds];
  allSounds.forEach((audio) => {
    audio.preload = "auto";
    try { audio.load(); } catch (_) {}
  });

  async function playAudio(audio) {
    const settings = getSettings();
    if (!settings.uiSounds) return false;
    try {
      return await playManagedMedia(audio, settings.uiSoundsVolume);
    } catch (_) {
      return false;
    }
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function renderStars(animateFrom = stars) {
    starsEl.innerHTML = Array.from({ length:4 }, (_, index) => {
      const active = index < stars;
      const fresh = active && index >= animateFrom;
      return `<span class="lootbox-star${active ? " is-active" : ""}${fresh ? " is-new" : ""}" aria-hidden="true">★</span>`;
    }).join("");
    starsEl.setAttribute("aria-label", `${stars} из 4 звёзд`);
  }

  function makeRewardCard(suspense = false) {
    const tier = reward.item?.lootbox_reward_tier || "normal";
    const card = document.createElement("article");
    card.className = `lootbox-reward-card reward-${reward.presentation_kind || "item"} is-visible reward-tier-${tier}${suspense ? " is-special-pending" : ""}`;
    if (suspense) card.setAttribute("aria-label", "Особая награда открывается");
    card.innerHTML = `
      <img src="${escapeHtml(reward.icon || "/static/img/ui/box.svg")}" alt=""/>
      <strong>${escapeHtml(reward.label || "Награда")}</strong>
      <span>${escapeHtml(reward.rarity || "Награда")}</span>`;
    return card;
  }

  function completeReward() {
    hint.textContent = "Награда получена";
    done.hidden = false;
    finished = true;
    _updateSections(["inventory", "balance"]);
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
  }

  async function revealReward() {
    chestButton.classList.remove("is-star-tap");
    void chestButton.offsetWidth;
    chestButton.classList.add("is-opening");
    hint.textContent = "Награда открывается…";
    await wait(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 280);
    if (!document.body.contains(overlay)) return;
    chestButton.hidden = true;
    overlay.classList.add("is-reward-revealed");
    const tier = reward.item?.lootbox_reward_tier || "normal";
    const suspense = tier === "special" || tier === "super_special";
    const card = makeRewardCard(suspense);
    stage.replaceChildren(card);
    if (!suspense) {
      completeReward();
      return;
    }

    hint.textContent = "Особая награда…";
    await playAudio(specialSound);
    // The reveal is synchronized to the beginning of the special-reward
    // sound, not its end: the white suspense card always lasts three seconds.
    await wait(3000);
    if (!document.body.contains(overlay)) return;
    card.classList.remove("is-special-pending");
    void card.offsetWidth;
    card.classList.add("is-special-disclosed");
    card.removeAttribute("aria-label");
    completeReward();
  }

  chestButton.addEventListener("click", async () => {
    if (locked || finished || tapIndex >= sequence.length) return;
    locked = true;
    chestButton.disabled = true;
    const previousStars = stars;
    stars = Math.max(stars, Math.min(4, Number(sequence[tapIndex]) || stars));
    chestButton.classList.remove("is-star-tap");
    void chestButton.offsetWidth;
    chestButton.classList.add("is-star-tap");
    void playAudio(bonusSounds[Math.min(tapIndex, 2)]);
    tapIndex += 1;
    await wait(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 40 : 120);
    if (!document.body.contains(overlay)) return;
    renderStars(previousStars);
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(stars > previousStars ? "heavy" : "medium"); } catch (_) {}
    if (tapIndex >= sequence.length) {
      await revealReward();
      return;
    }
    hint.textContent = `Нажмите на ковбокс · ${tapIndex + 1} из ${sequence.length}`;
    await wait(40);
    locked = false;
    chestButton.disabled = false;
  });

  done.addEventListener("click", () => {
    try { sessionStorage.removeItem("kovcheg.pendingLootboxReveal"); } catch (_) {}
    allSounds.forEach((audio) => { audio.pause(); audio.currentTime = 0; });
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), 180);
  });
  renderStars();
}
