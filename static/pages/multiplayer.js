// Сетевой мультиплеер: глобальный поллер приглашений/сессий + игры в модалке.
// Запускается у обоих игроков без перезагрузки страницы. Поддержка:
// крестики-нолики, шашки, пинг-понг.
import { get, post } from "/static/api.js?v=218";
import { playUISound } from "/static/pages/settings.js?v=218";

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let _pollTimer = null;
let _activeSession = null;     // id сессии, открытой сейчас
let _dismissed = new Set();    // сессии, которые игрок закрыл (не переоткрывать)
let _knownSessions = null;     // сессии, существовавшие при открытии (их НЕ автозапускаем)
let _cleanup = null;           // остановка циклов текущей игры

export function initMultiplayer() {
  if (_pollTimer) return;
  _pollTimer = setInterval(pollState, 2000);
  pollState();
}

async function pollState() {
  if (document.querySelector(".mp-modal")) return; // уже открыта модалка игры/приглашения
  try {
    const st = await get("/api/game/state");
    // Первый опрос при открытии: запоминаем уже существующие сессии и НЕ запускаем их —
    // иначе старая незавершённая партия (напр. пинг-понг) стартует сама при каждом входе.
    if (_knownSessions === null) {
      _knownSessions = new Set((st.sessions || []).map((s) => s.id));
    }
    const inv = (st.incoming_invites || [])[0];
    if (inv) { showInvite(inv); return; }
    // Автозапуск только для НОВОЙ сессии (появилась после открытия — соперник принял вызов).
    const sess = (st.sessions || []).find(
      (s) => !_knownSessions.has(s.id) && s.id !== _activeSession && !_dismissed.has(s.id)
    );
    if (sess) launchGame(sess.id, sess.game);
  } catch (e) { /* транзиентная ошибка поллинга */ }
}

// Один раз вставляем keyframes для анимации появления приглашения.
function ensureInviteAnim() {
  if (document.getElementById("mp-invite-anim")) return;
  const st = document.createElement("style");
  st.id = "mp-invite-anim";
  st.textContent = `@keyframes mpInvitePop {
    0% { transform: scale(0.8); opacity: 0; }
    60% { transform: scale(1.04); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  .mp-invite-pop { animation: mpInvitePop .32s cubic-bezier(.2,.9,.3,1.2) both; }`;
  document.head.appendChild(st);
}

function showInvite(inv) {
  ensureInviteAnim();
  const modal = window.kov.showModal(`
    <div class="mp-modal mp-invite-pop">
      <button class="close" id="mp-x">×</button>
      <h2 style="margin-top:0">⚔️ Вызов на бой</h2>
      <p class="card-sub"><b>${esc(inv.from_user_name)}</b> приглашает в «${esc(inv.game_name)}»</p>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" id="mp-accept" style="flex:1">Принять</button>
        <button class="btn btn-outline" id="mp-decline" style="flex:1">Отклонить</button>
      </div>
    </div>`);
  try { playUISound("win"); } catch (e) {}
  const decline = async () => {
    _dismissed.add(inv.id);
    try { await post("/api/game/decline", { invite_id: inv.id }); } catch (e) {}
    closeModal();
  };
  modal.querySelector("#mp-accept").addEventListener("click", async () => {
    try {
      const r = await post("/api/game/accept", { invite_id: inv.id });
      closeModal();
      launchGame(r.session_id, r.game);
    } catch (e) { window.kov.toast(e.message || "Ошибка"); }
  });
  modal.querySelector("#mp-decline").addEventListener("click", decline);
  modal.querySelector("#mp-x").addEventListener("click", decline);
}

function leaveSession(sessionId) {
  if (sessionId != null) _dismissed.add(sessionId);
  if (_activeSession === sessionId) _activeSession = null;
  if (_cleanup) { try { _cleanup(); } catch (e) {} _cleanup = null; }
}

function launchGame(sessionId, game) {
  if (_activeSession === sessionId) return;
  _activeSession = sessionId;
  const modal = window.kov.showModal(`
    <div class="mp-modal mp-game">
      <button class="close" id="mp-x">×</button>
      <div id="mp-root" style="text-align:center;min-height:120px"><p>Загрузка…</p></div>
    </div>`);
  const root = modal.querySelector("#mp-root");
  modal.querySelector("#mp-x").addEventListener("click", () => { leaveSession(sessionId); closeModal(); });
  if (game === "checkers") renderCheckers(root, sessionId);
  else if (game === "pingpong") renderPong(root, sessionId);
  else renderTicTacToe(root, sessionId);
}

// Общий цикл опроса сессии. cb(session) вызывается при каждом новом состоянии.
// Останавливается, если модалку закрыли (root исчез из DOM).
function pollSession(root, sessionId, intervalMs, cb) {
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped) return;
    if (!document.body.contains(root)) { stop(); leaveSession(sessionId); return; }
    if (inFlight) return;
    inFlight = true;
    try {
      const s = await get("/api/game/session/" + sessionId);
      if (!stopped) cb(s);
    } catch (e) { /* keep last */ } finally { inFlight = false; }
  };
  const timer = setInterval(tick, intervalMs);
  function stop() { stopped = true; clearInterval(timer); }
  _cleanup = stop;
  tick();
  return { stop, isStopped: () => stopped };
}

function resultText(s, me) {
  if (s.status === "draw") return "Ничья!";
  if (s.status === "x_won" || s.status === "o_won") {
    return s.winner_id === me ? "🏆 Ты победил!" : (s.opponent_name + " победил");
  }
  return "";
}

function endBar(root, sessionId, s, me) {
  const txt = resultText(s, me);
  if (!txt) return "";
  return `<div style="margin-top:14px"><div style="font-weight:800;font-size:18px;margin-bottom:10px">${esc(txt)}</div>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="btn" id="mp-finish">Закрыть</button>
      <button class="btn btn-outline" id="mp-rematch">Ещё раз</button>
    </div></div>`;
}

// Навешивает обработчики на кнопки «Закрыть» / «Ещё раз» из endBar.
function wireEndButtons(root, sessionId) {
  const fin = root.querySelector("#mp-finish");
  if (fin) fin.addEventListener("click", () => { leaveSession(sessionId); closeModal(); });
  const rem = root.querySelector("#mp-rematch");
  if (rem) rem.addEventListener("click", () => sendRematch(sessionId, rem));
}

// ============ Крестики-нолики ============
function renderTicTacToe(root, sessionId) {
  const me = window.kov.me?.id;
  let busy = false;
  const draw = (s) => {
    const myTurn = s.status === "playing" && s.current_turn === s.my_symbol;
    const head = s.status === "playing"
      ? (myTurn ? `Твой ход (${s.my_symbol})` : `Ход ${esc(s.opponent_name)} (${s.current_turn})`)
      : (resultText(s, me) || s.status);
    let html = `<div style="font-weight:800;font-size:17px;margin-bottom:2px">Крестики-нолики</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Ты: <b>${s.my_symbol}</b> vs <b>${esc(s.opponent_name)}</b></div>
      <div style="font-weight:700;margin-bottom:10px;color:${myTurn ? "#4caf50" : "var(--text-muted)"}">${esc(head)}</div>
      <div style="display:grid;grid-template-columns:repeat(3,72px);gap:5px;justify-content:center">`;
    for (let i = 0; i < 9; i++) {
      const v = s.board[i];
      const col = v === "X" ? "#4caf50" : v === "O" ? "#e91e63" : "var(--text-muted)";
      const bg = v === "X" ? "rgba(76,175,80,.15)" : v === "O" ? "rgba(233,30,99,.15)" : "var(--surface-2)";
      const can = v === "_" && myTurn;
      html += `<div data-i="${i}" style="width:72px;height:72px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;border-radius:8px;background:${bg};border:2px solid ${col === "var(--text-muted)" ? "var(--border)" : col};color:${col};cursor:${can ? "pointer" : "default"}">${v === "_" ? "" : v}</div>`;
    }
    html += `</div>` + endBar(root, sessionId, s, me);
    root.innerHTML = html;
    if (myTurn) root.querySelectorAll("[data-i]").forEach((c) => {
      if (s.board[+c.dataset.i] !== "_") return;
      c.addEventListener("click", async () => {
        if (busy) return; busy = true;
        try { await post("/api/game/session/" + sessionId + "/move", { position: +c.dataset.i }); }
        catch (e) { window.kov.toast(e.message); } finally { busy = false; }
      });
    });
    wireEndButtons(root, sessionId);
  };
  pollSession(root, sessionId, 1200, draw);
}

// ============ Шашки ============
function renderCheckers(root, sessionId) {
  const me = window.kov.me?.id;
  let sel = null, busy = false, last = null;
  const idx = (r, c) => r * 8 + c;
  // Карта допустимых ходов от сервера: {клетка_фигуры: [конечные клетки]}.
  const legalFor = (s) => (s && s.legal) || {};
  const movesFrom = (s, i) => legalFor(s)[String(i)] || [];
  const draw = (s) => {
    last = s;
    const flip = s.my_symbol === "O"; // O видит себя снизу
    const myTurn = s.status === "playing" && s.current_turn === s.my_symbol;
    // сброс выбора, если шашка больше не может ходить (например, после хода соперника)
    if (sel != null && (!myTurn || movesFrom(s, sel).length === 0)) sel = null;
    const targets = sel != null ? movesFrom(s, sel) : [];
    const head = s.status === "playing"
      ? (myTurn ? "Твой ход" : `Ход ${esc(s.opponent_name)}`)
      : (resultText(s, me) || s.status);
    let html = `<div style="font-weight:800;font-size:17px;margin-bottom:2px">Шашки</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Ты — ${s.my_symbol === "X" ? "светлые" : "тёмные"} vs <b>${esc(s.opponent_name)}</b></div>
      <div style="font-weight:700;margin-bottom:10px;color:${myTurn ? "#4caf50" : "var(--text-muted)"}">${esc(head)}</div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);width:min(92vw,340px);margin:0 auto;border:2px solid var(--border);border-radius:6px;overflow:hidden">`;
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = flip ? 7 - vr : vr, c = flip ? 7 - vc : vc;
        const i = idx(r, c);
        const dark = (r + c) % 2 === 1;
        const p = s.board[i];
        const mine = (s.my_symbol === "X" && (p === "x" || p === "X")) || (s.my_symbol === "O" && (p === "o" || p === "O"));
        const movable = myTurn && mine && movesFrom(s, i).length > 0;
        const isSel = sel === i;
        const isTarget = targets.indexOf(i) !== -1;
        const pieceCol = (p === "x" || p === "X") ? "#f5f5f5" : "#3a2a1a";
        const pieceBorder = (p === "x" || p === "X") ? "#bbb" : "#000";
        const king = p === "X" || p === "O";
        const piece = p !== "_"
          ? `<div style="width:74%;height:74%;border-radius:50%;background:${pieceCol};border:2px solid ${pieceBorder};display:flex;align-items:center;justify-content:center;font-size:12px;color:#d4a017">${king ? "♛" : ""}</div>`
          : "";
        let bg = isSel ? "#6cb6fb" : isTarget ? "#3fb950" : dark ? "#7a8a5a" : "#e8e4cf";
        // заметная подсветка: рамка у клеток-целей и у шашек, которыми можно ходить
        const ring = isTarget ? "box-shadow:inset 0 0 0 3px #1f6f30;" : (movable && !isSel ? "box-shadow:inset 0 0 0 2px #6cb6fb;" : "");
        const clickable = isTarget || (myTurn && mine);
        html += `<div data-i="${i}" data-mine="${mine}" data-target="${isTarget}" data-movable="${movable}" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:${bg};${ring}cursor:${clickable ? "pointer" : "default"}">${piece}</div>`;
      }
    }
    html += `</div>` + endBar(root, sessionId, s, me);
    root.innerHTML = html;
    if (myTurn) root.querySelectorAll("[data-i]").forEach((cell) => {
      cell.addEventListener("click", () => onCell(+cell.dataset.i, cell.dataset.mine === "true"));
    });
    wireEndButtons(root, sessionId);
  };
  async function onCell(i, mine) {
    if (busy || !last || last.current_turn !== last.my_symbol) return;
    // клик по подсвеченной целевой клетке — отправляем ход выбранной шашкой
    if (sel != null && movesFrom(last, sel).indexOf(i) !== -1) {
      busy = true;
      const from = sel;
      try {
        await post("/api/game/session/" + sessionId + "/checkers-move", { from, to: i });
        sel = null; // весь бой за один ход — ход передан сопернику
      } catch (e) { window.kov.toast(e.message); } finally { busy = false; }
      return;
    }
    // клик по своей шашке — выбор/смена выбора (только если у неё есть ходы)
    if (mine) {
      if (movesFrom(last, i).length === 0) return;
      sel = (sel === i ? null : i);
      draw(last);
    }
  }
  pollSession(root, sessionId, 1200, draw);
}

// ============ Пинг-понг ============
function renderPong(root, sessionId) {
  const me = window.kov.me?.id;
  let s0 = null, host = false;
  let px = 0.5, po = 0.5;            // позиции ракеток (0..1 по горизонтали)
  let ball = { x: 0.5, y: 0.5, vx: 0.012, vy: 0.010 };
  let sx = 0, so = 0;
  let myPaddle = 0.5;               // моя ракетка (управляемая)
  let raf = null, sendTimer = null, finished = false;
  let syncing = false;             // один запрос в полёте за раз
  let lastFrame = 0;               // для dt в экстраполяции мяча
  let countdown = 3;               // отсчёт перед стартом: 3,2,1,0(Старт!),-1(идёт игра)
  let countdownStarted = false;

  const SYNC_MS = 80;              // период синка с сервером

  // --- Интерполяция: для значений, приходящих по сети, храним prev/target + время.
  // dispX — то, что реально рисуем; плавно движется к target за ~SYNC_MS.
  // Гость интерполирует мяч (x,y) и ракетку хоста (px). Хост — ракетку гостя (po).
  const interp = {
    px: { prev: 0.5, target: 0.5, disp: 0.5, t0: 0 },
    po: { prev: 0.5, target: 0.5, disp: 0.5, t0: 0 },
    bx: { prev: 0.5, target: 0.5, disp: 0.5, t0: 0 },
    by: { prev: 0.5, target: 0.5, disp: 0.5, t0: 0 },
  };
  function setTarget(key, value) {
    const c = interp[key];
    c.prev = c.disp;          // начинаем со текущей отрисованной точки — без скачка
    c.target = value;
    c.t0 = performance.now();
  }
  function stepInterp(key, now) {
    const c = interp[key];
    const k = c.t0 ? Math.min(1, (now - c.t0) / SYNC_MS) : 1;
    c.disp = c.prev + (c.target - c.prev) * k;
    return c.disp;
  }

  root.innerHTML = `<div style="font-weight:800;font-size:17px;margin-bottom:6px">Пинг-понг</div>
    <div id="pong-score" style="font-weight:700;margin-bottom:8px">0 : 0</div>
    <canvas id="pong-cv" width="300" height="420" style="background:#101418;border-radius:10px;max-width:92vw;touch-action:none"></canvas>
    <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Веди пальцем — двигай ракетку. До ${5} очков.</div>
    <div id="pong-end"></div>`;
  const cv = root.querySelector("#pong-cv");
  const ctx = cv.getContext("2d");

  function setPaddle(clientX) {
    const rect = cv.getBoundingClientRect();
    myPaddle = Math.max(0.08, Math.min(0.92, (clientX - rect.left) / rect.width));
  }
  cv.addEventListener("mousemove", (e) => { if (e.buttons) setPaddle(e.clientX); });
  cv.addEventListener("touchmove", (e) => { e.preventDefault(); if (e.touches[0]) setPaddle(e.touches[0].clientX); }, { passive: false });
  cv.addEventListener("click", (e) => setPaddle(e.clientX));

  function render(now) {
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // Ракетка соперника (вверху) и координаты мяча — интерполированные.
    let oppX, ballX, ballY;
    if (host) {
      oppX = stepInterp("po", now);          // ракетка гостя плавно
      ballX = ball.x; ballY = ball.y;        // хост — авторитет физики
    } else {
      oppX = stepInterp("px", now);          // ракетка хоста плавно
      // Гость экстраполирует мяч локально (dead reckoning) — см. guestStep().
      ballX = ball.x;
      ballY = 1 - ball.y;                     // гость видит поле перевёрнутым
    }
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(myPaddle * W - 32, H - 16, 64, 9);
    ctx.fillStyle = "#e91e63";
    ctx.fillRect(oppX * W - 32, 8, 64, 9);
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(ballX * W, ballY * H, 7, 0, 7);
    ctx.fill();
    root.querySelector("#pong-score").textContent = (host ? sx : so) + " : " + (host ? so : sx);
    // Оверлей отсчёта поверх поля.
    if (countdown >= 0) {
      const label = countdown > 0 ? String(countdown) : "Старт!";
      ctx.save();
      ctx.fillStyle = "rgba(16,20,24,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "800 " + (countdown > 0 ? 96 : 56) + "px system-ui, sans-serif";
      ctx.fillText(label, W / 2, H / 2);
      ctx.restore();
    }
  }

  function hostStep() {
    // px — это моя (хоста) ракетка снизу; po — ракетка гостя сверху (интерполируется в render)
    px = myPaddle;
    if (countdown >= 0) {                   // во время отсчёта мяч стоит в центре
      ball.x = 0.5; ball.y = 0.5;
      return;
    }
    const poX = interp.po.disp;            // используем сглаженную позицию гостя для коллизий
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x < 0.02 || ball.x > 0.98) ball.vx *= -1;
    // верх (соперник, po)
    if (ball.y < 0.05) {
      if (Math.abs(ball.x - poX) < 0.16) { ball.vy = Math.abs(ball.vy); ball.vx += (ball.x - poX) * 0.02; }
      else { sx += 1; resetBall(-1); }
    }
    // низ (хост, px)
    if (ball.y > 0.95) {
      if (Math.abs(ball.x - px) < 0.16) { ball.vy = -Math.abs(ball.vy); ball.vx += (ball.x - px) * 0.02; }
      else { so += 1; resetBall(1); }
    }
    ball.vx = Math.max(-0.03, Math.min(0.03, ball.vx));
  }
  function resetBall(dir) {
    ball = { x: 0.5, y: 0.5, vx: (Math.random() - 0.5) * 0.02, vy: 0.011 * (dir || 1) };
  }

  // Гость экстраполирует мяч локально между апдейтами хоста (dead reckoning).
  // dtFrames нормирует движение к ~60fps (скорости заданы в единицах на кадр).
  function guestStep(dtFrames) {
    if (countdown >= 0) { ball.x = 0.5; ball.y = 0.5; return; }
    ball.x += ball.vx * dtFrames;
    ball.y += ball.vy * dtFrames;
    // Отражения у стенок, чтобы экстраполяция не «уезжала» за поле до синка.
    if (ball.x < 0.02) { ball.x = 0.02; ball.vx = Math.abs(ball.vx); }
    else if (ball.x > 0.98) { ball.x = 0.98; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < 0.02) { ball.y = 0.02; ball.vy = Math.abs(ball.vy); }
    else if (ball.y > 0.98) { ball.y = 0.98; ball.vy = -Math.abs(ball.vy); }
  }

  function loop(now) {
    if (!document.body.contains(root)) { stop(); leaveSession(sessionId); return; }
    now = now || performance.now();
    const dtFrames = lastFrame ? Math.min(4, (now - lastFrame) / 16.6667) : 1;
    lastFrame = now;
    if (!finished) {
      if (host) hostStep();
      else guestStep(dtFrames);
      render(now);
    }
    raf = requestAnimationFrame(loop);
  }

  async function syncTick() {
    if (finished || syncing) return;          // один запрос в полёте за раз
    syncing = true;
    try {
      const payload = host
        ? { ball, px, sx, so }
        : { po: myPaddle };
      const s = await post("/api/game/session/" + sessionId + "/pong", payload);
      applyRemote(s);
    } catch (e) {
    } finally {
      syncing = false;
    }
  }
  function applyRemote(s) {
    if (!s || !s.state) { maybeFinish(s); return; }
    const st = s.state;
    if (host) {
      if (st.po != null) setTarget("po", st.po);  // ракетка гостя — плавно
    } else {
      if (st.px != null) setTarget("px", st.px);  // ракетка хоста — плавно
      if (st.ball) {
        // Берём авторитетную скорость хоста сразу — экстраполяция точная.
        ball.vx = st.ball.vx; ball.vy = st.ball.vy;
        // Позицию подтягиваем мягко (lerp), без телепорта — убирает рывки.
        const k = 0.35;
        ball.x += (st.ball.x - ball.x) * k;
        ball.y += (st.ball.y - ball.y) * k;
      }
      sx = st.sx ?? sx; so = st.so ?? so;          // счёт — мгновенно
    }
    maybeFinish(s);
  }
  function maybeFinish(s) {
    if (s && s.status && s.status !== "playing" && !finished) {
      finished = true;
      const txt = resultText(s, me) || s.status;
      const end = root.querySelector("#pong-end");
      if (end) end.innerHTML = `<div style="margin-top:12px;font-weight:800;font-size:18px">${esc(txt)}</div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:10px">
          <button class="btn" id="pong-finish">Закрыть</button>
          <button class="btn btn-outline" id="pong-rematch">Ещё раз</button>
        </div>`;
      const fb = root.querySelector("#pong-finish");
      if (fb) fb.addEventListener("click", () => { leaveSession(sessionId); closeModal(); });
      const rb = root.querySelector("#pong-rematch");
      if (rb) rb.addEventListener("click", () => sendRematch(sessionId, rb));
    }
  }

  let cdTimer = null;
  function startCountdown() {
    if (countdownStarted) return;
    countdownStarted = true;
    countdown = 3;
    try { playUISound("click"); } catch (e) {}   // тик на «3»
    cdTimer = setInterval(() => {
      countdown -= 1;
      if (countdown > 0) { try { playUISound("click"); } catch (e) {} }       // «2», «1»
      else if (countdown === 0) { try { playUISound("win"); } catch (e) {} }  // «Старт!»
      else {                                                                  // отсчёт окончен
        clearInterval(cdTimer); cdTimer = null;
        lastFrame = 0;                            // сброс dt, чтобы мяч не «прыгнул»
      }
    }, 1000);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    if (sendTimer) clearInterval(sendTimer);
    if (cdTimer) clearInterval(cdTimer);
  }
  _cleanup = stop;

  // Инициализация: узнаём, кто хост
  get("/api/game/session/" + sessionId).then((s) => {
    s0 = s; host = s.my_symbol === "X";
    if (s.state) {
      ball = s.state.ball || ball;
      px = s.state.px ?? 0.5; po = s.state.po ?? 0.5;
      sx = s.state.sx || 0; so = s.state.so || 0;
    }
    // Засеваем интерполяторы текущими значениями (без скачка на первом апдейте).
    interp.px.prev = interp.px.target = interp.px.disp = px;
    interp.po.prev = interp.po.target = interp.po.disp = po;
    interp.bx.prev = interp.bx.target = interp.bx.disp = ball.x;
    interp.by.prev = interp.by.target = interp.by.disp = ball.y;
    sendTimer = setInterval(syncTick, SYNC_MS);
    startCountdown();              // у каждого клиента свой отсчёт 3→2→1→Старт!
    loop();
  }).catch(() => {});
}

// Реванш: создаём новое приглашение тому же сопернику в ту же игру.
async function sendRematch(sessionId, btn) {
  if (btn) { btn.disabled = true; }
  try {
    await post("/api/game/session/" + sessionId + "/rematch", {});
    window.kov.toast("Реванш отправлен");
    leaveSession(sessionId);
    closeModal();
  } catch (e) {
    if (btn) btn.disabled = false;
    window.kov.toast(e.message || "Ошибка");
  }
}
