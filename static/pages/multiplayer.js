// Сетевой мультиплеер: глобальный поллер приглашений/сессий + игры в модалке.
// Запускается у обоих игроков без перезагрузки страницы. Поддержка:
// крестики-нолики, шашки, пинг-понг.
import { get, post } from "/static/api.js?v=210";

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let _pollTimer = null;
let _activeSession = null;     // id сессии, открытой сейчас
let _dismissed = new Set();    // сессии, которые игрок закрыл (не переоткрывать)
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
    const inv = (st.incoming_invites || [])[0];
    if (inv) { showInvite(inv); return; }
    const sess = (st.sessions || []).find((s) => s.id !== _activeSession && !_dismissed.has(s.id));
    if (sess) launchGame(sess.id, sess.game);
  } catch (e) { /* транзиентная ошибка поллинга */ }
}

function showInvite(inv) {
  const modal = window.kov.showModal(`
    <div class="mp-modal">
      <button class="close" id="mp-x">×</button>
      <h2 style="margin-top:0">⚔️ Вызов на бой</h2>
      <p class="card-sub"><b>${esc(inv.from_user_name)}</b> приглашает в «${esc(inv.game_name)}»</p>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" id="mp-accept" style="flex:1">Принять</button>
        <button class="btn btn-outline" id="mp-decline" style="flex:1">Отклонить</button>
      </div>
    </div>`);
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
    <button class="btn" id="mp-finish">Закрыть</button></div>`;
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
    const fin = root.querySelector("#mp-finish");
    if (fin) fin.addEventListener("click", () => { leaveSession(sessionId); closeModal(); });
  };
  pollSession(root, sessionId, 1200, draw);
}

// ============ Шашки ============
function renderCheckers(root, sessionId) {
  const me = window.kov.me?.id;
  let sel = null, busy = false, last = null;
  const idx = (r, c) => r * 8 + c;
  const draw = (s) => {
    last = s;
    const flip = s.my_symbol === "O"; // O видит себя снизу
    const myTurn = s.status === "playing" && s.current_turn === s.my_symbol;
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
        const isSel = sel === i;
        const pieceCol = (p === "x" || p === "X") ? "#f5f5f5" : "#3a2a1a";
        const pieceBorder = (p === "x" || p === "X") ? "#bbb" : "#000";
        const king = p === "X" || p === "O";
        const piece = p !== "_"
          ? `<div style="width:74%;height:74%;border-radius:50%;background:${pieceCol};border:2px solid ${pieceBorder};display:flex;align-items:center;justify-content:center;font-size:12px;color:#d4a017">${king ? "♛" : ""}</div>`
          : "";
        const bg = isSel ? "#6cb6fb" : dark ? "#7a8a5a" : "#e8e4cf";
        html += `<div data-i="${i}" data-mine="${mine}" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:${bg};cursor:${myTurn ? "pointer" : "default"}">${piece}</div>`;
      }
    }
    html += `</div>` + endBar(root, sessionId, s, me);
    root.innerHTML = html;
    if (myTurn) root.querySelectorAll("[data-i]").forEach((cell) => {
      cell.addEventListener("click", () => onCell(+cell.dataset.i, cell.dataset.mine === "true"));
    });
    const fin = root.querySelector("#mp-finish");
    if (fin) fin.addEventListener("click", () => { leaveSession(sessionId); closeModal(); });
  };
  async function onCell(i, mine) {
    if (busy || !last || last.current_turn !== last.my_symbol) return;
    if (mine) { sel = (sel === i ? null : i); draw(last); return; }
    if (sel == null) return;
    busy = true;
    const from = sel;
    try {
      const r = await post("/api/game/session/" + sessionId + "/checkers-move", { from, to: i });
      sel = r.more ? i : null; // продолжаем бой той же шашкой
    } catch (e) { window.kov.toast(e.message); } finally { busy = false; }
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

  function render() {
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // моя ракетка снизу, соперник сверху; мяч переворачиваем для гостя
    const myX = host ? px : po;
    const oppX = host ? po : px;
    const by = host ? ball.y : (1 - ball.y);
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(myPaddle * W - 32, H - 16, 64, 9);
    ctx.fillStyle = "#e91e63";
    ctx.fillRect(oppX * W - 32, 8, 64, 9);
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(ball.x * W, by * H, 7, 0, 7);
    ctx.fill();
    root.querySelector("#pong-score").textContent = (host ? sx : so) + " : " + (host ? so : sx);
  }

  function hostStep() {
    // px — это моя (хоста) ракетка снизу; po — ракетка гостя сверху
    px = myPaddle;
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x < 0.02 || ball.x > 0.98) ball.vx *= -1;
    // верх (соперник, po)
    if (ball.y < 0.05) {
      if (Math.abs(ball.x - po) < 0.16) { ball.vy = Math.abs(ball.vy); ball.vx += (ball.x - po) * 0.02; }
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

  function loop() {
    if (!document.body.contains(root)) { stop(); leaveSession(sessionId); return; }
    if (!finished) {
      if (host) hostStep(); else po = myPaddle;
      render();
    }
    raf = requestAnimationFrame(loop);
  }

  async function syncTick() {
    if (finished) return;
    try {
      const payload = host
        ? { ball, px, sx, so }
        : { po: myPaddle };
      const s = await post("/api/game/session/" + sessionId + "/pong", payload);
      applyRemote(s);
    } catch (e) {}
  }
  function applyRemote(s) {
    if (!s || !s.state) { maybeFinish(s); return; }
    const st = s.state;
    if (host) { po = st.po ?? po; }
    else { ball = st.ball || ball; px = st.px ?? px; sx = st.sx ?? sx; so = st.so ?? so; }
    maybeFinish(s);
  }
  function maybeFinish(s) {
    if (s && s.status && s.status !== "playing" && !finished) {
      finished = true;
      const txt = resultText(s, me) || s.status;
      const end = root.querySelector("#pong-end");
      if (end) end.innerHTML = `<div style="margin-top:12px;font-weight:800;font-size:18px">${esc(txt)}</div><button class="btn" id="pong-finish" style="margin-top:10px">Закрыть</button>`;
      const fb = root.querySelector("#pong-finish");
      if (fb) fb.addEventListener("click", () => { leaveSession(sessionId); closeModal(); });
    }
  }

  function stop() { if (raf) cancelAnimationFrame(raf); if (sendTimer) clearInterval(sendTimer); }
  _cleanup = stop;

  // Инициализация: узнаём, кто хост
  get("/api/game/session/" + sessionId).then((s) => {
    s0 = s; host = s.my_symbol === "X";
    if (s.state) { ball = s.state.ball || ball; px = s.state.px ?? 0.5; po = s.state.po ?? 0.5; sx = s.state.sx || 0; so = s.state.so || 0; }
    sendTimer = setInterval(syncTick, 110);
    loop();
  }).catch(() => {});
}
