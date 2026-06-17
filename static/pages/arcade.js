import { post, get } from "/static/api.js?v=219";

import { playUISound } from "/static/pages/settings.js?v=219";
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
// Флаг "идёт раунд казино" — пока true, модалку нельзя закрывать/сворачивать.
let _casinoRoundLocked = false;

function registerGameCleanup(fn) {
  // Если предыдущая игра не была очищена (закрыли иным путём) — чистим её сейчас.
  if (_activeGameCleanup) {
    try { _activeGameCleanup(); } catch (_) {}
  }
  _activeGameCleanup = fn;
  _casinoRoundLocked = false;
}

function runGameCleanup() {
  if (_activeGameCleanup) {
    const fn = _activeGameCleanup;
    _activeGameCleanup = null;
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

// Однократно патчим глобальный closeModal: блокируем закрытие во время раунда
// казино и прогоняем очистку активной игры при штатном закрытии.
if (!window.__arcadeClosePatched) {
  window.__arcadeClosePatched = true;
  const _origCloseModal = window.closeModal;
  window.closeModal = function () {
    if (_casinoRoundLocked) return; // нельзя закрывать посреди раунда
    runGameCleanup();
    if (typeof _origCloseModal === "function") _origCloseModal();
    else document.getElementById("modal-root").innerHTML = "";
  };
  // При сворачивании вкладки / потере видимости — глушим циклы и звуки игры.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) runGameCleanup();
  });
}

// ============ МИНИ-ИГРЫ ============

function gameWhereIsMoshonka(container) {
  const isInline = !!container;
  const CUP_STEP = 72;
  // Уровни сложности: число стаканов, длительность одной перестановки, число перестановок.
  const LEVELS = {
    // Длительности ускорены ~в 1.7-1.8 раза от прежних, относительная разница уровней сохранена.
    easy:   { label: "Лёгкий",  cups: 3, dur: 400, swaps: 5, pause: 150 },
    medium: { label: "Средний", cups: () => 3 + Math.floor(Math.random() * 2), dur: 290, swaps: 5, pause: 115 },
    hard:   { label: "Сложный", cups: () => 4 + Math.floor(Math.random() * 2), dur: 200, swaps: 7, pause: 80 },
  };
  let level = null;       // выбранный объект уровня
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
    <div id="moshonka-level" style="text-align:center;margin-bottom:10px">
      <div style="font-size:13px;color:var(--text-soft);margin-bottom:8px">Выбери сложность:</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn" data-level="easy">Лёгкий</button>
        <button class="btn" data-level="medium">Средний</button>
        <button class="btn" data-level="hard">Сложный</button>
      </div>
    </div>
    <div id="moshonka-game" style="display:none">
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

  const levelPicker = root.querySelector("#moshonka-level");
  const gameArea = root.querySelector("#moshonka-game");
  levelPicker.querySelectorAll("button[data-level]").forEach(btn => {
    btn.addEventListener("click", () => {
      level = LEVELS[btn.dataset.level];
      levelPicker.style.display = "none";
      gameArea.style.display = "";
      startRound();
    });
  });
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
    <div class="game-mine-board" id="mine-board" style="width:300px;max-width:300px;margin:20px auto">
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
    try {
      await post("/api/arcade/bet", { amount: bet });
    } catch (_) {
      resultEl.innerHTML = `<div class="game-lose">Ошибка ставки, попробуйте ещё</div>`;
      spinBtn.disabled = false;
      return;
    }

    // Раунд пошёл — блокируем закрытие модалки до его завершения.
    setCasinoRoundLocked(true);

    balance -= bet;
    updateBalanceDisplay("roulette-balance", balance);

    const totalWeight = sectors.reduce((s, sec) => s + sec.weight, 0);
    let rand = Math.random() * totalWeight;
    let chosen = sectors[0];
    for (const sec of sectors) {
      rand -= sec.weight;
      if (rand <= 0) { chosen = sec; break; }
    }

    const mult = chosen.mult;
    const win = Math.floor(bet * mult);
    const chosenIdx = sectors.indexOf(chosen);

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

        if (mult > 1) {
          balance += win;
          updateBalanceDisplay("roulette-balance", balance);
          resultEl.innerHTML = `<div class="game-win">${chosen.label}! Выигрыш: ${win} K</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
          playUISound("win");
          try { await post("/api/arcade/win", { amount: win }); } catch (_) { await syncBalance(); }
        } else if (mult === 1) {
          balance += bet;
          updateBalanceDisplay("roulette-balance", balance);
          resultEl.innerHTML = `<div class="game-neutral">x1. Ставка возвращена.</div>`;
          playUISound("cashout");
          try { await post("/api/arcade/win", { amount: bet }); } catch (_) { await syncBalance(); }
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
    <p class="card-sub">Играй против Мошонки!</p>
    <div class="game-result" id="checkers-result"></div>
    <div id="checkers-board" style="display:grid;grid-template-columns:repeat(8,36px);gap:1px;margin:10px auto;width:fit-content"></div>
    <div id="checkers-status" style="text-align:center;font-weight:700;margin-top:8px">Твой ход</div>
  `);
  const board = modal.querySelector("#checkers-board");
  const status = modal.querySelector("#checkers-status");
  const resultEl = modal.querySelector("#checkers-result");
  let state = [];
  let selected = null;
  let turn = "white";
  let destroyed = false;
  // Очистка: при закрытии модалки отменяем отложенный ход ИИ.
  registerGameCleanup(() => { destroyed = true; });

  function initBoard() {
    state = Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      if ((row + col) % 2 === 1) {
        if (row < 3) state[i] = { color: "black", king: false };
        else if (row > 4) state[i] = { color: "white", king: false };
      }
    }
  }

  function render() {
    board.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const cell = document.createElement("div");
      const row = Math.floor(i / 8), col = i % 8;
      cell.style.cssText = "width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;border-radius:4px;";
      cell.style.background = (row + col) % 2 === 0 ? "#f0d9b5" : "#b58863";
      if (selected === i) cell.style.outline = "2px solid #ffd700";
      const p = state[i];
      if (p) {
        cell.textContent = p.king ? "♛" : "●";
        cell.style.color = p.color === "white" ? "#fff" : "#333";
        cell.style.textShadow = p.color === "white" ? "0 1px 2px rgba(0,0,0,0.5)" : "0 1px 2px rgba(255,255,255,0.3)";
      }
      cell.addEventListener("click", () => handleClick(i));
      board.appendChild(cell);
    }
  }

  function getMoves(idx) {
    const p = state[idx];
    if (!p) return [];
    const row = Math.floor(idx / 8), col = idx % 8;
    const dirs = p.king ? [[-1,-1],[-1,1],[1,-1],[1,1]] : (p.color === "white" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]);
    const moves = [], jumps = [];
    for (const [dr, dc] of dirs) {
      const r1 = row + dr, c1 = col + dc;
      if (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8) {
        const ni = r1 * 8 + c1;
        if (!state[ni]) { moves.push(ni); }
        else if (state[ni].color !== p.color) {
          const r2 = r1 + dr, c2 = c1 + dc;
          if (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8) {
            const ni2 = r2 * 8 + c2;
            if (!state[ni2]) jumps.push({ to: ni2, cap: ni });
          }
        }
      }
    }
    return jumps.length > 0 ? jumps.map(j => j.to) : moves;
  }

  function handleClick(idx) {
    if (turn !== "white") return;
    const p = state[idx];
    if (selected !== null && selected !== idx) {
      const moves = getMoves(selected);
      if (moves.includes(idx)) {
        state[idx] = state[selected];
        state[selected] = null;
        const sr = Math.floor(selected / 8), sc = selected % 8;
        const dr = Math.floor(idx / 8), dc = idx % 8;
        if (Math.abs(dr - sr) === 2) {
          state[((sr + dr) / 2) * 8 + ((sc + dc) / 2)] = null;
        }
        if ((state[idx].color === "white" && Math.floor(idx / 8) === 0) || (state[idx].color === "black" && Math.floor(idx / 8) === 7)) {
          state[idx].king = true;
        }
        selected = null;
        turn = "black";
        render();
        checkWin();
        if (turn === "black") setTimeout(aiMove, 500);
        return;
      }
    }
    selected = (p && p.color === "white") ? idx : null;
    render();
  }

  // --- ИИ: минимакс с alpha-beta ---

  // Ходы для произвольного состояния (не привязано к глобальному state).
  function movesFor(st, idx) {
    const p = st[idx];
    if (!p) return { moves: [], jumps: [] };
    const row = Math.floor(idx / 8), col = idx % 8;
    const dirs = p.king ? [[-1,-1],[-1,1],[1,-1],[1,1]] : (p.color === "white" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]);
    const moves = [], jumps = [];
    for (const [dr, dc] of dirs) {
      const r1 = row + dr, c1 = col + dc;
      if (r1 < 0 || r1 >= 8 || c1 < 0 || c1 >= 8) continue;
      const ni = r1 * 8 + c1;
      if (!st[ni]) { moves.push({ from: idx, to: ni, cap: null }); }
      else if (st[ni].color !== p.color) {
        const r2 = r1 + dr, c2 = c1 + dc;
        if (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8) {
          const ni2 = r2 * 8 + c2;
          if (!st[ni2]) jumps.push({ from: idx, to: ni2, cap: ni });
        }
      }
    }
    return { moves, jumps };
  }

  // Все легальные ходы цвета. Если есть взятия — обязаны бить.
  function allMoves(st, color) {
    const all = [], allJumps = [];
    for (let i = 0; i < 64; i++) {
      if (st[i] && st[i].color === color) {
        const { moves, jumps } = movesFor(st, i);
        all.push(...moves);
        allJumps.push(...jumps);
      }
    }
    return allJumps.length ? allJumps : all;
  }

  // Применяет ход к копии состояния, возвращает новую копию.
  function applyMove(st, mv) {
    const ns = st.map(c => c ? { color: c.color, king: c.king } : null);
    ns[mv.to] = ns[mv.from];
    ns[mv.from] = null;
    if (mv.cap !== null) ns[mv.cap] = null;
    const tr = Math.floor(mv.to / 8);
    if (ns[mv.to].color === "white" && tr === 0) ns[mv.to].king = true;
    if (ns[mv.to].color === "black" && tr === 7) ns[mv.to].king = true;
    return ns;
  }

  // Эвристика с точки зрения чёрных (ИИ): больше — лучше для чёрных.
  function evaluate(st) {
    let sc = 0;
    for (let i = 0; i < 64; i++) {
      const p = st[i];
      if (!p) continue;
      const row = Math.floor(i / 8);
      let v = p.king ? 5 : 3;
      // Продвижение к дамке: чёрные идут вниз, белые — вверх.
      if (!p.king) v += p.color === "black" ? row * 0.12 : (7 - row) * 0.12;
      sc += p.color === "black" ? v : -v;
    }
    return sc;
  }

  function minimax(st, depth, alpha, beta, maximizing) {
    const color = maximizing ? "black" : "white";
    const moves = allMoves(st, color);
    if (depth === 0 || moves.length === 0) {
      let val = evaluate(st);
      if (moves.length === 0) val += maximizing ? -1000 : 1000; // нет ходов = проигрыш стороны
      return val;
    }
    if (maximizing) {
      let best = -Infinity;
      for (const mv of moves) {
        const v = minimax(applyMove(st, mv), depth - 1, alpha, beta, false);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const mv of moves) {
        const v = minimax(applyMove(st, mv), depth - 1, alpha, beta, true);
        if (v < best) best = v;
        if (best < beta) beta = best;
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  function aiMove() {
    if (destroyed) return;
    const moves = allMoves(state, "black");
    if (moves.length === 0) { turn = "white"; render(); checkWin(); return; }

    const DEPTH = 5;
    let bestMove = null, bestVal = -Infinity;
    for (const mv of moves) {
      const v = minimax(applyMove(state, mv), DEPTH - 1, -Infinity, Infinity, false);
      if (v > bestVal) { bestVal = v; bestMove = mv; }
    }
    const move = bestMove || moves[0];

    state[move.to] = state[move.from];
    state[move.from] = null;
    if (move.cap !== null) state[move.cap] = null;
    if (Math.floor(move.to / 8) === 7) state[move.to].king = true;
    turn = "white";
    render();
    checkWin();
  }

  function checkWin() {
    let w = 0, b = 0;
    for (let i = 0; i < 64; i++) {
      if (state[i]) { if (state[i].color === "white") w++; else b++; }
    }
    if (w === 0) { resultEl.innerHTML = '<div class="game-lose">Мошонка победил!</div>'; }
    else if (b === 0) { resultEl.innerHTML = '<div class="game-win">Ты победил!</div>'; post("/api/arcade/win", { amount: 50 }).catch(() => {}); balance += 50; syncBalance(); }
    status.textContent = turn === "white" ? "Твой ход" : "Ход Мошонки...";
  }

  initBoard();
  render();
}

function gamePingPong() {
  const W = 300, H = 400, PW = 60, PH = 10, BS = 8;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Пинг-понг</h2>
    <p class="card-sub">Игра до 5 очков</p>
    <canvas id="pp-canvas" width="${W}" height="${H}" style="background:#1a1a2e;border-radius:8px;display:block;margin:10px auto;touch-action:none"></canvas>
    <div id="pp-score" style="text-align:center;font-weight:700;font-size:18px">0 : 0</div>
    <div class="game-result" id="pp-result"></div>
  `);
  const canvas = modal.querySelector("#pp-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = modal.querySelector("#pp-score");
  const resultEl = modal.querySelector("#pp-result");
  let px = W / 2 - PW / 2, ai = W / 2 - PW / 2;
  let bx = W / 2, by = H - 30, bvx = 3, bvy = -3;
  let ps = 0, as = 0, running = true;

  // Очистка: при закрытии/сворачивании останавливаем rAF-цикл.
  registerGameCleanup(() => { running = false; });

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#6cb6fb";
    ctx.fillRect(px, H - 20, PW, PH);
    ctx.fillStyle = "#e55454";
    ctx.fillRect(ai, 10, PW, PH);
    ctx.fillStyle = "#ffd700";
    ctx.beginPath(); ctx.arc(bx, by, BS, 0, Math.PI * 2); ctx.fill();
  }

  function update() {
    if (!running) return;
    // Если canvas отсоединён от DOM (модалка закрыта) — прекращаем цикл.
    if (!canvas.isConnected) { running = false; return; }
    bx += bvx; by += bvy;
    if (bx < BS || bx > W - BS) bvx = -bvx;
    if (by < 10 + PH + BS && bx > ai && bx < ai + PW) { bvy = Math.abs(bvy); bvx += (bx - (ai + PW / 2)) * 0.1; }
    if (by > H - 20 - BS && bx > px && bx < px + PW) { bvy = -Math.abs(bvy); bvx += (bx - (px + PW / 2)) * 0.1; }
    if (by < 0) { ps++; scoreEl.textContent = ps + " : " + as; resetBall(); if (ps >= 5) { running = false; resultEl.innerHTML = '<div class="game-win">Ты победил! +30K</div>'; post("/api/arcade/win", { amount: 30 }).catch(() => {}); balance += 30; syncBalance(); return; } }
    if (by > H) { as++; scoreEl.textContent = ps + " : " + as; resetBall(); if (as >= 5) { running = false; resultEl.innerHTML = '<div class="game-lose">Мошонка победил</div>'; return; } }
    const target = bx - PW / 2;
    ai += (target - ai) * 0.06;
    draw();
    requestAnimationFrame(update);
  }

  function resetBall() { bx = W / 2; by = H / 2; bvx = (Math.random() > 0.5 ? 1 : -1) * 3; bvy = -3; }

  canvas.addEventListener("touchmove", e => { e.preventDefault(); px = e.touches[0].clientX - canvas.getBoundingClientRect().left - PW / 2; px = Math.max(0, Math.min(W - PW, px)); });
  canvas.addEventListener("mousemove", e => { px = e.offsetX - PW / 2; px = Math.max(0, Math.min(W - PW, px)); });

  // При закрытии модалки останавливаем rAF-цикл, иначе утечка rAF и запись в отсоединённый canvas.
  const closeBtn = modal.querySelector(".close");
  if (closeBtn) closeBtn.addEventListener("click", () => { running = false; });
  // Подстраховка: если canvas удалён из DOM (модалка закрыта иным способом), тоже останавливаемся.

  draw();
  update();
}

function gameSlots() {
  const symbols = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Слоты</h2>
    <p class="card-sub">3 одинаковых = x27</p>
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
    try {
      await post("/api/arcade/bet", { amount: bet });
    } catch (_) {
      resultEl.innerHTML = '<div class="game-lose">Ошибка ставки, попробуйте ещё</div>';
      spinBtn.disabled = false;
      return;
    }
    // Раунд пошёл — блокируем закрытие модалки до результата.
    setCasinoRoundLocked(true);
    balance -= bet;
    updateBalanceDisplay("slots-balance", balance);
    playUISound("spin");
    const r1 = symbols[Math.floor(Math.random() * symbols.length)];
    const r2 = symbols[Math.floor(Math.random() * symbols.length)];
    const r3 = symbols[Math.floor(Math.random() * symbols.length)];
    let spins = 0;
    si = setInterval(() => {
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
        // Целевой RTP ~95.9% (чуть выгоднее игроку): джекпот x29 при p=7/343,
        // пара x1 (возврат ставки) при p=126/343.
        if (r1 === r2 && r2 === r3) {
          const win = Math.floor(bet * 29);
          balance += win;
          updateBalanceDisplay("slots-balance", balance);
          post("/api/arcade/win", { amount: win }).catch(() => {});
          resultEl.innerHTML = '<div class="game-win">ДЖЕКПОТ! +' + win + ' K</div>';
          playUISound("win");
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
          const win = Math.floor(bet * 1);
          balance += win;
          updateBalanceDisplay("slots-balance", balance);
          post("/api/arcade/win", { amount: win }).catch(() => {});
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
  let mult = 1, running = false, crashed = false, bet = 0, timer;

  startBtn.addEventListener("click", async () => {
    if (running) return;
    bet = getBetValue("rocket-bet");
    if (balance < bet) { resultEl.innerHTML = '<div class="game-lose">Недостаточно K</div>'; return; }
    // Защита от двойного клика на время сетевого запроса.
    if (startBtn.disabled) return;
    startBtn.disabled = true;
    // Надёжное списание: ждём ответ /bet, при ошибке не запускаем.
    try {
      await post("/api/arcade/bet", { amount: bet });
    } catch (_) {
      resultEl.innerHTML = '<div class="game-lose">Ошибка ставки, попробуйте ещё</div>';
      startBtn.disabled = false;
      return;
    }
    startBtn.disabled = false;
    balance -= bet;
    updateBalanceDisplay("rocket-balance", balance);
    mult = 1; running = true; crashed = false;
    startBtn.style.display = "none"; cashBtn.style.display = "";
    multEl.style.color = "#6cb6fb";
    resultEl.innerHTML = "";

    timer = setInterval(() => {
      mult += 0.02 + Math.random() * 0.03;
      multEl.textContent = "x" + mult.toFixed(2);
      if (Math.random() < 0.017 * mult) { // выше шанс взрыва — ракета чуть невыгоднее
        clearInterval(timer); running = false; crashed = true;
        multEl.style.color = "#e55454";
        multEl.textContent = "💥 ВЗРЫВ";
        resultEl.innerHTML = '<div class="game-lose">Ракета взорвалась на x' + mult.toFixed(2) + '</div>';
        cashBtn.style.display = "none"; startBtn.style.display = "";
        playUISound("lose");
        syncBalance();
      }
    }, 100);
  });

  cashBtn.addEventListener("click", () => {
    if (!running) return;
    clearInterval(timer); running = false;
    const win = Math.floor(bet * mult);
    balance += win;
    updateBalanceDisplay("rocket-balance", balance);
    post("/api/arcade/win", { amount: win }).catch(() => {});
    multEl.style.color = "#6bd995";
    resultEl.innerHTML = '<div class="game-win">Забрал x' + mult.toFixed(2) + '! +' + win + ' K</div>';
    cashBtn.style.display = "none"; startBtn.style.display = "";
    playUISound("win");
    syncBalance();
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
      try {
        await post("/api/arcade/bet", { amount: bet });
      } catch (_) {
        resEl.innerHTML = '<div class="game-lose">Ошибка ставки, попробуйте ещё</div>';
        rolling = false;
        return;
      }
      balance -= bet;
      updateBalanceDisplay("dice-balance", balance);
      const roll = Math.floor(Math.random() * 6) + 1;
      let spins = 0;
      const si = setInterval(() => {
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
          if (win > 0) {
            balance += win;
            updateBalanceDisplay("dice-balance", balance);
            post("/api/arcade/win", { amount: win }).catch(() => {});
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

// ============ RENDER ============

export async function renderArcade(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  try {
    await fetchBalance();
  } catch (_) {}
  
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Аркада</h1>
        <div class="subtitle">Игры и развлечения Ковчега</div>
      </div>
      <div class="hero-art" title="Аркада"><img src="/static/img/tabs/arcade.svg" alt="Аркада" class="hero-img"/></div>
    </section>

    <h2 class="section-title">Мини-игры</h2>
    
    <div class="game-grid">
      <div class="game-tile" data-game="moshonka">
        <div class="game-tile-icon"><img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Где Мошонка?</div>
        <div class="game-tile-desc">Угадай, где спрятался житель</div>
      </div>
      <div class="game-tile" data-game="tictactoe">
        <div class="game-tile-icon"><img src="/static/img/ui/tictactoe.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Крестики-нолики</div>
        <div class="game-tile-desc">Играй против Мошонки</div>
      </div>
      <div class="game-tile" data-game="minesweeper">
        <div class="game-tile-icon"><img src="/static/img/ui/stone_block.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Сапёр</div>
        <div class="game-tile-desc">Найди безопасные клетки</div>
      </div>
      <div class="game-tile" data-game="harvest">
        <div class="game-tile-icon"><img src="/static/img/ui/harvest.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Собери урожай</div>
        <div class="game-tile-desc">Собирай тыквы за время</div>
      </div>
      <div class="game-tile" data-game="checkers">
        <div class="game-tile-icon"><img src="/static/img/ui/checkers.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Шашки</div>
        <div class="game-tile-desc">3 уровня сложности</div>
      </div>
      <div class="game-tile" data-game="pingpong">
        <div class="game-tile-icon"><img src="/static/img/ui/pingpong.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Пинг-понг</div>
        <div class="game-tile-desc">Игра до 5 очков</div>
      </div>
    </div>

    <h2 class="section-title">Казино</h2>
    <div class="game-grid">
      <div class="game-tile casino" data-game="slots">
        <div class="game-tile-icon"><img src="/static/img/ui/slots.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Слоты</div>
        <div class="game-tile-desc">3 одинаковых = x27</div>
      </div>
      <div class="game-tile casino" data-game="rocket">
        <div class="game-tile-icon"><img src="/static/img/ui/rocket.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Ракетка</div>
        <div class="game-tile-desc">Кэшаут до краха</div>
      </div>
      <div class="game-tile casino" data-game="dice">
        <div class="game-tile-icon"><img src="/static/img/ui/dice.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Кубик</div>
        <div class="game-tile-desc">Чёт/нечёт или число</div>
      </div>
      <div class="game-tile casino" data-game="roulette">
        <div class="game-tile-icon"><img src="/static/img/ui/roulette.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Рулетка</div>
        <div class="game-tile-desc">От x0 до x3</div>
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
  };
  
  root.querySelectorAll(".game-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const game = tile.dataset.game;
      if (games[game]) games[game]();
    });
  });
  
  window.kov.arcade = games;
}
