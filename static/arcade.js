import { post, get } from "/static/api.js?v=39";

import { playUISound } from "/static/pages/settings.js?v=39";
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
  return Math.max(1, Math.floor(balance * 0.2 / 1) * 1);
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

// ============ МИНИ-ИГРЫ ============

function gameWhereIsMoshonka(container) {
  const isInline = !!container;
  const CUP_COUNT = 3;
  const CUP_STEP = 72;
  let round = 1;
  let score = 0;
  let villagerPhys, canClick, gameEnded;
  let root, result, scoreEl, cupContainer;
  let logicalOrder;

  function initRound() {
    logicalOrder = [0, 1, 2];
    villagerPhys = Math.floor(Math.random() * CUP_COUNT);
    canClick = false;
    gameEnded = false;
  }
  initRound();

  function animateSwap(i, j) {
    return new Promise(resolve => {
      const cups = cupContainer.querySelectorAll(".game-cup");
      const dx = (j - i) * CUP_STEP;
      cups[i].style.transition = "transform 0.3s ease";
      cups[j].style.transition = "transform 0.3s ease";
      cups[i].style.transform = `translateX(${dx}px)`;
      cups[j].style.transform = `translateX(${-dx}px)`;
      setTimeout(() => {
        cups[i].style.transition = "none";
        cups[j].style.transition = "none";
        cups[i].style.transform = "";
        cups[j].style.transform = "";
        [logicalOrder[i], logicalOrder[j]] = [logicalOrder[j], logicalOrder[i]];
        if (villagerPhys === i) villagerPhys = j;
        else if (villagerPhys === j) villagerPhys = i;
        resolve();
      }, 350);
    });
  }

  async function shuffleCups() {
    const numSwaps = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < numSwaps; s++) {
      let a = Math.floor(Math.random() * CUP_COUNT);
      let b = Math.floor(Math.random() * CUP_COUNT);
      if (a === b) { s--; continue; }
      await animateSwap(a, b);
    }
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

  function startRound() {
    initRound();
    cupContainer.querySelectorAll(".game-cup").forEach(c => {
      c.disabled = false;
      c.style.transition = "none";
      c.style.transform = "";
    });
    result.innerHTML = "";
    revealAll(true);
    setTimeout(() => {
      revealAll(false);
      shuffleCups();
    }, 1000);
  }

  const html = `
    <div style="text-align:center;margin-bottom:6px">
      <span style="font-size:13px;color:var(--text-soft)">Счёт: <span id="moshonka-score-val">0</span></span>
    </div>
    <div class="game-bushes" id="moshonka-cups">
      ${Array(CUP_COUNT).fill("").map((_, i) => `
        <button class="game-cup">
          <div class="cup-front">
            <img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/>
          </div>
          <div class="cup-back" style="display:none">
            <img src="/static/img/ui/villager.svg" alt="" class="game-icon-lg"/>
          </div>
        </button>
      `).join("")}
    </div>
    <div class="game-result" id="moshonka-result" style="font-size:13px;min-height:24px"></div>
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
      setTimeout(startRound, 2500);
    });
  });

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
    <div class="game-result" id="mine-result"></div>
    <div class="game-play-again" id="mine-again" style="display:none">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  const cells = modal.querySelectorAll(".mine-cell");
  const resultEl = modal.querySelector("#mine-result");

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
      modal.querySelector("#mine-again").style.display = "block";
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
      modal.querySelector("#mine-again").style.display = "block";
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
    setTimeout(() => {
      if (pumpkin.parentNode) {
        pumpkin.style.opacity = "0";
        pumpkin.style.transform = "scale(0.5)";
        setTimeout(() => pumpkin.remove(), 200);
      }
    }, 800);
  }

  spawnInterval = setInterval(spawnPumpkin, 400);
  
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
  const sectors = [
    { label: "x0.05", color: "#E55454", weight: 40 },
    { label: "x0.25", color: "#D32F2F", weight: 22 },
    { label: "x0.5", color: "#FF8A65", weight: 25 },
    { label: "x0.75", color: "#FFB74D", weight: 18 },
    { label: "x1", color: "#F2B33C", weight: 20 },
    { label: "x1.5", color: "#6BD995", weight: 6 },
    { label: "x2", color: "#6CB6FB", weight: 3 },
    { label: "x2.5", color: "#D387E5", weight: 2 },
    { label: "x3", color: "#AB47BC", weight: 1 },
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
  
  modal.querySelector("#roulette-spin-btn").addEventListener("click", () => {
    const bet = getBetValue("roulette-bet");
    if (balance < bet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    balance -= bet;
    updateBalanceDisplay("roulette-balance", balance);
    playUISound("bet");
    post("/api/arcade/bet", { amount: bet }).catch(() => {});
    const totalWeight = sectors.reduce((s, sec) => s + sec.weight, 0);
    let rand = Math.random() * totalWeight;
    let chosen = sectors[0];
    for (const sec of sectors) {
      rand -= sec.weight;
      if (rand <= 0) { chosen = sec; break; }
    }
    
    const mult = parseFloat(chosen.label.replace("x", ""));
    const win = Math.floor(bet * mult);
    const chosenIdx = sectors.indexOf(chosen);
    
    wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("active", "highlight"));
    let currentIdx = 0;
    let spins = 0;
    const maxSpins = 20 + chosenIdx;
    
    const spinInterval = setInterval(() => {
      wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("highlight"));
      wheel.children[currentIdx].classList.add("highlight");
      currentIdx = (currentIdx + 1) % sectors.length;
      spins++;
      if (spins % 2 === 0) playUISound("spin");
      
      if (spins >= maxSpins) {
        clearInterval(spinInterval);
        wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("highlight"));
        wheel.children[chosenIdx].classList.add("active");
        animateElement(wheel.children[chosenIdx], "popIn", 300);
        
        if (mult > 1) {
          post("/api/arcade/win", { amount: win }).catch(() => {});
          balance += win;
          updateBalanceDisplay("roulette-balance", balance);
          resultEl.innerHTML = `<div class="game-win">${chosen.label}! Выигрыш: ${win} K</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
          playUISound("win");
        } else if (mult === 1) {
          post("/api/arcade/win", { amount: bet }).catch(() => {});
          balance += bet;
          updateBalanceDisplay("roulette-balance", balance);
          resultEl.innerHTML = `<div class="game-neutral">x1. Ставка возвращена.</div>`;
          playUISound("cashout");
        } else {
          resultEl.innerHTML = `<div class="game-lose">${chosen.label}. Ставка потеряна.</div>`;
          playUISound("lose");
        }
        syncBalance();
      }
    }, 100);
  });
}

function gameCheckers() {
  window.kov.toast("Шашки пока недоступны");
}

function gamePingPong() {
  window.kov.toast("Пинг-понг пока недоступен");
}

function gameSlots() {
  window.kov.toast("Слоты пока недоступны");
}

function gameRocket() {
  window.kov.toast("Ракетка пока недоступна");
}

function gameDice() {
  window.kov.toast("Кубик пока недоступен");
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
        <div class="game-tile-desc">3 одинаковых = x8</div>
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
