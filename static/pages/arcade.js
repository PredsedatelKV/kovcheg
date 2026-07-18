import { post, get } from "/static/api.js?v=233";

import { playUISound } from "/static/pages/settings.js?v=233";
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function kovbaksWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "Ковбаксов";
  if (last === 1) return "Ковбакс";
  if (last >= 2 && last <= 4) return "Ковбакса";
  return "Ковбаксов";
}

let balance = 0;

async function fetchBalance() {
  try {
    const me = await get("/api/profile/me");
    balance = me.user.balance;
    return balance;
  } catch (_) {
    return 0;
  }
}

async function syncBalance() {
  try {
    const me = await get("/api/profile/me");
    balance = me.user.balance;
    const profileBalance = document.querySelector(".wallet-balance-value strong");
    if (profileBalance) profileBalance.textContent = balance;
    return balance;
  } catch (_) {
    return 0;
  }
}

function updateBalanceDisplay(id, amount) {
  const el = document.getElementById(id);
  if (el) el.textContent = amount;
}

function animateElement(el, animation, duration) {
  el.style.animation = `${animation} ${duration}ms ease-out forwards`;
}

function getMaxBet() {
  return Math.max(1, Math.floor(balance * 0.2));
}

function betInputHTML(id) {
  const max = getMaxBet();
  return `<div class="game-bet-custom">
    <label>Ставка:</label>
    <input type="number" id="${id}" value="1" min="1" max="${max}" class="input input-sm"/>
    <span class="game-bet-hint"><img src="/static/img/ui/coin.svg" alt="" class="game-icon-sm"/> макс ${max}</span>
  </div>`;
}

function getBetValue(id) {
  const input = document.getElementById(id);
  if (!input) return 0;
  let val = Math.floor(Number(input.value));
  const max = getMaxBet();
  if (val < 1) val = 1;
  if (val > max) val = max;
  return val;
}

// ============ ОБЩАЯ ОЧИСТКА / БЛОКИРОВКА ЗАКРЫТИЯ ============
// Реестр очистки активной игры: при закрытии модалки или потере видимости
// вкладки гарантированно глушим все интервалы / rAF / звуки игры.
let _activeGameCleanup = null;
let _activeGameVisibility = null;
// Флаг "идёт раунд казино" — пока true, модалку нельзя закрывать/сворачивать.
let _casinoRoundLocked = false;
let _modalBeforeCloseUnsubscribe = null;

function ensureArcadeModalLifecycle() {
  if (_modalBeforeCloseUnsubscribe || !window.kov || !window.kov.onModalBeforeClose) return;
  _modalBeforeCloseUnsubscribe = window.kov.onModalBeforeClose(() => {
    if (_casinoRoundLocked) {
      if (window.kov && window.kov.toast) window.kov.toast("Дождитесь завершения раунда");
      return false;
    }
    runGameCleanup();
    return true;
  });
}

function registerGameCleanup(fn, onVisibilityChange = null) {
  ensureArcadeModalLifecycle();
  // Если предыдущая игра не была очищена (закрыли иным путём) — чистим её сейчас.
  if (_activeGameCleanup) {
    try { _activeGameCleanup(); } catch (_) {}
  }
  _activeGameCleanup = fn;
  _activeGameVisibility = onVisibilityChange;
  _casinoRoundLocked = false;
}

function runGameCleanup() {
  if (_activeGameCleanup) {
    const fn = _activeGameCleanup;
    _activeGameCleanup = null;
    _activeGameVisibility = null;
    _casinoRoundLocked = false;
    try { fn(); } catch (_) {}
  }
}

function setCasinoRoundLocked(locked) {
  _casinoRoundLocked = locked;
  // Визуально гасим стандартный крестик во время активного раунда.
  const closeBtn = document.querySelector("#modal-root .modal .close");
  if (closeBtn) {
    closeBtn.style.opacity = locked ? "0.35" : "";
    closeBtn.style.pointerEvents = locked ? "none" : "";
  }
}

// Игры с безопасным pause/resume получают событие видимости; остальные по-
// прежнему полностью очищаются, чтобы не оставлять таймеры в фоне. Модальное
// закрытие обслуживает единый lifecycle shell-а, установленный лениво выше.
if (!window.__arcadeVisibilityLifecycleInstalled) {
  window.__arcadeVisibilityLifecycleInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (_activeGameVisibility) {
      try { _activeGameVisibility(document.hidden); } catch (_) {}
    } else if (document.hidden) {
      runGameCleanup();
    }
  });
}

// ============ МИНИ-ИГРЫ ============

function gameWhereIsMoshonka(container) {
  const isInline = !!container;
  const CUP_STEP = 72;
  // Уровни сложности: число стаканов, длительность одной перестановки, число перестановок.
  const LEVELS = {
    hard:   { label: "Сложный", cups: () => 4 + Math.floor(Math.random() * 2), dur: 200, swaps: 7, pause: 80 },
  };
  let level = LEVELS.hard;       // выбранный объект уровня
  let CUP_COUNT = 3;      // фактическое число стаканов в текущей партии
  let round = 1;
  let score = 0;
  let villagerPhys, canClick, gameEnded;
  let root, result, scoreEl, cupContainer;
  let logicalOrder;
  // Очистка: помечаем игру разрушенной и гасим все таймеры при закрытии модалки.
  let destroyed = false;
  const timers = new Set();
  const trackTimeout = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
    return id;
  };
  if (!isInline) {
    registerGameCleanup(() => {
      destroyed = true;
      timers.forEach(clearTimeout);
      timers.clear();
    });
  }

  function resolveCupCount() {
    const c = level.cups;
    return typeof c === "function" ? c() : c;
  }

  function initRound() {
    CUP_COUNT = resolveCupCount();
    logicalOrder = Array.from({ length: CUP_COUNT }, (_, i) => i);
    villagerPhys = Math.floor(Math.random() * CUP_COUNT);
    canClick = false;
    gameEnded = false;
  }

  function delay(ms) {
    return new Promise(r => trackTimeout(r, ms));
  }

  function animateSwap(i, j) {
    return new Promise(resolve => {
      const cups = cupContainer.querySelectorAll(".game-cup");
      const dx = (j - i) * CUP_STEP;
      const dur = level.dur;
      cups[i].style.transition = `transform ${dur}ms cubic-bezier(0.45,0.05,0.55,0.95)`;
      cups[j].style.transition = `transform ${dur}ms cubic-bezier(0.45,0.05,0.55,0.95)`;
      cups[i].style.transform = `translateX(${dx}px)`;
      cups[j].style.transform = `translateX(${-dx}px)`;
      trackTimeout(() => {
        cups[i].style.transition = "none";
        cups[j].style.transition = "none";
        cups[i].style.transform = "";
        cups[j].style.transform = "";
        [logicalOrder[i], logicalOrder[j]] = [logicalOrder[j], logicalOrder[i]];
        if (villagerPhys === i) villagerPhys = j;
        else if (villagerPhys === j) villagerPhys = i;
        resolve();
      }, dur);
    });
  }

  async function shuffleCups() {
    const numSwaps = level.swaps;
    let last = -1;
    for (let s = 0; s < numSwaps; s++) {
      if (destroyed) return;
      // Перемешиваем соседние стаканы — плавнее и легче следить глазами.
      let a = Math.floor(Math.random() * (CUP_COUNT - 1));
      let b = a + 1;
      if (a === last) { // избегаем точного повтора предыдущей пары подряд
        a = (a + 1) % (CUP_COUNT - 1); b = a + 1;
      }
      last = a;
      await animateSwap(a, b);
      await delay(level.pause);
    }
    if (destroyed) return;
    canClick = true;
    result.innerHTML = `<div class="game-neutral">Где Мошонка?</div>`;
  }

  function revealAll(show) {
    cupContainer.querySelectorAll(".game-cup").forEach((cup, physIdx) => {
      const front = cup.querySelector(".cup-front");
      const back = cup.querySelector(".cup-back");
      const isVillager = physIdx === villagerPhys;
      if (show && isVillager) {
        front.style.display = "none";
        back.style.display = "";
      } else {
        front.style.display = "";
        back.style.display = "none";
      }
    });
  }

  function renderCups() {
    cupContainer.innerHTML = Array(CUP_COUNT).fill("").map(() => `
      <button class="game-cup">
        <div class="cup-front">
          <img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/>
        </div>
        <div class="cup-back" style="display:none">
          <img src="/static/img/ui/villager.svg" alt="" class="game-icon-lg"/>
        </div>
      </button>
    `).join("");
    bindCups();
  }

  function startRound() {
    initRound();
    renderCups();
    cupContainer.querySelectorAll(".game-cup").forEach(c => {
      c.disabled = false;
      c.style.transition = "none";
      c.style.transform = "";
    });
    result.innerHTML = "";
    revealAll(true);
    trackTimeout(() => {
      revealAll(false);
      shuffleCups();
    }, 1000);
  }

  function bindCups() {
    cupContainer.querySelectorAll(".game-cup").forEach((cup, physIdx) => {
      cup.addEventListener("click", () => {
        if (!canClick || gameEnded) return;
        gameEnded = true;
        canClick = false;

        const isWin = physIdx === villagerPhys;

        revealAll(true);

        if (isWin) {
          result.innerHTML = `<div class="game-win">Угадал! +${10 * round}</div>`;
          playUISound("win");
          awardFirstWin("moshonka", { player_score: score + 10 * round, opponent_score: 0 });
          score += 10 * round;
          round++;
          scoreEl.textContent = score;
        } else {
          result.innerHTML = `<div class="game-lose">Мимо</div>`;
          playUISound("lose");
          score = Math.max(0, score - 5);
          scoreEl.textContent = score;
        }

        cupContainer.querySelectorAll(".game-cup").forEach(c => c.disabled = true);
        trackTimeout(startRound, 2500);
      });
    });
  }

  const html = `
    <div id="moshonka-game" style="">
      <div style="text-align:center;margin-bottom:6px">
        <span style="font-size:13px;color:var(--text-soft)">Счёт: <span id="moshonka-score-val">0</span></span>
      </div>
      <div class="game-bushes" id="moshonka-cups"></div>
      <div class="game-result" id="moshonka-result" style="font-size:13px;min-height:24px"></div>
    </div>
  `;

  if (isInline) {
    root = container;
    root.innerHTML = html;
  } else {
    root = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2 style="margin:0 0 4px">Где Мошонка?</h2>
      <p class="card-sub" style="margin:0 0 6px">Угадай, под каким кустом!</p>
      ${html}
    `);
  }

  result = root.querySelector("#moshonka-result");
  cupContainer = root.querySelector("#moshonka-cups");
  scoreEl = root.querySelector("#moshonka-score-val");

  // Сразу запускаем сложный уровень — экран выбора сложности не нужен.
  startRound();
}

function gameTicTacToe(container) {
  const isInline = !!container;
  let board = Array(9).fill(null);
  let gameActive = true;
  let playerTurn = true;
  
  let root;
  if (isInline) {
    root = container;
    root.innerHTML = `
      <h3 style="margin:0 0 6px">Крестики-нолики</h3>
      <p class="card-sub" style="margin:0 0 10px">Играй против Мошонки!</p>
      <div class="game-ttt-board" id="ttt-board">
        ${Array(9).fill("").map((_, i) => `<button class="ttt-cell" data-idx="${i}"></button>`).join("")}
      </div>
      <div class="game-result" id="ttt-result"></div>
      <div class="game-play-again" id="ttt-again" style="display:none">
        <button class="btn" id="play-again-btn">Играть заново</button>
      </div>`;
  } else {
    root = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2>Крестики-нолики</h2>
      <p class="card-sub">Играй против Мошонки!</p>
      <div class="game-ttt-board" id="ttt-board">
        ${Array(9).fill("").map((_, i) => `<button class="ttt-cell" data-idx="${i}"></button>`).join("")}
      </div>
      <div class="game-result" id="ttt-result"></div>
      <div class="game-play-again" id="ttt-again" style="display:none">
        <button class="btn" id="play-again-btn">Играть заново</button>
      </div>
    `);
  }

  const cells = root.querySelectorAll(".ttt-cell");
  const resultEl = root.querySelector("#ttt-result");

  // Очистка: при закрытии модалки прекращаем ход ИИ и звуки.
  let destroyed = false;
  if (!isInline) {
    registerGameCleanup(() => { destroyed = true; gameActive = false; });
  }

  function checkWinner(b) {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a, c, d] of lines) {
      if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
    }
    return b.includes(null) ? null : "draw";
  }

  function moshonkaMove() {
    if (!gameActive) return;
    const empty = board.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
    if (!empty.length) return;
    
    for (const idx of empty) {
      board[idx] = "O";
      if (checkWinner(board) === "O") { board[idx] = null; return idx; }
      board[idx] = null;
    }
    for (const idx of empty) {
      board[idx] = "X";
      if (checkWinner(board) === "X") { board[idx] = null; return idx; }
      board[idx] = null;
    }
    if (board[4] === null) return 4;
    return empty[Math.floor(Math.random() * empty.length)];
  }

  function renderBoard() {
    cells.forEach((cell, i) => {
      if (board[i] === "X") {
        cell.innerHTML = '<img src="/static/img/ui/villager.svg" alt="X" class="ttt-icon"/>';
        cell.classList.add("taken");
      } else if (board[i] === "O") {
        cell.innerHTML = '<img src="/static/img/ui/bush.svg" alt="O" class="ttt-icon"/>';
        cell.classList.add("taken");
      } else {
        cell.innerHTML = "";
        cell.classList.remove("taken");
      }
    });
  }

  function endGame() {
    root.querySelector("#ttt-again").style.display = "block";
  }

  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const idx = Number(cell.dataset.idx);
      if (!gameActive || !playerTurn || board[idx]) return;
      
      board[idx] = "X";
      playerTurn = false;
      playUISound("click");
      renderBoard();
      animateElement(cell, "popIn", 300);
      
      const winner = checkWinner(board);
      if (winner) {
        gameActive = false;
        if (winner === "X") {
          resultEl.innerHTML = `<div class="game-win">Победа!</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
          playUISound("win");
          awardFirstWin("tictactoe", { player_score: 1, opponent_score: 0 });
        } else if (winner === "draw") {
          resultEl.innerHTML = `<div class="game-neutral">Ничья!</div>`;
        } else {
          resultEl.innerHTML = `<div class="game-lose">Мошонка победил!</div>`;
          playUISound("lose");
        }
        endGame();
        return;
      }
      
      setTimeout(() => {
        if (destroyed || !gameActive) { playerTurn = true; return; }
        const move = moshonkaMove();
        if (move !== undefined) {
          board[move] = "O";
          playUISound("reveal");
          renderBoard();
          animateElement(cells[move], "popIn", 300);
          
          const w2 = checkWinner(board);
          if (w2) {
            gameActive = false;
            if (w2 === "O") {
              resultEl.innerHTML = `<div class="game-lose">Мошонка победил!</div>`;
              playUISound("lose");
            } else {
              resultEl.innerHTML = `<div class="game-neutral">Ничья!</div>`;
            }
            endGame();
          }
        }
        playerTurn = true;
      }, 500);
    });
  });

  root.querySelector("#play-again-btn").addEventListener("click", () => {
    if (isInline) {
      root.innerHTML = "";
      gameTicTacToe(root);
    } else {
      closeModal();
      setTimeout(() => gameTicTacToe(), 100);
    }
  });
}

function gameMinesweeper() {
  const cols = 8, rows = 8;
  const cellCount = cols * rows;
  const mineCount = 10;
  let board = Array(cellCount).fill(0);
  let revealed = Array(cellCount).fill(false);
  let flagged = Array(cellCount).fill(false);
  let gameActive = true;
  let minesPlaced = false;
  
  function placeMines(excludeIdx) {
    let placed = 0;
    while (placed < mineCount) {
      const idx = Math.floor(Math.random() * cellCount);
      if (idx !== excludeIdx && board[idx] !== -1) {
        board[idx] = -1;
        placed++;
      }
    }
    for (let i = 0; i < cellCount; i++) {
      if (board[i] === -1) continue;
      let count = 0;
      const r = Math.floor(i / cols), c = i % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const ni = nr * cols + nc;
            if (board[ni] === -1) count++;
          }
        }
      }
      board[i] = count;
    }
    minesPlaced = true;
  }
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Сапёр</h2>
    <p class="card-sub">Найди все безопасные клетки! 10 мин среди ${cellCount}.</p>
    <div class="game-mine-board" id="mine-board">
      ${Array(cellCount).fill("").map((_, i) => `<button class="mine-cell" data-idx="${i}"></button>`).join("")}
    </div>
    <!-- Резервируем место под сообщение результата и кнопку заранее, чтобы при окончании
         игры раскладка не «прыгала»: высота фиксирована, кнопка скрыта через visibility. -->
    <div class="game-result" id="mine-result" style="min-height:24px"></div>
    <div class="game-play-again" id="mine-again" style="visibility:hidden">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  const cells = modal.querySelectorAll(".mine-cell");
  const resultEl = modal.querySelector("#mine-result");

  // Очистка: останавливаем игровую логику при закрытии (звуки тут только по клику).
  registerGameCleanup(() => { gameActive = false; });

  function revealCell(idx) {
    if (revealed[idx] || flagged[idx] || !gameActive) return;
    if (!minesPlaced) placeMines(idx);
    
    revealed[idx] = true;
    const cell = cells[idx];
    cell.classList.add("revealed");
    
    if (board[idx] === -1) {
      gameActive = false;
      cell.classList.add("mine-hit");
      playUISound("mine");
      board.forEach((v, i) => {
        if (v === -1 && i !== idx) {
          cells[i].innerHTML = '<img src="/static/img/ui/mine.svg" alt="" class="mine-icon"/>';
          cells[i].classList.add("revealed", "mine-show");
        }
      });
      resultEl.innerHTML = `<div class="game-lose">Бум! Мошонка поставил мину.</div>`;
      modal.querySelector("#mine-again").style.visibility = "visible";
      return;
    }
    
    if (board[idx] > 0) {
      cell.innerHTML = `<span class="mine-num mine-num-${board[idx]}">${board[idx]}</span>`;
    } else if (board[idx] === 0) {
      const r = Math.floor(idx / cols), c = idx % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const ni = nr * cols + nc;
            if (!revealed[ni]) revealCell(ni);
          }
        }
      }
    }
    
    const safeCount = board.filter(v => v !== -1).length;
    const revealedCount = revealed.filter(v => v).length;
    if (revealedCount === safeCount) {
      gameActive = false;
      resultEl.innerHTML = `<div class="game-win">Все безопасные клетки найдены!</div>`;
      animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
      playUISound("win");
      awardFirstWin("minesweeper", { player_score: safeCount, opponent_score: mineCount });
      modal.querySelector("#mine-again").style.visibility = "visible";
    }
  }

  cells.forEach((cell) => {
    const idx = Number(cell.dataset.idx);
    cell.addEventListener("click", () => {
      if (flagged[idx]) return;
      revealCell(idx);
    });
    
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (revealed[idx] || !gameActive) return;
      flagged[idx] = !flagged[idx];
      cell.classList.toggle("flagged", flagged[idx]);
      cell.innerHTML = flagged[idx] ? '🚩' : '';
      playUISound("flag");
    });
    
    let pressTimer;
    cell.addEventListener("touchstart", (e) => {
      pressTimer = setTimeout(() => {
        if (revealed[idx] || !gameActive) return;
        flagged[idx] = !flagged[idx];
        cell.classList.toggle("flagged", flagged[idx]);
        cell.innerHTML = flagged[idx] ? '🚩' : '';
        playUISound("flag");
      }, 400);
    });
    cell.addEventListener("touchend", () => clearTimeout(pressTimer));
    cell.addEventListener("touchmove", () => clearTimeout(pressTimer));
  });

  modal.querySelector("#play-again-btn").addEventListener("click", () => {
    closeModal();
    setTimeout(gameMinesweeper, 100);
  });
}

function gameHarvest() {
  let score = 0;
  let timeLeft = 20;
  let gameInterval;
  let spawnInterval;
  
  const modal = window.kov.showModal(`
    <button class="close" id="harvest-close-btn">×</button>
    <h2>Собери урожай!</h2>
    <p class="card-sub">Кликай по тыквам!</p>
    <div class="game-stats">
      <span><img src="/static/img/ui/pumpkin.svg" alt="" class="game-icon-sm"/> <span id="harvest-count">0</span></span>
      <span>⏱️ <span id="harvest-time">${timeLeft}</span>с</span>
    </div>
    <div class="game-field game-field-large" id="harvest-field"></div>
    <div class="game-result" id="harvest-result"></div>
    <div class="game-play-again" id="harvest-again" style="display:none">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  const field = modal.querySelector("#harvest-field");
  const countEl = modal.querySelector("#harvest-count");
  const timeEl = modal.querySelector("#harvest-time");

  // Общая очистка: гасим оба интервала при любом закрытии/сворачивании.
  registerGameCleanup(() => {
    clearInterval(gameInterval);
    clearInterval(spawnInterval);
  });

  const closeBtn = modal.querySelector("#harvest-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      clearInterval(gameInterval);
      clearInterval(spawnInterval);
      closeModal();
    });
  }

  function spawnPumpkin() {
    if (timeLeft <= 0) return;
    const pumpkin = document.createElement("button");
    pumpkin.className = "game-pumpkin game-pumpkin-large";
    pumpkin.innerHTML = '<img src="/static/img/ui/pumpkin.svg" alt="" class="game-icon-lg"/>';
    pumpkin.style.left = Math.random() * 80 + "%";
    pumpkin.style.top = Math.random() * 75 + "%";
    pumpkin.addEventListener("click", () => {
      score++;
      countEl.textContent = score;
      playUISound("reveal");
      pumpkin.style.transform = "scale(1.3)";
      pumpkin.style.opacity = "0";
      setTimeout(() => pumpkin.remove(), 150);
    });
    field.appendChild(pumpkin);
    // Темп игры увеличен ~на 25%: тыквы живут меньше и спавнятся чаще.
    setTimeout(() => {
      if (pumpkin.parentNode) {
        pumpkin.style.opacity = "0";
        pumpkin.style.transform = "scale(0.5)";
        setTimeout(() => pumpkin.remove(), 200);
      }
    }, 600);
  }

  spawnInterval = setInterval(spawnPumpkin, 300);
  
  gameInterval = setInterval(() => {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      clearInterval(spawnInterval);
      if (score >= 10) {
        modal.querySelector("#harvest-result").innerHTML = `<div class="game-win">Урожай собран! Тыкв: ${score}.</div>`;
        playUISound("win");
        awardFirstWin("harvest", { player_score: score, opponent_score: 0 });
      } else if (score >= 5) {
        modal.querySelector("#harvest-result").innerHTML = `<div class="game-neutral">Неплохо! Тыкв: ${score}.</div>`;
      } else {
        modal.querySelector("#harvest-result").innerHTML = `<div class="game-lose">Мало тыкв: ${score}. Попробуй ещё!</div>`;
        playUISound("lose");
      }
      modal.querySelector("#harvest-again").style.display = "block";
    }
  }, 1000);

  modal.querySelector("#play-again-btn").addEventListener("click", () => {
    closeModal();
    setTimeout(gameHarvest, 100);
  });
}



function gameRoulette() {
  // label — то, что видит игрок; mult — числовой множитель, который должен совпадать с подписью label.
  // Целевой RTP ~92.8% (домовое преимущество ~7%): EV = Σ(mult*weight)/Σweight.
  const sectors = [
    { label: "x0.05", mult: 0.05, color: "#E55454", weight: 16 },
    { label: "x0.25", mult: 0.25, color: "#D32F2F", weight: 11 },
    { label: "x0.5", mult: 0.5, color: "#FF8A65", weight: 15 },
    { label: "x0.75", mult: 0.75, color: "#FFB74D", weight: 15 },
    { label: "x1", mult: 1, color: "#F2B33C", weight: 15 },
    { label: "x1.5", mult: 1.5, color: "#6BD995", weight: 12 },
    { label: "x2", mult: 2, color: "#6CB6FB", weight: 8 },
    { label: "x2.5", mult: 2.5, color: "#D387E5", weight: 5 },
    { label: "x3", mult: 3, color: "#AB47BC", weight: 3 },
  ];
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Рулетка</h2>
    <p class="card-sub">Крути и умножай ставку!</p>
    <div class="game-balance">Баланс: <strong id="roulette-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div class="game-wheel-risk" id="risk-wheel">
      ${sectors.map((s) => `<div class="risk-sector" style="background:${s.color}">${s.label}</div>`).join("")}
    </div>
    ${betInputHTML("roulette-bet")}
    <button class="btn" id="roulette-spin-btn">Крутить</button>
    <div class="game-result" id="roulette-result"></div>
  `);

  const wheel = modal.querySelector("#risk-wheel");
  const resultEl = modal.querySelector("#roulette-result");
  const spinBtn = modal.querySelector("#roulette-spin-btn");

  let spinInterval = null;
  // Очистка: при закрытии/сворачивании останавливаем анимацию вращения.
  registerGameCleanup(() => { if (spinInterval) clearInterval(spinInterval); });

  spinBtn.addEventListener("click", async () => {
    // Защита от двойного клика: дизейблим кнопку в начале, включаем после анимации.
    if (spinBtn.disabled) return;
    const bet = getBetValue("roulette-bet");
    if (balance < bet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }

    spinBtn.disabled = true;
    playUISound("bet");

    // Надёжное списание: ждём ответ /bet, при ошибке не крутим.
    let serverRound;
    try {
      serverRound = await post("/api/arcade/casino/start", { game: "roulette", amount: bet });
    } catch (_) {
      resultEl.innerHTML = `<div class="game-lose">Ошибка ставки, попробуйте ещё</div>`;
      spinBtn.disabled = false;
      return;
    }

    // Раунд пошёл — блокируем закрытие модалки до его завершения.
    setCasinoRoundLocked(true);

    balance = serverRound.balance;
    updateBalanceDisplay("roulette-balance", balance);

    const chosen = sectors[serverRound.outcome.index];
    const mult = Number(serverRound.outcome.multiplier);
    const win = Math.floor(bet * mult);
    const chosenIdx = serverRound.outcome.index;

    wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("active", "highlight"));
    let currentIdx = 0;
    let spins = 0;
    const maxSpins = 20 + chosenIdx;

    spinInterval = setInterval(async () => {
      wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("highlight"));
      wheel.children[currentIdx].classList.add("highlight");
      currentIdx = (currentIdx + 1) % sectors.length;
      spins++;
      if (spins % 2 === 0) playUISound("spin");

      if (spins >= maxSpins) {
        clearInterval(spinInterval);
        spinInterval = null;
        wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("highlight"));
        wheel.children[chosenIdx].classList.add("active");
        animateElement(wheel.children[chosenIdx], "popIn", 300);

        const settled = await post("/api/arcade/casino/settle", { token: serverRound.token });
        balance = settled.balance;
        if (mult > 1) {
          updateBalanceDisplay("roulette-balance", balance);
          resultEl.innerHTML = `<div class="game-win">${chosen.label}! Выигрыш: ${win} K</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
          playUISound("win");
        } else if (mult === 1) {
          updateBalanceDisplay("roulette-balance", balance);
          resultEl.innerHTML = `<div class="game-neutral">x1. Ставка возвращена.</div>`;
          playUISound("cashout");
        } else {
          resultEl.innerHTML = `<div class="game-lose">${chosen.label}. Ставка потеряна.</div>`;
          playUISound("lose");
        }
        await syncBalance();
        spinBtn.disabled = false;
        // Раунд завершён — снова можно закрывать модалку.
        setCasinoRoundLocked(false);
      }
    }, 100);
  });
}

function gameCheckers() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Шашки</h2>
    <div class="game-result" id="checkers-result"></div>
    <div id="checkers-board" class="checkers-board arcade-checkers-board"></div>
    <div id="checkers-status" style="text-align:center;font-weight:700;margin-top:8px">Твой ход</div>
  `);
  const board = modal.querySelector("#checkers-board");
  const status = modal.querySelector("#checkers-status");
  const resultEl = modal.querySelector("#checkers-result");
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const PLAYER = "o", AI = "x";
  const idx = (r, c) => r * 8 + c;
  const rc = (i) => [Math.floor(i / 8), i % 8];
  const owner = (piece) => piece === "x" || piece === "X" ? "x" : piece === "o" || piece === "O" ? "o" : null;
  const isKing = (piece) => piece === "X" || piece === "O";
  const opponent = (side) => side === "x" ? "o" : "x";
  const kingRow = (side) => side === "x" ? 7 : 0;
  const forward = (piece) => piece === "x" ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];

  let state = Array(64).fill("_");
  let selected = null;
  let turn = PLAYER;
  let destroyed = false;
  let finished = false;
  registerGameCleanup(() => { destroyed = true; });

  function initBoard() {
    state = Array(64).fill("_");
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) state[idx(r, c)] = "x";
    }
    for (let r = 5; r < 8; r++) {
      for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) state[idx(r, c)] = "o";
    }
  }

  function captureSteps(st, at, captured) {
    const piece = st[at], side = owner(piece);
    if (!side) return [];
    const [r, c] = rc(at), opp = opponent(side), result = [];
    if (isKing(piece)) {
      for (const [dr, dc] of DIAG) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && (st[idx(nr, nc)] === "_" || captured.has(idx(nr, nc)))) {
          nr += dr; nc += dc;
        }
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
        const middle = idx(nr, nc);
        if (owner(st[middle]) !== opp || captured.has(middle)) continue;
        let lr = nr + dr, lc = nc + dc;
        while (lr >= 0 && lr < 8 && lc >= 0 && lc < 8 && (st[idx(lr, lc)] === "_" || captured.has(idx(lr, lc)))) {
          result.push([middle, idx(lr, lc)]);
          lr += dr; lc += dc;
        }
      }
    } else {
      for (const [dr, dc] of DIAG) {
        const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
        if (tr < 0 || tr >= 8 || tc < 0 || tc >= 8) continue;
        const middle = idx(mr, mc), landing = idx(tr, tc);
        if (owner(st[middle]) === opp && !captured.has(middle) && (st[landing] === "_" || captured.has(landing))) {
          result.push([middle, landing]);
        }
      }
    }
    return result;
  }

  function captureChains(st, from) {
    const results = [];
    const dfs = (work, position, piece, captured, progressed) => {
      const steps = captureSteps(work, position, captured);
      if (!steps.length) {
        if (progressed) results.push({ end: position, captured: new Set(captured) });
        return;
      }
      for (const [middle, landing] of steps) {
        const next = work.slice();
        next[position] = "_";
        let nextPiece = piece;
        if (!isKing(piece) && rc(landing)[0] === kingRow(owner(piece))) nextPiece = owner(piece) === "x" ? "X" : "O";
        next[landing] = nextPiece;
        const nextCaptured = new Set(captured); nextCaptured.add(middle);
        dfs(next, landing, nextPiece, nextCaptured, true);
      }
    };
    dfs(st.slice(), from, st[from], new Set(), false);
    return results;
  }

  function sideHasCapture(st, side) {
    return st.some((piece, i) => owner(piece) === side && captureSteps(st, i, new Set()).length > 0);
  }

  function simpleMovesFrom(st, at) {
    const piece = st[at], side = owner(piece);
    if (!side) return [];
    const [r, c] = rc(at), result = [];
    if (isKing(piece)) {
      for (const [dr, dc] of DIAG) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && st[idx(nr, nc)] === "_") {
          result.push(idx(nr, nc)); nr += dr; nc += dc;
        }
      }
    } else {
      for (const [dr, dc] of forward(piece)) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && st[idx(nr, nc)] === "_") result.push(idx(nr, nc));
      }
    }
    return result;
  }

  function legalMoves(st, side) {
    const mustCapture = sideHasCapture(st, side), legal = {};
    st.forEach((piece, i) => {
      if (owner(piece) !== side) return;
      const moves = mustCapture
        ? [...new Set(captureChains(st, i).map((chain) => chain.end))].sort((a, b) => a - b)
        : simpleMovesFrom(st, i).sort((a, b) => a - b);
      if (moves.length) legal[i] = moves;
    });
    return legal;
  }

  function hasAnyMove(st, side) { return Object.keys(legalMoves(st, side)).length > 0; }

  function applyCheckersMove(st, side, from, to) {
    const piece = st[from];
    if (owner(piece) !== side || st[to] !== "_") return null;
    const next = st.slice();
    if (sideHasCapture(st, side)) {
      const matches = captureChains(st, from).filter((chain) => chain.end === to);
      if (!matches.length) return null;
      const chosen = matches.reduce((best, chain) => chain.captured.size > best.captured.size ? chain : best);
      let moved = piece;
      if (!isKing(piece) && rc(to)[0] === kingRow(side)) moved = side === "x" ? "X" : "O";
      next[from] = "_";
      chosen.captured.forEach((at) => { next[at] = "_"; });
      next[to] = moved;
    } else {
      if (!simpleMovesFrom(st, from).includes(to)) return null;
      next[from] = "_";
      next[to] = piece;
      if (!isKing(piece) && rc(to)[0] === kingRow(side)) next[to] = side === "x" ? "X" : "O";
    }
    const opp = opponent(side);
    const won = !next.some((p) => owner(p) === opp) || !hasAnyMove(next, opp);
    return { board: next, status: won ? `${side}_won` : "playing" };
  }

  function render() {
    const legal = turn === PLAYER && !finished ? legalMoves(state, PLAYER) : {};
    if (selected !== null && !legal[selected]) selected = null;
    const targets = selected !== null ? legal[selected] || [] : [];
    let html = "";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const i = idx(r, c), p = state[i], mine = owner(p) === PLAYER;
        const movable = !!legal[i], isSelected = selected === i, isTarget = targets.includes(i);
        const pieceColor = p === "x" || p === "X" ? "#f5f5f5" : "#3a2a1a";
        const pieceBorder = p === "x" || p === "X" ? "#bbb" : "#000";
        const piece = p !== "_" ? `<div style="width:74%;height:74%;border-radius:50%;background:${pieceColor};border:2px solid ${pieceBorder};display:flex;align-items:center;justify-content:center;font-size:12px;color:#d4a017">${isKing(p) ? "♛" : ""}</div>` : "";
        const bg = isSelected ? "#6cb6fb" : isTarget ? "#3fb950" : (r + c) % 2 === 1 ? "#7a8a5a" : "#e8e4cf";
        const ring = isTarget ? "box-shadow:inset 0 0 0 3px #1f6f30;" : movable && !isSelected ? "box-shadow:inset 0 0 0 2px #6cb6fb;" : "";
        const clickable = isTarget || (turn === PLAYER && mine && movable);
        html += `<div data-i="${i}" data-mine="${mine}" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:${bg};${ring}cursor:${clickable ? "pointer" : "default"}">${piece}</div>`;
      }
    }
    board.innerHTML = html;
    if (turn === PLAYER && !finished) board.querySelectorAll("[data-i]").forEach((cell) => {
      cell.addEventListener("click", () => handleClick(Number(cell.dataset.i), cell.dataset.mine === "true"));
    });
    status.textContent = finished ? "Партия завершена" : turn === PLAYER ? "Твой ход" : "Ход Мошонки…";
  }

  function finishGame(gameStatus) {
    if (gameStatus === "playing" || finished) return false;
    finished = true;
    const playerWon = gameStatus === `${PLAYER}_won`;
    resultEl.innerHTML = playerWon ? '<div class="game-win">Ты победил!</div>' : '<div class="game-lose">Мошонка победил!</div>';
    if (playerWon) {
      playUISound("win");
      const pieces = state.filter((piece) => owner(piece) === PLAYER).length;
      awardFirstWin("checkers", { player_score: pieces, opponent_score: 0 });
    } else playUISound("lose");
    render();
    return true;
  }

  function handleClick(at, mine) {
    if (finished || turn !== PLAYER) return;
    const legal = legalMoves(state, PLAYER);
    if (selected !== null && (legal[selected] || []).includes(at)) {
      const result = applyCheckersMove(state, PLAYER, selected, at);
      if (!result) return;
      state = result.board; selected = null;
      if (finishGame(result.status)) return;
      turn = AI; render();
      setTimeout(aiMove, 450);
      return;
    }
    if (mine && legal[at]) selected = selected === at ? null : at;
    else selected = null;
    render();
  }

  function allMoves(st, side) {
    const result = [];
    const legal = legalMoves(st, side);
    Object.entries(legal).forEach(([from, targets]) => targets.forEach((to) => result.push({ from: Number(from), to })));
    return result;
  }

  function evaluate(st) {
    let score = 0;
    st.forEach((piece, i) => {
      const side = owner(piece);
      if (!side) return;
      const [r] = rc(i);
      let value = isKing(piece) ? 5 : 3;
      if (!isKing(piece)) value += side === AI ? r * 0.12 : (7 - r) * 0.12;
      score += side === AI ? value : -value;
    });
    return score;
  }

  function minimax(st, side, depth, alpha, beta) {
    const moves = allMoves(st, side);
    if (depth === 0 || !moves.length) return evaluate(st) + (!moves.length ? (side === AI ? -1000 : 1000) : 0);
    if (side === AI) {
      let best = -Infinity;
      for (const move of moves) {
        const applied = applyCheckersMove(st, side, move.from, move.to);
        const value = minimax(applied.board, PLAYER, depth - 1, alpha, beta);
        best = Math.max(best, value); alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const move of moves) {
      const applied = applyCheckersMove(st, side, move.from, move.to);
      const value = minimax(applied.board, AI, depth - 1, alpha, beta);
      best = Math.min(best, value); beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  function aiMove() {
    if (destroyed || finished || turn !== AI) return;
    const moves = allMoves(state, AI);
    if (!moves.length) { finishGame(`${PLAYER}_won`); return; }
    let chosen = moves[0], best = -Infinity;
    for (const move of moves) {
      const applied = applyCheckersMove(state, AI, move.from, move.to);
      const value = minimax(applied.board, PLAYER, 3, -Infinity, Infinity);
      if (value > best) { best = value; chosen = move; }
    }
    const result = applyCheckersMove(state, AI, chosen.from, chosen.to);
    state = result.board;
    if (finishGame(result.status)) return;
    turn = PLAYER;
    render();
  }

  initBoard();
  render();
}

function gamePingPong() {
  const W = 300, H = 400;
  const PADDLE_W = 62, PADDLE_H = 10, BALL_R = 7;
  const TOP_PADDLE_Y = 16, BOTTOM_PADDLE_Y = H - 26;
  const INITIAL_BALL_SPEED = 245, MAX_BALL_SPEED = 430;
  const AI_MAX_SPEED = 220, AI_ACCELERATION = 920;
  const FIXED_STEP = 1 / 120, MAX_FRAME_TIME = 0.05;
  const GOAL_PAUSE_SECONDS = 0.65;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Пинг-понг</h2>
    <p class="card-sub">Игра до 5 очков</p>
    <canvas id="pp-canvas" width="${W}" height="${H}" aria-label="Поле для пинг-понга"
      style="background:#1a1a2e;border-radius:8px;display:block;margin:10px auto;touch-action:none;width:min(100%,300px);height:auto;aspect-ratio:3/4;user-select:none"></canvas>
    <div id="pp-score" style="text-align:center;font-weight:700;font-size:18px">0 : 0</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;min-height:34px;margin-top:6px">
      <button class="btn btn-sm" id="pp-pause" type="button">Пауза</button>
      <span class="card-sub" id="pp-state" aria-live="polite">Веди ракетку пальцем или мышью</span>
    </div>
    <div class="game-result" id="pp-result"></div>
  `);
  const canvas = modal.querySelector("#pp-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = modal.querySelector("#pp-score");
  const pauseButton = modal.querySelector("#pp-pause");
  const stateEl = modal.querySelector("#pp-state");
  const resultEl = modal.querySelector("#pp-result");
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let playerX = W / 2 - PADDLE_W / 2;
  let playerVelocity = 0;
  let aiX = W / 2 - PADDLE_W / 2;
  let aiVelocity = 0;
  let aiTarget = aiX;
  let aiThinkRemaining = 0;
  let aiTrackingApproach = false, aiAimBias = 0, aiAttackBias = 0;
  let ballX = W / 2, ballY = H / 2;
  let ballVX = INITIAL_BALL_SPEED * 0.35, ballVY = -INITIAL_BALL_SPEED * 0.94;
  let playerScore = 0, aiScore = 0;
  let running = true, manualPaused = false, visibilityPaused = false;
  let goalPauseRemaining = 0.5;
  let activeMatchSeconds = 0;
  let accumulator = 0, lastFrameTime = null, rafId = null;
  let activePointer = null, lastPointerX = null, lastPointerTime = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isPaused() {
    return manualPaused || visibilityPaused;
  }

  function cancelFrame() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function requestFrame() {
    if (running && !isPaused() && rafId === null) rafId = requestAnimationFrame(frame);
  }

  function refreshPauseUI() {
    pauseButton.textContent = manualPaused ? "Продолжить" : "Пауза";
    if (visibilityPaused) stateEl.textContent = "Пауза — приложение свёрнуто";
    else if (manualPaused) stateEl.textContent = "Игра на паузе";
    else stateEl.textContent = "Веди ракетку пальцем или мышью";
  }

  function setVisibilityPaused(hidden) {
    if (!running) return;
    visibilityPaused = hidden;
    lastFrameTime = null;
    accumulator = 0;
    if (hidden) cancelFrame();
    else requestFrame();
    refreshPauseUI();
  }

  registerGameCleanup(() => {
    running = false;
    cancelFrame();
  }, setVisibilityPaused);

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#6cb6fb";
    ctx.fillRect(playerX, BOTTOM_PADDLE_Y, PADDLE_W, PADDLE_H);
    ctx.fillStyle = "#e55454";
    ctx.fillRect(aiX, TOP_PADDLE_Y, PADDLE_W, PADDLE_H);
    ctx.save();
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "rgba(255,215,0,0.45)";
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Mirror a projected X coordinate between the two side walls.  The AI uses
  // only the current visible position/velocity, like a player estimating the
  // next bounce; it does not inspect future random values.
  function reflectedX(projectedX) {
    const span = W - BALL_R * 2;
    const period = span * 2;
    let offset = (projectedX - BALL_R) % period;
    if (offset < 0) offset += period;
    if (offset > span) offset = period - offset;
    return BALL_R + offset;
  }

  function predictAiIntersection() {
    const contactY = TOP_PADDLE_Y + PADDLE_H + BALL_R;
    if (ballVY >= -1 || ballY <= contactY) return W / 2;
    const seconds = (ballY - contactY) / -ballVY;
    return reflectedX(ballX + ballVX * seconds);
  }

  function updateAiPlan() {
    const ballApproaching = ballVY < 0;
    if (!ballApproaching) {
      // Recover towards a useful neutral position rather than following the
      // ball all the way to the player's side.
      aiTrackingApproach = false;
      aiTarget = clamp(W / 2 - PADDLE_W / 2 + (ballX - W / 2) * 0.12, 0, W - PADDLE_W);
      aiThinkRemaining = 0.18 + Math.random() * 0.08;
      return;
    }

    const predicted = predictAiIntersection();
    const speed = Math.hypot(ballVX, ballVY);
    const closeThreat = ballY < H * 0.42;
    const defensive = closeThreat || speed > 350 || aiScore > playerScore;
    if (!aiTrackingApproach) {
      const errorRadius = defensive ? 9 : 15;
      aiAimBias = (Math.random() + Math.random() - 1) * errorRadius;
      // A small, controlled chance of a pressured mistake keeps the hard AI
      // beatable.  Bias remains stable for the rally, so the paddle does not
      // jitter as the forecast is refreshed.
      const mistakeChance = speed > 340 ? 0.09 : 0.055;
      if (Math.random() < mistakeChance) {
        aiAimBias += (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 14);
      }
      // When attacking, meet slightly off-centre to send a less uniform return.
      aiAttackBias = defensive ? 0 : (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 7);
      aiTrackingApproach = true;
    }
    aiTarget = clamp(predicted - PADDLE_W / 2 + aiAimBias + aiAttackBias, 0, W - PADDLE_W);
    aiThinkRemaining = (closeThreat ? 0.09 : 0.13) + Math.random() * 0.08;
  }

  function moveAi(dt) {
    aiThinkRemaining -= dt;
    if (aiThinkRemaining <= 0) updateAiPlan();

    const distance = aiTarget - aiX;
    const desiredVelocity = Math.abs(distance) < 2
      ? 0
      : clamp(distance / 0.16, -AI_MAX_SPEED, AI_MAX_SPEED);
    const velocityDelta = clamp(
      desiredVelocity - aiVelocity,
      -AI_ACCELERATION * dt,
      AI_ACCELERATION * dt,
    );
    aiVelocity += velocityDelta;
    if (Math.abs(distance) < 2.5) aiVelocity *= Math.exp(-12 * dt);
    aiX = clamp(aiX + aiVelocity * dt, 0, W - PADDLE_W);
    if ((aiX <= 0 && aiVelocity < 0) || (aiX >= W - PADDLE_W && aiVelocity > 0)) aiVelocity = 0;
  }

  function bounceFromPaddle(paddleX, paddleVelocity, verticalDirection, hitX) {
    const relativeHit = clamp(
      (hitX - (paddleX + PADDLE_W / 2)) / (PADDLE_W / 2 + BALL_R),
      -1,
      1,
    );
    const nextSpeed = Math.min(MAX_BALL_SPEED, Math.max(INITIAL_BALL_SPEED, Math.hypot(ballVX, ballVY) * 1.045));
    const maxAngle = Math.PI * 0.34; // ~61°, avoids a nearly-horizontal stuck ball.
    const angle = relativeHit * maxAngle;
    let nextVX = nextSpeed * Math.sin(angle) + paddleVelocity * 0.11;
    let nextVY = verticalDirection * Math.abs(nextSpeed * Math.cos(angle));
    const normalizedSpeed = Math.hypot(nextVX, nextVY);
    if (normalizedSpeed > MAX_BALL_SPEED) {
      const scale = MAX_BALL_SPEED / normalizedSpeed;
      nextVX *= scale;
      nextVY *= scale;
    }
    ballVX = nextVX;
    ballVY = nextVY;
  }

  function finishMatch(playerWon) {
    running = false;
    cancelFrame();
    pauseButton.disabled = true;
    stateEl.textContent = "Матч завершён";
    if (playerWon) {
      resultEl.innerHTML = '<div class="game-win">Ты победил!</div>';
      playUISound("win");
      awardFirstWin("pingpong", {
        player_score: playerScore,
        opponent_score: aiScore,
        duration_ms: Math.round(activeMatchSeconds * 1000),
      });
    } else {
      resultEl.innerHTML = '<div class="game-lose">Мошонка победил</div>';
    }
  }

  function resetBall(verticalDirection) {
    ballX = W / 2;
    ballY = H / 2;
    const horizontal = (Math.random() * 0.76 - 0.38) * INITIAL_BALL_SPEED;
    ballVX = horizontal;
    ballVY = verticalDirection * Math.sqrt(INITIAL_BALL_SPEED ** 2 - horizontal ** 2);
    goalPauseRemaining = GOAL_PAUSE_SECONDS;
    aiThinkRemaining = 0;
    aiTrackingApproach = false;
  }

  function scorePoint(playerWon) {
    if (playerWon) playerScore += 1;
    else aiScore += 1;
    scoreEl.textContent = `${playerScore} : ${aiScore}`;
    if (playerScore >= 5 || aiScore >= 5) {
      finishMatch(playerScore >= 5);
      return;
    }
    // The player who conceded receives the next serve.
    resetBall(playerWon ? 1 : -1);
  }

  function moveBall(dt) {
    const previousX = ballX;
    const previousY = ballY;
    ballX += ballVX * dt;
    ballY += ballVY * dt;

    if (ballX < BALL_R) {
      ballX = BALL_R + (BALL_R - ballX);
      ballVX = Math.abs(ballVX);
    } else if (ballX > W - BALL_R) {
      ballX = W - BALL_R - (ballX - (W - BALL_R));
      ballVX = -Math.abs(ballVX);
    }

    const topContactY = TOP_PADDLE_Y + PADDLE_H + BALL_R;
    if (ballVY < 0 && previousY >= topContactY && ballY <= topContactY) {
      const travel = previousY - ballY;
      const ratio = travel > 0 ? (previousY - topContactY) / travel : 0;
      const hitX = previousX + (ballX - previousX) * ratio;
      if (hitX >= aiX - BALL_R && hitX <= aiX + PADDLE_W + BALL_R) {
        ballX = hitX;
        ballY = topContactY;
        bounceFromPaddle(aiX, aiVelocity, 1, hitX);
      }
    }

    const bottomContactY = BOTTOM_PADDLE_Y - BALL_R;
    if (ballVY > 0 && previousY <= bottomContactY && ballY >= bottomContactY) {
      const travel = ballY - previousY;
      const ratio = travel > 0 ? (bottomContactY - previousY) / travel : 0;
      const hitX = previousX + (ballX - previousX) * ratio;
      if (hitX >= playerX - BALL_R && hitX <= playerX + PADDLE_W + BALL_R) {
        ballX = hitX;
        ballY = bottomContactY;
        bounceFromPaddle(playerX, playerVelocity, -1, hitX);
      }
    }

    if (ballY + BALL_R < 0) scorePoint(true);
    else if (ballY - BALL_R > H) scorePoint(false);
  }

  function simulate(dt) {
    activeMatchSeconds += dt;
    playerVelocity *= Math.exp(-8 * dt);
    moveAi(dt);
    if (goalPauseRemaining > 0) {
      goalPauseRemaining = Math.max(0, goalPauseRemaining - dt);
      return;
    }
    moveBall(dt);
  }

  function frame(timestamp) {
    rafId = null;
    if (!running || !canvas.isConnected || isPaused()) return;
    if (lastFrameTime === null) lastFrameTime = timestamp;
    const frameSeconds = Math.min(MAX_FRAME_TIME, Math.max(0, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
    accumulator += frameSeconds;
    while (accumulator >= FIXED_STEP && running) {
      simulate(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    draw();
    requestFrame();
  }

  function movePlayer(clientX, eventTime) {
    const rect = canvas.getBoundingClientRect();
    const logicalX = (clientX - rect.left) * W / rect.width;
    const nextX = clamp(logicalX - PADDLE_W / 2, 0, W - PADDLE_W);
    if (lastPointerX !== null && lastPointerTime !== null) {
      const dt = Math.max(0.008, (eventTime - lastPointerTime) / 1000);
      playerVelocity = clamp((nextX - lastPointerX) / dt, -650, 650);
    }
    playerX = nextX;
    lastPointerX = nextX;
    lastPointerTime = eventTime;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!running) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    movePlayer(event.clientX, event.timeStamp);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || event.pointerId === activePointer) {
      movePlayer(event.clientX, event.timeStamp);
      if (event.pointerType !== "mouse") event.preventDefault();
    }
  });
  const releasePointer = (event) => {
    if (event.pointerId === activePointer) activePointer = null;
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  pauseButton.addEventListener("click", () => {
    if (!running) return;
    manualPaused = !manualPaused;
    lastFrameTime = null;
    accumulator = 0;
    if (manualPaused) cancelFrame();
    else requestFrame();
    refreshPauseUI();
  });

  resetBall(-1);
  refreshPauseUI();
  draw();
  requestFrame();
}

function gameSlots() {
  const symbols = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Слоты</h2>
    <p class="card-sub">3 одинаковых = x29</p>
    <div class="game-balance">Баланс: <strong id="slots-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div id="slots-reels" style="display:flex;gap:8px;justify-content:center;margin:16px 0;font-size:36px;min-height:50px">
      <span id="s1" style="background:rgba(255,255,255,0.05);padding:8px 16px;border-radius:8px;min-width:50px;text-align:center">?</span>
      <span id="s2" style="background:rgba(255,255,255,0.05);padding:8px 16px;border-radius:8px;min-width:50px;text-align:center">?</span>
      <span id="s3" style="background:rgba(255,255,255,0.05);padding:8px 16px;border-radius:8px;min-width:50px;text-align:center">?</span>
    </div>
    ${betInputHTML("slots-bet")}
    <button class="btn" id="slots-spin">Крутить!</button>
    <div class="game-result" id="slots-result"></div>
  `);
  const resultEl = modal.querySelector("#slots-result");
  const spinBtn = modal.querySelector("#slots-spin");
  let si = null;
  // Очистка: при закрытии/сворачивании останавливаем прокрутку барабанов.
  registerGameCleanup(() => { if (si) clearInterval(si); });
  spinBtn.addEventListener("click", async () => {
    if (spinBtn.disabled) return;
    spinBtn.disabled = true;
    const bet = getBetValue("slots-bet");
    if (balance < bet) { resultEl.innerHTML = '<div class="game-lose">Недостаточно K</div>'; spinBtn.disabled = false; return; }
    // Надёжное списание: ждём ответ /bet, при ошибке не крутим.
    let serverRound;
    try {
      serverRound = await post("/api/arcade/casino/start", { game: "slots", amount: bet });
    } catch (_) {
      resultEl.innerHTML = '<div class="game-lose">Ошибка ставки, попробуйте ещё</div>';
      spinBtn.disabled = false;
      return;
    }
    // Раунд пошёл — блокируем закрытие модалки до результата.
    setCasinoRoundLocked(true);
    balance = serverRound.balance;
    updateBalanceDisplay("slots-balance", balance);
    playUISound("spin");
    const [r1, r2, r3] = serverRound.outcome.reels;
    let spins = 0;
    si = setInterval(async () => {
      modal.querySelector("#s1").textContent = symbols[Math.floor(Math.random() * symbols.length)];
      modal.querySelector("#s2").textContent = symbols[Math.floor(Math.random() * symbols.length)];
      modal.querySelector("#s3").textContent = symbols[Math.floor(Math.random() * symbols.length)];
      spins++;
      if (spins > 15) {
        clearInterval(si);
        si = null;
        modal.querySelector("#s1").textContent = r1;
        modal.querySelector("#s2").textContent = r2;
        modal.querySelector("#s3").textContent = r3;
        spinBtn.disabled = false;
        const settled = await post("/api/arcade/casino/settle", { token: serverRound.token });
        balance = settled.balance;
        // Целевой RTP ~95.9% (чуть выгоднее игроку): джекпот x29 при p=7/343,
        // пара x1 (возврат ставки) при p=126/343.
        if (r1 === r2 && r2 === r3) {
          const win = Math.floor(bet * 29);
          updateBalanceDisplay("slots-balance", balance);
          resultEl.innerHTML = '<div class="game-win">ДЖЕКПОТ! +' + win + ' K</div>';
          playUISound("win");
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
          const win = Math.floor(bet * 1);
          updateBalanceDisplay("slots-balance", balance);
          resultEl.innerHTML = '<div class="game-neutral">Пара! Ставка возвращена.</div>';
          playUISound("cashout");
        } else {
          resultEl.innerHTML = '<div class="game-lose">Мимо</div>';
          playUISound("lose");
        }
        syncBalance();
        // Раунд завершён — закрытие снова доступно.
        setCasinoRoundLocked(false);
      }
    }, 80);
  });
}

function gameRocket() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Ракета</h2>
    <p class="card-sub">Забери выигрыш до взрыва!</p>
    <div class="game-balance">Баланс: <strong id="rocket-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div id="rocket-mult" style="font-size:48px;font-weight:900;text-align:center;margin:20px 0;color:#6cb6fb">x1.00</div>
    ${betInputHTML("rocket-bet")}
    <button class="btn" id="rocket-start">Запустить!</button>
    <button class="btn btn-secondary" id="rocket-cashout" style="display:none">Забрать</button>
    <div class="game-result" id="rocket-result"></div>
  `);
  const multEl = modal.querySelector("#rocket-mult");
  const resultEl = modal.querySelector("#rocket-result");
  const startBtn = modal.querySelector("#rocket-start");
  const cashBtn = modal.querySelector("#rocket-cashout");
  let mult = 1;
  let running = false;
  let bet = 0;
  let animationTimer = null;
  let statusTimer = null;
  let statusBusy = false;
  let serverRound = null;
  let startedAt = 0;
  let growthPerSecond = 0.25;
  let maxMultiplier = 5;

  function stopTimers() {
    if (animationTimer) clearInterval(animationTimer);
    if (statusTimer) clearInterval(statusTimer);
    animationTimer = null;
    statusTimer = null;
  }

  function drawMultiplier() {
    if (!running) return;
    const elapsed = Math.max(0, (performance.now() - startedAt) / 1000);
    mult = Math.min(maxMultiplier, 1 + elapsed * growthPerSecond);
    multEl.textContent = "x" + mult.toFixed(2);
  }

  async function finishCrash(status) {
    if (!running || !serverRound) return;
    const token = serverRound.token;
    running = false;
    stopTimers();
    cashBtn.disabled = true;
    cashBtn.style.display = "none";
    startBtn.style.display = "";
    multEl.style.color = "#e55454";
    multEl.textContent = "💥 ВЗРЫВ";
    let crashMultiplier = Number(status && status.crash_multiplier);
    try {
      const settled = await post("/api/arcade/casino/settle", { token });
      balance = settled.balance;
      updateBalanceDisplay("rocket-balance", balance);
      if (Number.isFinite(Number(settled.crash_multiplier))) {
        crashMultiplier = Number(settled.crash_multiplier);
      }
    } catch (_) {
      await syncBalance();
    }
    const suffix = Number.isFinite(crashMultiplier) ? " на x" + crashMultiplier.toFixed(2) : "";
    resultEl.innerHTML = '<div class="game-lose">Ракета взорвалась' + suffix + "</div>";
    playUISound("lose");
    cashBtn.disabled = false;
    startBtn.disabled = false;
    setCasinoRoundLocked(false);
  }

  async function pollRocketStatus() {
    if (!running || !serverRound || statusBusy) return;
    const token = serverRound.token;
    statusBusy = true;
    try {
      const status = await get(
        "/api/arcade/casino/rocket/status?token=" + encodeURIComponent(token),
        { cache: false },
      );
      // A cashout or a newer round may have completed while this poll travelled.
      if (!running || !serverRound || serverRound.token !== token) return;
      if (status.crashed) {
        await finishCrash(status);
        return;
      }
      const serverMultiplier = Number(status.current_multiplier);
      if (Number.isFinite(serverMultiplier) && serverMultiplier > mult) {
        mult = Math.min(maxMultiplier, serverMultiplier);
        multEl.textContent = "x" + mult.toFixed(2);
      }
    } catch (_) {
      // A temporary status error must not invent a win or end the round. The
      // cashout endpoint still checks the authoritative server clock.
    } finally {
      statusBusy = false;
    }
  }

  function startTimers() {
    stopTimers();
    animationTimer = setInterval(drawMultiplier, 50);
    statusTimer = setInterval(pollRocketStatus, 250);
    drawMultiplier();
    pollRocketStatus();
  }

  registerGameCleanup(
    () => {
      stopTimers();
      running = false;
    },
    (hidden) => {
      // Telegram may throttle timers in the background; the server clock does
      // not pause, so resynchronise immediately when the mini-app is restored.
      if (!hidden && running) pollRocketStatus();
    },
  );

  startBtn.addEventListener("click", async () => {
    if (running) return;
    bet = getBetValue("rocket-bet");
    if (balance < bet) { resultEl.innerHTML = '<div class="game-lose">Недостаточно K</div>'; return; }
    if (startBtn.disabled) return;
    startBtn.disabled = true;
    try {
      serverRound = await post("/api/arcade/casino/start", { game: "rocket", amount: bet });
    } catch (_) {
      resultEl.innerHTML = '<div class="game-lose">Ошибка ставки, попробуйте ещё</div>';
      startBtn.disabled = false;
      return;
    }
    startBtn.disabled = false;
    balance = serverRound.balance;
    updateBalanceDisplay("rocket-balance", balance);
    growthPerSecond = Number(serverRound.outcome && serverRound.outcome.growth_per_second) || 0.25;
    maxMultiplier = Number(serverRound.outcome && serverRound.outcome.max_multiplier) || 5;
    startedAt = performance.now();
    mult = 1;
    running = true;
    setCasinoRoundLocked(true);
    startBtn.style.display = "none";
    cashBtn.style.display = "";
    cashBtn.disabled = false;
    multEl.style.color = "#6cb6fb";
    multEl.textContent = "x1.00";
    resultEl.innerHTML = "";
    startTimers();
  });

  cashBtn.addEventListener("click", async () => {
    if (!running || cashBtn.disabled || !serverRound) return;
    cashBtn.disabled = true;
    running = false;
    stopTimers();
    try {
      // The payout is derived only from the server clock; the client sends no
      // multiplier that could be altered through DevTools or a direct request.
      const settled = await post("/api/arcade/casino/settle", { token: serverRound.token });
      balance = settled.balance;
      updateBalanceDisplay("rocket-balance", balance);
      if (settled.crashed) {
        multEl.style.color = "#e55454";
        multEl.textContent = "💥 ВЗРЫВ";
        const crashAt = Number(settled.crash_multiplier);
        const suffix = Number.isFinite(crashAt) ? " на x" + crashAt.toFixed(2) : "";
        resultEl.innerHTML = '<div class="game-lose">Ракета взорвалась' + suffix + "</div>";
        playUISound("lose");
      } else {
        const settledMultiplier = Number(settled.multiplier);
        mult = Number.isFinite(settledMultiplier) ? settledMultiplier : mult;
        multEl.textContent = "x" + mult.toFixed(2);
        multEl.style.color = "#6bd995";
        resultEl.innerHTML = '<div class="game-win">Забрал x' + mult.toFixed(2) + "! +" + settled.payout + " K</div>";
        playUISound("win");
      }
      cashBtn.style.display = "none";
      startBtn.style.display = "";
      setCasinoRoundLocked(false);
      syncBalance();
    } catch (error) {
      // Never claim a local payout when the server did not confirm it.
      resultEl.innerHTML = '<div class="game-lose">Не удалось подтвердить вывод: ' + escapeHtml(error.message) + "</div>";
      await syncBalance();
      cashBtn.style.display = "none";
      startBtn.style.display = "";
      setCasinoRoundLocked(false);
    } finally {
      cashBtn.disabled = false;
      startBtn.disabled = false;
    }
  });
}

function gameDice() {
  const diceSVG = [
    '<svg viewBox="0 0 36 36" width="48" height="48"><rect width="36" height="36" rx="6" fill="#fff" stroke="#ccc"/><circle cx="18" cy="18" r="3" fill="#333"/></svg>',
    '<svg viewBox="0 0 36 36" width="48" height="48"><rect width="36" height="36" rx="6" fill="#fff" stroke="#ccc"/><circle cx="10" cy="10" r="3" fill="#333"/><circle cx="26" cy="26" r="3" fill="#333"/></svg>',
    '<svg viewBox="0 0 36 36" width="48" height="48"><rect width="36" height="36" rx="6" fill="#fff" stroke="#ccc"/><circle cx="10" cy="10" r="3" fill="#333"/><circle cx="18" cy="18" r="3" fill="#333"/><circle cx="26" cy="26" r="3" fill="#333"/></svg>',
    '<svg viewBox="0 0 36 36" width="48" height="48"><rect width="36" height="36" rx="6" fill="#fff" stroke="#ccc"/><circle cx="10" cy="10" r="3" fill="#333"/><circle cx="26" cy="10" r="3" fill="#333"/><circle cx="10" cy="26" r="3" fill="#333"/><circle cx="26" cy="26" r="3" fill="#333"/></svg>',
    '<svg viewBox="0 0 36 36" width="48" height="48"><rect width="36" height="36" rx="6" fill="#fff" stroke="#ccc"/><circle cx="10" cy="10" r="3" fill="#333"/><circle cx="26" cy="10" r="3" fill="#333"/><circle cx="18" cy="18" r="3" fill="#333"/><circle cx="10" cy="26" r="3" fill="#333"/><circle cx="26" cy="26" r="3" fill="#333"/></svg>',
    '<svg viewBox="0 0 36 36" width="48" height="48"><rect width="36" height="36" rx="6" fill="#fff" stroke="#ccc"/><circle cx="10" cy="10" r="3" fill="#333"/><circle cx="26" cy="10" r="3" fill="#333"/><circle cx="10" cy="18" r="3" fill="#333"/><circle cx="26" cy="18" r="3" fill="#333"/><circle cx="10" cy="26" r="3" fill="#333"/><circle cx="26" cy="26" r="3" fill="#333"/></svg>',
  ];
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Кости</h2>
    <p class="card-sub">Брось кубик и угадай!</p>
    <div class="game-balance">Баланс: <strong id="dice-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div id="dice-result" style="text-align:center;margin:20px 0">${diceSVG[0]}</div>
    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:8px 0">
      <button class="btn btn-sm dice-pick" data-pick="odd">Нечёт (x1.8)</button>
      <button class="btn btn-sm dice-pick" data-pick="even">Чёт (x1.8)</button>
    </div>
    <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin:8px 0">
      <button class="btn btn-sm dice-pick" data-pick="1">1 (x5)</button>
      <button class="btn btn-sm dice-pick" data-pick="2">2 (x5)</button>
      <button class="btn btn-sm dice-pick" data-pick="3">3 (x5)</button>
      <button class="btn btn-sm dice-pick" data-pick="4">4 (x5)</button>
      <button class="btn btn-sm dice-pick" data-pick="5">5 (x5)</button>
      <button class="btn btn-sm dice-pick" data-pick="6">6 (x5)</button>
    </div>
    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:8px 0">
      <button class="btn btn-sm dice-pick" data-pick="low">1-3 (x1.8)</button>
      <button class="btn btn-sm dice-pick" data-pick="high">4-6 (x1.8)</button>
    </div>
    ${betInputHTML("dice-bet")}
    <div class="game-result" id="dice-res"></div>
  `);
  const diceEl = modal.querySelector("#dice-result");
  const resEl = modal.querySelector("#dice-res");
  let rolling = false;

  modal.querySelectorAll(".dice-pick").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (rolling) return;
      const bet = getBetValue("dice-bet");
      if (balance < bet) { resEl.innerHTML = '<div class="game-lose">Недостаточно K</div>'; return; }
      rolling = true;
      // Надёжное списание: ждём ответ /bet, при ошибке не бросаем.
      let serverRound;
      try {
        serverRound = await post("/api/arcade/casino/start", { game: "dice", amount: bet, choice: btn.dataset.pick });
      } catch (_) {
        resEl.innerHTML = '<div class="game-lose">Ошибка ставки, попробуйте ещё</div>';
        rolling = false;
        return;
      }
      balance = serverRound.balance;
      updateBalanceDisplay("dice-balance", balance);
      const roll = Number(serverRound.outcome.roll);
      let spins = 0;
      const si = setInterval(async () => {
        diceEl.innerHTML = diceSVG[Math.floor(Math.random() * 6)];
        spins++;
        if (spins > 15) {
          clearInterval(si);
          diceEl.innerHTML = diceSVG[roll - 1];
          const pick = btn.dataset.pick;
          let win = 0;
          // Множители должны совпадать с подписями кнопок UI:
          // чёт/нечёт/1-3/4-6 = x1.8, конкретное число = x5.
          if (pick === "odd" && roll % 2 === 1) win = Math.floor(bet * 1.8);
          else if (pick === "even" && roll % 2 === 0) win = Math.floor(bet * 1.8);
          else if (pick === "low" && roll <= 3) win = Math.floor(bet * 1.8);
          else if (pick === "high" && roll >= 4) win = Math.floor(bet * 1.8);
          else if (pick === String(roll)) win = bet * 5;
          const settled = await post("/api/arcade/casino/settle", { token: serverRound.token });
          balance = settled.balance;
          if (win > 0) {
            updateBalanceDisplay("dice-balance", balance);
            resEl.innerHTML = '<div class="game-win">Выпало ' + roll + '! +' + win + ' K</div>';
            playUISound("win");
          } else {
            resEl.innerHTML = '<div class="game-lose">Выпало ' + roll + '. Мимо</div>';
            playUISound("lose");
          }
          syncBalance();
          rolling = false;
        }
      }, 80);
    });
  });
}

function gameClicker() {
  let st = null;
  let pendingTaps = 0;
  let tapTimer = null;
  let energyTimer = null;
  let pollTimer = null;
  let destroyed = false;
  let lastSyncEnergy = 0;
  let lastSyncTime = 0;
  let turboUntil = 0;        // ms-таймстамп конца турбо (клиентский)
  let passiveUntil = 0;      // ms-таймстамп конца буста пассива
  let lockedUntil = 0;       // ms-таймстамп конца блокировки анти-фрода

  const COIN = "/static/img/ui/kovcoin.svg";
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Кликер</h2>
    <p class="card-sub">Тапай и зарабатывай ковкойны, выводи в ковбаксы!</p>
    <div class="clicker-level">
      <div class="clicker-level-head">
        <span class="clicker-rank" id="clicker-rank">Юнга</span>
        <span class="clicker-lvl" id="clicker-lvl">Ур. 0</span>
      </div>
      <div class="clicker-level-bar"><div class="clicker-level-fill" id="clicker-level-fill"></div></div>
    </div>
    <div class="clicker-stats">
      <div class="clicker-balance">
        <img src="${COIN}" alt="" class="game-icon-sm"/>
        <strong id="clicker-balance">0</strong>
        <span class="clicker-cur">ковкойнов</span>
      </div>
      <div class="clicker-passive" id="clicker-passive-info">💤 0/мин</div>
    </div>
    <div class="clicker-daily" id="clicker-daily">
      <div class="clicker-daily-head">
        <span>Дневной лимит</span>
        <span id="clicker-daily-text">0 / 0</span>
      </div>
      <div class="clicker-daily-bar"><div class="clicker-daily-fill" id="clicker-daily-fill"></div></div>
    </div>
    <div class="clicker-energy-bar">
      <div class="clicker-energy-fill" id="clicker-energy-fill"></div>
      <span class="clicker-energy-text" id="clicker-energy-text">0 / 100</span>
    </div>
    <div class="clicker-coin-wrapper">
      <button class="clicker-coin" id="clicker-coin">
        <img src="${COIN}" alt="tap" />
        <div class="clicker-coin-power" id="clicker-power">+1</div>
      </button>
      <div class="clicker-floats" id="clicker-floats"></div>
      <div class="clicker-lock" id="clicker-lock" hidden>🚫<br><span id="clicker-lock-text"></span></div>
    </div>
    <div class="clicker-cashout" id="clicker-cashout">
      <div class="clicker-cashout-info">
        <span class="clicker-cashout-rate">100 ковкойнов = 1 ковбакс</span>
        <span class="clicker-cashout-wallet"><img src="/static/img/ui/coin.svg" class="game-icon-sm"/> <strong id="clicker-wallet">0</strong> ковбаксов</span>
      </div>
      <button class="btn clicker-cashout-btn" id="clicker-cashout-btn">Вывести в ковбаксы</button>
    </div>
    <div class="clicker-boosts" id="clicker-boosts"></div>
    <h3 class="clicker-shop-title">Улучшения (за ковкойны)</h3>
    <div class="clicker-upgrades" id="clicker-upgrades"></div>
  `);

  const elBalance = modal.querySelector("#clicker-balance");
  const elEnergyFill = modal.querySelector("#clicker-energy-fill");
  const elEnergyText = modal.querySelector("#clicker-energy-text");
  const elCoin = modal.querySelector("#clicker-coin");
  const elPower = modal.querySelector("#clicker-power");
  const elFloats = modal.querySelector("#clicker-floats");
  const elUpgrades = modal.querySelector("#clicker-upgrades");
  const elPassiveInfo = modal.querySelector("#clicker-passive-info");
  const elBoosts = modal.querySelector("#clicker-boosts");
  const elRank = modal.querySelector("#clicker-rank");
  const elLvl = modal.querySelector("#clicker-lvl");
  const elLevelFill = modal.querySelector("#clicker-level-fill");
  const elLock = modal.querySelector("#clicker-lock");
  const elLockText = modal.querySelector("#clicker-lock-text");
  const elCoinWrap = modal.querySelector(".clicker-coin-wrapper");
  const elDailyText = modal.querySelector("#clicker-daily-text");
  const elDailyFill = modal.querySelector("#clicker-daily-fill");
  const elWallet = modal.querySelector("#clicker-wallet");
  const elCashoutBtn = modal.querySelector("#clicker-cashout-btn");

  function fmt(n) { return Math.floor(n).toLocaleString("ru-RU"); }
  function now() { return Date.now(); }
  function turboActive() { return now() < turboUntil; }
  function passiveActive() { return now() < passiveUntil; }
  function lockedActive() { return now() < lockedUntil; }

  function showFloat(text, x, y, isCrit) {
    const f = document.createElement("div");
    f.className = "clicker-float" + (isCrit ? " clicker-float-crit" : "");
    f.textContent = text;
    f.style.left = x + "px";
    f.style.top = y + "px";
    elFloats.appendChild(f);
    setTimeout(() => f.remove(), 800);
  }

  function getCurrentEnergy() {
    if (!st) return 0;
    const elapsed = (Date.now() - lastSyncTime) / 1000;
    return Math.min(st.max_energy, lastSyncEnergy + st.regen_per_sec * elapsed);
  }

  function capReached() {
    return !!(st && st.cap_reached);
  }

  function updateEnergyBar() {
    if (!st || destroyed) return;
    const e = getCurrentEnergy();
    const pct = (e / st.max_energy) * 100;
    elEnergyFill.style.width = pct + "%";
    if (turboActive()) {
      elEnergyText.textContent = "ТУРБО ⚡ x" + (st.boosts && st.boosts.turbo ? st.boosts.turbo.mult : 5);
    } else {
      elEnergyText.textContent = Math.floor(e) + " / " + st.max_energy;
    }
    const usable = (turboActive() || e >= 1) && !capReached();
    elCoin.classList.toggle("clicker-coin-disabled", !usable && !lockedActive());
  }

  function updateDaily() {
    if (!st) return;
    const cap = st.daily_cap || 0;
    const earned = st.earned_today || 0;
    elDailyText.textContent = fmt(earned) + " / " + fmt(cap);
    const pct = cap > 0 ? Math.min(100, (earned / cap) * 100) : 0;
    elDailyFill.style.width = pct.toFixed(1) + "%";
    elDailyFill.classList.toggle("full", capReached());
  }

  function updateLevel() {
    if (!st) return;
    elRank.textContent = st.rank || "Юнга";
    elLvl.textContent = "Ур. " + (st.level || 0);
    const span = Math.max(1, (st.level_next || 1) - (st.level_floor || 0));
    const prog = Math.max(0, Math.min(1, ((st.total_earned || 0) - (st.level_floor || 0)) / span));
    elLevelFill.style.width = (prog * 100).toFixed(1) + "%";
  }

  function updateCoinFx() {
    elCoin.classList.toggle("clicker-coin-turbo", turboActive());
  }

  function updateLockUI() {
    if (lockedActive()) {
      const left = Math.ceil((lockedUntil - now()) / 1000);
      elLock.hidden = false;
      elLockText.textContent = "Подозрительная активность.\nПауза " + left + " сек";
    } else {
      elLock.hidden = true;
    }
  }

  // ---------- Бусты ----------
  const BOOST_INFO = {
    turbo:   { name: "Турбо", icon: "🚀", desc: "x5 за тап, без энергии" },
    refill:  { name: "Заправка", icon: "🔋", desc: "полная энергия" },
    passive: { name: "Пассив x2", icon: "💰", desc: "×2 доход, 4 ч" },
  };

  function renderBoosts() {
    if (!st || !st.boosts) return;
    elBoosts.innerHTML = Object.keys(BOOST_INFO).map(key => {
      const info = BOOST_INFO[key];
      const b = st.boosts[key] || {};
      const active = (key === "turbo" && turboActive()) || (key === "passive" && passiveActive());
      const left = b.uses_left != null ? b.uses_left : 0;
      const disabled = left <= 0 || active;
      let badge;
      if (active) {
        badge = `<span class="clicker-boost-timer" data-timer="${key}">…</span>`;
      } else {
        badge = `<span class="clicker-boost-left">${left}/${b.daily || 0}</span>`;
      }
      return `
        <button class="clicker-boost ${active ? "active" : ""} ${disabled ? "disabled" : ""}" data-boost="${key}" ${disabled ? "disabled" : ""}>
          <span class="clicker-boost-icon">${info.icon}</span>
          <span class="clicker-boost-name">${info.name}</span>
          <span class="clicker-boost-desc">${info.desc}</span>
          ${badge}
        </button>
      `;
    }).join("");

    elBoosts.querySelectorAll(".clicker-boost:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => activateBoost(btn.dataset.boost));
    });
  }

  function updateBoostTimers() {
    elBoosts.querySelectorAll("[data-timer]").forEach(el => {
      const key = el.dataset.timer;
      const end = key === "turbo" ? turboUntil : passiveUntil;
      const left = Math.max(0, Math.ceil((end - now()) / 1000));
      el.textContent = left + "с";
      if (left <= 0) renderBoosts();
    });
  }

  async function activateBoost(key) {
    if (!st) return;
    try {
      const resp = await post("/api/arcade/clicker/boost", { boost: key });
      applyState(resp);
      playUISound("cashout");
      try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
        }
      } catch (_) {}
      if (key === "refill") {
        const cx = (elCoinWrap.offsetWidth || 200) / 2;
        showFloat("Энергия полная!", cx, 30, false);
      }
    } catch (e) {
      const msg = String((e && e.message) || e || "");
      window.kov && window.kov.toast ? window.kov.toast(msg || "Не удалось") : null;
    }
  }

  function powText(p) {
    const n = Number(p || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  const UPGRADE_INFO = {
    click:   { name: "Сила клика", icon: "⚔️", desc: "+0.2 ковкойна за тап" },
    passive: { name: "Пассивный доход", icon: "💰", desc: "+0.3 ковкойна/мин" },
    energy:  { name: "Макс. энергия", icon: "🔋", desc: "+75 к максимуму" },
    crit:    { name: "Крит шанс", icon: "🎯", desc: "+1% крит (x4)" },
    regen:   { name: "Реген энергии", icon: "⚡", desc: "+0.2/сек реген" },
  };

  function renderUpgrades() {
    if (!st) return;
    const bal = st.kovcoins != null ? st.kovcoins : (st.balance || 0);
    elUpgrades.innerHTML = Object.keys(UPGRADE_INFO).map(key => {
      const info = UPGRADE_INFO[key];
      const lvl = st.levels[key];
      const cost = st.upgrade_costs[key];
      const maxed = lvl >= st.max_level;
      const canAfford = bal >= cost;
      return `
        <div class="clicker-upgrade ${maxed ? "maxed" : ""} ${!canAfford && !maxed ? "disabled" : ""}" data-upgrade="${key}">
          <div class="clicker-upgrade-icon">${info.icon}</div>
          <div class="clicker-upgrade-info">
            <div class="clicker-upgrade-name">${info.name}</div>
            <div class="clicker-upgrade-desc">${info.desc}</div>
            <div class="clicker-upgrade-lvl">Ур. ${lvl}${maxed ? " (МАКС)" : ""}</div>
          </div>
          <div class="clicker-upgrade-buy">
            ${maxed
              ? '<span class="clicker-max">МАКС</span>'
              : `<span class="clicker-cost"><img src="${COIN}" class="game-icon-sm"/> ${fmt(cost)}</span><button class="btn btn-sm ${canAfford ? "" : "btn-disabled"}">Купить</button>`}
          </div>
        </div>
      `;
    }).join("");

    elUpgrades.querySelectorAll(".clicker-upgrade:not(.maxed)").forEach(card => {
      card.addEventListener("click", async () => {
        if (card.classList.contains("disabled")) return;
        const key = card.dataset.upgrade;
        try {
          const resp = await post("/api/arcade/clicker/upgrade", { upgrade: key });
          st.kovcoins = resp.kovcoins;
          st.balance = resp.kovcoins;
          st.levels[key] = resp.new_level;
          st.upgrade_costs[key] = resp.next_cost;
          st.click_power = resp.click_power;
          st.max_energy = resp.max_energy;
          st.passive_per_min = resp.passive_per_min;
          st.crit_chance = resp.crit_chance;
          st.regen_per_sec = resp.regen_per_sec;
          st.daily_cap = resp.daily_cap;
          st.earned_today = resp.earned_today;
          st.cap_reached = (resp.earned_today || 0) >= (resp.daily_cap || 0);
          elBalance.textContent = fmt(st.kovcoins);
          elPower.textContent = "+" + powText(st.click_power);
          elPassiveInfo.textContent = "💤 " + st.passive_per_min + "/мин" + (passiveActive() ? " ×2" : "");
          updateDaily();
          renderUpgrades();
          playUISound("cashout");
        } catch (e) {
          const errStr = String((e && e.message) || e || "");
          if (errStr.includes("Недостаточно")) {
            card.style.animation = "shake 0.3s";
            setTimeout(() => card.style.animation = "", 300);
          }
        }
      });
    });
  }

  function updateWallet() {
    if (!st) return;
    elWallet.textContent = fmt(st.wallet || 0);
    const kc = st.kovcoins != null ? st.kovcoins : (st.balance || 0);
    const min = st.cashout_min || 100;
    elCashoutBtn.disabled = kc < min;
    elCashoutBtn.textContent = kc < min
      ? `Нужно ≥ ${min} ковкойнов`
      : `Вывести ${fmt(Math.floor(kc / (st.cashout_rate || 100)))} ковбаксов`;
  }

  // Применить снимок состояния (state/boost/tap-ответы могут содержать разные поля)
  function applyState(s) {
    if (!s) return;
    st = Object.assign(st || {}, s);
    if (s.boosts) {
      turboUntil = s.boosts.turbo && s.boosts.turbo.active ? now() + s.boosts.turbo.left_sec * 1000 : 0;
      passiveUntil = s.boosts.passive && s.boosts.passive.active ? now() + s.boosts.passive.left_sec * 1000 : 0;
    }
    if (s.locked) lockedUntil = now() + (s.locked_left || 0) * 1000;
    else if (s.locked === false) lockedUntil = 0;
    if (s.energy != null) { lastSyncEnergy = s.energy; lastSyncTime = Date.now(); }
    const kc = st.kovcoins != null ? st.kovcoins : (st.balance || 0);
    elBalance.textContent = fmt(kc);
    elPower.textContent = "+" + powText(st.click_power || 1);
    elPassiveInfo.textContent = "💤 " + (st.passive_per_min || 0) + "/мин" + (passiveActive() ? " ×2" : "");
    updateEnergyBar();
    updateDaily();
    updateWallet();
    updateLevel();
    updateCoinFx();
    updateLockUI();
    renderBoosts();
    renderUpgrades();
  }

  async function cashout() {
    if (!st) return;
    const kc = st.kovcoins != null ? st.kovcoins : 0;
    if (kc < (st.cashout_min || 100)) return;
    try {
      const resp = await post("/api/arcade/clicker/cashout", {});
      applyState(resp);
      playUISound("cashout");
      if (resp.cashed_out > 0) {
        const cx = (elCoinWrap.offsetWidth || 200) / 2;
        showFloat("+" + resp.cashed_out + " ковбаксов", cx, 30, false);
      }
      try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
        }
      } catch (_) {}
      if (typeof fetchBalance === "function") { fetchBalance().catch(() => {}); }
    } catch (e) {
      const msg = String((e && e.message) || e || "");
      if (window.kov && window.kov.toast) window.kov.toast(msg || "Не удалось вывести");
    }
  }
  elCashoutBtn.addEventListener("click", cashout);

  async function loadState() {
    try {
      const s = await get("/api/arcade/clicker/state");
      applyState(s);
      if (s.passive_earned > 0) {
        const cx = (elCoinWrap.offsetWidth || 200) / 2;
        showFloat("+" + s.passive_earned + " пассив", cx, 20, false);
      }
    } catch (e) {
      modal.querySelector(".card-sub").textContent = "Ошибка загрузки: " + (e.message || "");
    }
  }

  async function flushTaps() {
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
    if (pendingTaps <= 0 || !st || destroyed) return;
    const batch = Math.min(pendingTaps, 200);
    pendingTaps -= batch;
    try {
      const resp = await post("/api/arcade/clicker/tap", { taps: batch });
      st.kovcoins = resp.kovcoins != null ? resp.kovcoins : resp.balance;
      st.balance = st.kovcoins;
      st.energy = resp.energy;
      st.max_energy = resp.max_energy;
      st.total_earned = resp.total_earned != null ? resp.total_earned : st.total_earned;
      st.daily_cap = resp.daily_cap != null ? resp.daily_cap : st.daily_cap;
      st.earned_today = resp.earned_today != null ? resp.earned_today : st.earned_today;
      st.cap_reached = !!resp.cap_reached;
      lastSyncEnergy = resp.energy;
      lastSyncTime = Date.now();
      if (resp.locked) {
        lockedUntil = now() + (resp.locked_left || 0) * 1000;
        updateLockUI();
      }
      if (resp.cap_reached) {
        const cx = (elCoinWrap.offsetWidth || 200) / 2;
        showFloat("Дневной лимит!", cx, 30, false);
      }
      elBalance.textContent = fmt(st.kovcoins);
      updateEnergyBar();
      updateDaily();
      updateWallet();
      updateLevel();
    } catch (_) {}
  }

  elCoin.addEventListener("click", (e) => {
    if (!st || destroyed) return;
    if (lockedActive() || capReached()) {
      elCoin.style.animation = "shake 0.2s";
      setTimeout(() => elCoin.style.animation = "", 200);
      return;
    }
    const turbo = turboActive();
    const currentEnergy = getCurrentEnergy();
    if (!turbo && currentEnergy < 1) {
      elCoin.style.animation = "shake 0.2s";
      setTimeout(() => elCoin.style.animation = "", 200);
      return;
    }
    if (!turbo) {
      lastSyncEnergy = currentEnergy - 1;
      lastSyncTime = Date.now();
    }

    // Visual feedback
    const wrapperRect = elFloats.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left;
    const y = e.clientY - wrapperRect.top - 20;
    const mult = turbo ? (st.boosts && st.boosts.turbo ? st.boosts.turbo.mult : 5) : 1;
    const isCrit = Math.random() < (st.crit_chance / 100);
    const earned = (isCrit ? st.click_power * 4 : st.click_power) * mult;
    showFloat((isCrit ? "КРИТ! +" : "+") + powText(earned), x, y, isCrit || turbo);

    elCoin.style.transform = "scale(0.93)";
    setTimeout(() => { if (!destroyed) elCoin.style.transform = ""; }, 100);
    playUISound("click");

    // Haptic feedback (Telegram WebApp)
    try {
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred(isCrit || turbo ? "medium" : "light");
      }
    } catch (_) {}

    // Batch taps — периодический сброс маленькими пачками (не копим в одну большую)
    pendingTaps++;
    if (pendingTaps >= 20) {
      flushTaps();
    } else if (!tapTimer) {
      tapTimer = setTimeout(flushTaps, 300);
    }
  });

  // Тики: энергия/таймеры бустов/блокировка
  energyTimer = setInterval(() => {
    if (destroyed) return;
    updateEnergyBar();
    updateCoinFx();
    updateBoostTimers();
    updateLockUI();
  }, 250);

  // Периодическая подсинхронизация с сервером (пассив, таймеры)
  pollTimer = setInterval(() => {
    if (destroyed || pendingTaps > 0) return;
    loadState();
  }, 15000);

  registerGameCleanup(() => {
    clearInterval(energyTimer);
    clearInterval(pollTimer);
    if (tapTimer) clearTimeout(tapTimer);
    // Flush remaining taps before destroying
    if (pendingTaps > 0) {
      const batch = pendingTaps;
      pendingTaps = 0;
      post("/api/arcade/clicker/tap", { taps: batch }).catch(() => {});
    }
    destroyed = true;
  });

  loadState();
}


// ============ RENDER ============

export async function renderArcade(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  try {
    await fetchBalance();
  } catch (_) {}

  // Кликер временно доступен только Омару (админу). Для остальных карточка видна,
  // но затемнена и не запускается (проверка дублируется на сервере).
  const canUseClicker = !!(window.kov && window.kov.me && window.kov.me.can_use_clicker);
  const clickerLocked = !canUseClicker;

  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Аркада</h1>
        <div class="subtitle">Игры и развлечения Ковчега</div>
      </div>
      <div class="hero-art" title="Аркада"><img src="/static/img/tabs/arcade.svg" alt="Аркада" class="hero-img"/></div>
    </section>

    <h2 class="section-title">Кликер</h2>
    <div class="game-grid">
      <div class="game-tile${clickerLocked ? ' game-tile-soon' : ''}" data-game="clicker" ${clickerLocked ? 'data-locked="1"' : ''} style="grid-column: 1 / -1">
        <div class="game-tile-icon"><img src="/static/img/ui/coin.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Кликер</div>
        ${clickerLocked ? '<div class="game-tile-soon-badge">Скоро</div>' : ''}
      </div>
    </div>

    <h2 class="section-title">Мини-игры</h2>
    
    <div class="game-grid">
      <div class="game-tile" data-game="moshonka">
        <div class="game-tile-icon"><img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Где Мошонка?</div>
      </div>
      <div class="game-tile" data-game="tictactoe">
        <div class="game-tile-icon"><img src="/static/img/ui/tictactoe.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Крестики-нолики</div>
      </div>
      <div class="game-tile" data-game="minesweeper">
        <div class="game-tile-icon"><img src="/static/img/ui/stone_block.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Сапёр</div>
      </div>
      <div class="game-tile" data-game="harvest">
        <div class="game-tile-icon"><img src="/static/img/ui/harvest.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Собери урожай</div>
      </div>
      <div class="game-tile" data-game="checkers">
        <div class="game-tile-icon"><img src="/static/img/ui/checkers.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Шашки</div>
      </div>
      <div class="game-tile" data-game="pingpong">
        <div class="game-tile-icon"><img src="/static/img/ui/pingpong.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Пинг-понг</div>
      </div>
    </div>

    <h2 class="section-title">Казино</h2>
    <div class="game-grid">
      <div class="game-tile casino" data-game="slots">
        <div class="game-tile-icon"><img src="/static/img/ui/slots.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Слоты</div>
      </div>
      <div class="game-tile casino" data-game="rocket">
        <div class="game-tile-icon"><img src="/static/img/ui/rocket.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Ракетка</div>
      </div>
      <div class="game-tile casino" data-game="dice">
        <div class="game-tile-icon"><img src="/static/img/ui/dice.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Кубик</div>
      </div>
      <div class="game-tile casino" data-game="roulette">
        <div class="game-tile-icon"><img src="/static/img/ui/roulette.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Рулетка</div>
      </div>
    </div>
  `;
  
  const games = {
    moshonka: gameWhereIsMoshonka,
    tictactoe: gameTicTacToe,
    minesweeper: gameMinesweeper,
    harvest: gameHarvest,
    checkers: gameCheckers,
    pingpong: gamePingPong,
    slots: gameSlots,
    rocket: gameRocket,
    dice: gameDice,
    roulette: gameRoulette,
    clicker: gameClicker,
  };
  
  root.querySelectorAll(".game-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const game = tile.dataset.game;
      if (tile.dataset.locked) {
        window.kov.toast("Скоро — игра пока недоступна");
        return;
      }
      if (MINI_GAMES.includes(game)) startFirstWinRound(game);
      if (games[game]) games[game]();
    });
  });

  window.kov.arcade = games;

  // Индикаторы награды за первую победу дня в мини-играх.
  loadFirstWinBadges(root);
}

// ============ НАГРАДА ЗА ПЕРВУЮ ПОБЕДУ (мини-игры) ============

const MINI_GAMES = ["moshonka", "tictactoe", "minesweeper", "harvest", "checkers", "pingpong"];
const _firstWinRounds = new Map();

function startFirstWinRound(game) {
  if (!MINI_GAMES.includes(game)) return;
  _firstWinRounds.set(game, post("/api/arcade/round/start", { game }).then(r => ({
    token: r.token,
    startedAt: performance.now(),
  })));
}

function _kovbaksWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "ковбаксов";
  if (last === 1) return "ковбакс";
  if (last >= 2 && last <= 4) return "ковбакса";
  return "ковбаксов";
}

// Начислить награду за первую победу дня в конкретной мини-игре.
// Сервер сам решает, положена ли награда (идемпотентно, не чаще 1 раза в сутки на игру).
async function awardFirstWin(game, result = {}) {
  try {
    const pending = _firstWinRounds.get(game);
    if (!pending) return;
    const round = await pending;
    const telemetry = {
      ...result,
      duration_ms: result.duration_ms ?? Math.max(0, Math.round(performance.now() - round.startedAt)),
    };
    const res = await post("/api/arcade/first-win", { game, round_token: round.token, ...telemetry });
    _firstWinRounds.delete(game);
    if (res && res.ok && res.reward) {
      window.kov.toast("🏆 +" + res.reward + " " + _kovbaksWord(res.reward) + " за первую победу!");
      balance = res.balance;
      const pb = document.querySelector(".wallet-balance-value strong");
      if (pb) pb.textContent = balance;
      if (window.kov.me) window.kov.me.balance = res.balance;
      if (window.kov.emit) window.kov.emit("balance:update", { balance: res.balance });
      // Обновим бейджи на карточках (если вкладка ещё открыта).
      const arcRoot = document.querySelector('.tab-content .game-grid');
      if (arcRoot) loadFirstWinBadges(arcRoot.closest('.tab-content') || document);
    }
  } catch (error) {
    console.warn("Не удалось подтвердить награду за первую победу", error);
    if (game === "pingpong") {
      window.kov.toast("Не удалось проверить награду за победу. Попробуй ещё раз позже.");
    }
  }
}

function _msToNextMskMidnight() {
  // МСК = UTC+3, без перехода на летнее время.
  const dayMs = 24 * 3600 * 1000;
  const mskMs = Date.now() + 3 * 3600 * 1000;
  return dayMs - (mskMs % dayMs);
}

function _fmtFwTimer(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return "через " + h + "ч " + m + "м";
  const sec = s % 60;
  if (m > 0) return "через " + m + "м";
  return "через " + sec + "с";
}

let _fwTimer = null;
let _fwResetAt = 0;
let _fwResetRefreshPromise = null;

function _updateFwTimers(scope) {
  const badges = (scope || document).querySelectorAll(".fw-badge.claimed");
  const ms = _fwResetAt ? Math.max(0, _fwResetAt - Date.now()) : _msToNextMskMidnight();
  badges.forEach((b) => { b.textContent = _fmtFwTimer(ms); });
}

function _refreshFirstWinAtReset(root) {
  if (_fwResetRefreshPromise) return _fwResetRefreshPromise;
  _fwResetRefreshPromise = loadFirstWinBadges(root, true)
    .then((loaded) => {
      // A transient failure must not create a request on every one-second tick.
      if (!loaded) _fwResetAt = Date.now() + 5000;
      return loaded;
    })
    .finally(() => { _fwResetRefreshPromise = null; });
  return _fwResetRefreshPromise;
}

async function loadFirstWinBadges(root, force = false) {
  if (!root || !root.querySelector) return;
  let status;
  try {
    status = await get("/api/arcade/first-win-status", force ? { force: true } : {});
  } catch (_) { return false; }
  const won = new Set(status.won_games || []);
  // Server returns whole seconds (floored). The small margin guarantees that
  // the one forced refresh happens after, not just before, Moscow midnight.
  _fwResetAt = Date.now() + Math.max(0, Number(status.next_reset_seconds || 0)) * 1000 + 1250;
  const reward = status.reward || 3;
  MINI_GAMES.forEach((g) => {
    const tile = root.querySelector('.game-tile[data-game="' + g + '"]');
    if (!tile) return;
    let badge = tile.querySelector(".fw-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "fw-badge";
      tile.appendChild(badge);
    }
    if (won.has(g)) {
      badge.classList.add("claimed");
      badge.title = "Награда получена сегодня";
    } else {
      badge.classList.remove("claimed");
      badge.title = "Победи, чтобы получить награду";
      badge.textContent = "+" + reward + " " + _kovbaksWord(reward);
    }
  });
  _updateFwTimers(root);
  if (_fwTimer) clearInterval(_fwTimer);
  _fwTimer = setInterval(() => {
    if (!document.body.contains(root)) { clearInterval(_fwTimer); _fwTimer = null; return; }
    if (_fwResetAt && Date.now() >= _fwResetAt) {
      _refreshFirstWinAtReset(root);
      return;
    }
    _updateFwTimers(root);
  }, 1000);
  if (window.kov && window.kov.onTabChange) {
    window.kov.onTabChange("arcade", () => { if (_fwTimer) { clearInterval(_fwTimer); _fwTimer = null; } });
  }
  return true;
}
