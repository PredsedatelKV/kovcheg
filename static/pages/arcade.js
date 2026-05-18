import { post, get } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

function updateBalanceDisplay(id, amount) {
  const el = document.getElementById(id);
  if (el) el.textContent = amount;
}

function animateElement(el, animation, duration) {
  el.style.animation = `${animation} ${duration}ms ease-out forwards`;
}

// ============ МИНИ-ИГРЫ ============

function gameWhereIsMoshonka() {
  let found = false;
  const moshonkaPos = Math.floor(Math.random() * 3);
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Где Мошонка?</h2>
    <p class="card-sub">Мошонка спрятался за одним из кустов. Угадай где! Приз: 3-8 K</p>
    <div class="game-bushes">
      <button class="game-bush" data-bush="0"><img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/></button>
      <button class="game-bush" data-bush="1"><img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/></button>
      <button class="game-bush" data-bush="2"><img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/></button>
    </div>
    <div class="game-result" id="moshonka-result"></div>
  `);

  modal.querySelectorAll(".game-bush").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (found) return;
      const chosen = Number(btn.dataset.bush);
      const result = modal.querySelector("#moshonka-result");
      
      modal.querySelectorAll(".game-bush").forEach((b, i) => {
        b.disabled = true;
        b.classList.add("revealed");
        if (i === moshonkaPos) {
          b.innerHTML = '<img src="/static/img/ui/villager.svg" alt="" class="game-icon-lg"/>';
          b.classList.add("found");
        } else {
          b.innerHTML = '<img src="/static/img/ui/cross.svg" alt="" class="game-icon-lg"/>';
          b.classList.add("missed");
        }
      });
      
      found = true;
      if (chosen === moshonkaPos) {
        const reward = 3 + Math.floor(Math.random() * 6);
        try {
          await post("/api/arcade/win", { amount: reward });
          balance += reward;
          result.innerHTML = `<div class="game-win">Угадал! Мошонка доволен. +${reward} K</div>`;
          animateElement(result.querySelector(".game-win"), "popIn", 400);
        } catch (_) {
          result.innerHTML = `<div class="game-win">Угадал! (Демо) +${reward} K</div>`;
        }
      } else {
        result.innerHTML = `<div class="game-lose">Мимо! Мошонка был за кустом ${moshonkaPos + 1}</div>`;
      }
    });
  });
}

// КРЕСТИКИ-НОЛИКИ против Мошонки
function gameTicTacToe() {
  let board = Array(9).fill(null);
  let gameActive = true;
  let playerTurn = true;
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Крестики-нолики</h2>
    <p class="card-sub">Играй против Мошонки! Победа = 10 K</p>
    <div class="game-ttt-board" id="ttt-board">
      ${Array(9).fill("").map((_, i) => `<button class="ttt-cell" data-idx="${i}"></button>`).join("")}
    </div>
    <div class="game-result" id="ttt-result"></div>
  `);

  const cells = modal.querySelectorAll(".ttt-cell");
  const resultEl = modal.querySelector("#ttt-result");

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
    
    // Мошонка иногда ошибается — 40% шанс сделать случайный ход
    if (Math.random() < 0.4) {
      return empty[Math.floor(Math.random() * empty.length)];
    }
    
    // Try to win
    for (const idx of empty) {
      board[idx] = "O";
      if (checkWinner(board) === "O") { board[idx] = null; return idx; }
      board[idx] = null;
    }
    // Block player — тоже не всегда
    if (Math.random() < 0.5) {
      for (const idx of empty) {
        board[idx] = "X";
        if (checkWinner(board) === "X") { board[idx] = null; return idx; }
        board[idx] = null;
      }
    }
    // Center
    if (board[4] === null) return 4;
    // Random
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

  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const idx = Number(cell.dataset.idx);
      if (!gameActive || !playerTurn || board[idx]) return;
      
      board[idx] = "X";
      playerTurn = false;
      renderBoard();
      animateElement(cell, "popIn", 300);
      
      const winner = checkWinner(board);
      if (winner) {
        gameActive = false;
        if (winner === "X") {
          try { post("/api/arcade/win", { amount: 10 }).catch(() => {}); } catch (_) {}
          balance += 10;
          resultEl.innerHTML = `<div class="game-win">Победа! +10 K</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
        } else if (winner === "draw") {
          resultEl.innerHTML = `<div class="game-neutral">Ничья!</div>`;
        } else {
          resultEl.innerHTML = `<div class="game-lose">Мошонка победил!</div>`;
        }
        return;
      }
      
      setTimeout(() => {
        const move = moshonkaMove();
        if (move !== undefined) {
          board[move] = "O";
          renderBoard();
          animateElement(cells[move], "popIn", 300);
          
          const w2 = checkWinner(board);
          if (w2) {
            gameActive = false;
            if (w2 === "O") {
              resultEl.innerHTML = `<div class="game-lose">Мошонка победил!</div>`;
            } else {
              resultEl.innerHTML = `<div class="game-neutral">Ничья!</div>`;
            }
          }
        }
        playerTurn = true;
      }, 500);
    });
  });
}

// САПЁР против Мошонки
function gameMinesweeper() {
  const size = 16;
  const mineCount = 5;
  let board = Array(size).fill(0);
  let revealed = Array(size).fill(false);
  let flagged = Array(size).fill(false);
  let gameActive = true;
  let minesPlaced = false;
  
  function placeMines(excludeIdx) {
    let placed = 0;
    while (placed < mineCount) {
      const idx = Math.floor(Math.random() * size);
      if (idx !== excludeIdx && board[idx] !== -1) {
        board[idx] = -1;
        placed++;
      }
    }
    // Calculate numbers
    for (let i = 0; i < size; i++) {
      if (board[i] === -1) continue;
      let count = 0;
      const row = Math.floor(i / 4), col = i % 4;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr, nc = col + dc;
          if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
            const ni = nr * 4 + nc;
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
    <p class="card-sub">Найди все безопасные клетки! 5 мин среди ${size}. Приз: 15 K</p>
    <div class="game-mine-board" id="mine-board">
      ${Array(size).fill("").map((_, i) => `<button class="mine-cell" data-idx="${i}"><img src="/static/img/ui/stone_block.svg" alt="" class="mine-icon"/></button>`).join("")}
    </div>
    <div class="game-result" id="mine-result"></div>
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
      cell.innerHTML = '<img src="/static/img/ui/mine.svg" alt="💣" class="mine-icon"/>';
      cell.classList.add("mine-hit");
      // Reveal all mines
      board.forEach((v, i) => {
        if (v === -1 && i !== idx) {
          cells[i].innerHTML = '<img src="/static/img/ui/mine.svg" alt="💣" class="mine-icon"/>';
          cells[i].classList.add("revealed", "mine-show");
        }
      });
      resultEl.innerHTML = `<div class="game-lose">Бум! Мошонка поставил мину.</div>`;
      return;
    }
    
    if (board[idx] > 0) {
      cell.innerHTML = `<span class="mine-num mine-num-${board[idx]}">${board[idx]}</span>`;
    } else {
      cell.innerHTML = "";
      // Reveal neighbors
      const row = Math.floor(idx / 4), col = idx % 4;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr, nc = col + dc;
          if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
            const ni = nr * 4 + nc;
            if (!revealed[ni]) revealCell(ni);
          }
        }
      }
    }
    
    // Check win
    const safeCount = board.filter(v => v !== -1).length;
    const revealedCount = revealed.filter(v => v).length;
    if (revealedCount === safeCount) {
      gameActive = false;
      try { post("/api/arcade/win", { amount: 15 }).catch(() => {}); } catch (_) {}
      balance += 15;
      resultEl.innerHTML = `<div class="game-win">Все безопасные клетки найдены! +15 K</div>`;
      animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
    }
  }

  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const idx = Number(cell.dataset.idx);
      revealCell(idx);
    });
    
    // Long press to flag
    let pressTimer;
    cell.addEventListener("touchstart", (e) => {
      pressTimer = setTimeout(() => {
        if (revealed[idx] || !gameActive) return;
        flagged[idx] = !flagged[idx];
        cell.classList.toggle("flagged", flagged[idx]);
        cell.innerHTML = flagged[idx] 
          ? '<img src="/static/img/ui/flag.svg" alt="🚩" class="mine-icon"/>'
          : '<img src="/static/img/ui/stone_block.svg" alt="" class="mine-icon"/>';
      }, 500);
    });
    cell.addEventListener("touchend", () => clearTimeout(pressTimer));
    cell.addEventListener("touchmove", () => clearTimeout(pressTimer));
  });
}

function gameHarvest() {
  let score = 0;
  let timeLeft = 20;
  let gameInterval;
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal(); clearInterval(gameInterval)">×</button>
    <h2>Собери урожай!</h2>
    <p class="card-sub">Кликай по тыквам! Приз: 1 K за каждую</p>
    <div class="game-stats">
      <span><img src="/static/img/ui/pumpkin.svg" alt="" class="game-icon-sm"/> <span id="harvest-count">0</span></span>
      <span>⏱️ <span id="harvest-time">${timeLeft}</span>с</span>
    </div>
    <div class="game-field" id="harvest-field"></div>
    <div class="game-result" id="harvest-result"></div>
  `);

  const field = modal.querySelector("#harvest-field");
  const countEl = modal.querySelector("#harvest-count");
  const timeEl = modal.querySelector("#harvest-time");

  function spawnPumpkin() {
    if (timeLeft <= 0) return;
    const pumpkin = document.createElement("button");
    pumpkin.className = "game-pumpkin";
    pumpkin.innerHTML = '<img src="/static/img/ui/pumpkin.svg" alt="" class="game-icon"/>';
    pumpkin.style.left = Math.random() * 85 + "%";
    pumpkin.style.top = Math.random() * 80 + "%";
    pumpkin.addEventListener("click", () => {
      score++;
      countEl.textContent = score;
      animateElement(pumpkin, "popIn", 200);
      setTimeout(() => pumpkin.remove(), 200);
    });
    field.appendChild(pumpkin);
    setTimeout(() => { if (pumpkin.parentNode) pumpkin.remove(); }, 1500);
  }

  const spawnInterval = setInterval(spawnPumpkin, 600);
  
  gameInterval = setInterval(() => {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      clearInterval(spawnInterval);
      const reward = score;
      try { post("/api/arcade/win", { amount: reward }).catch(() => {}); } catch (_) {}
      balance += reward;
      modal.querySelector("#harvest-result").innerHTML = 
        `<div class="game-win">Урожай собран! Тыкв: ${score}. Приз: ${reward} K</div>`;
    }
  }, 1000);
}

// ============ КАЗИНО ============

function gameSlots() {
  const symbols = [
    { icon: "coal", weight: 30 },
    { icon: "iron", weight: 25 },
    { icon: "gold", weight: 15 },
    { icon: "diamond", weight: 5 },
    { icon: "castle", weight: 3 },
    { icon: "pumpkin", weight: 22 },
  ];
  
  function pickSymbol() {
    const total = symbols.reduce((s, sym) => s + sym.weight, 0);
    let r = Math.random() * total;
    for (const sym of symbols) {
      r -= sym.weight;
      if (r <= 0) return sym;
    }
    return symbols[symbols.length - 1];
  }
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Слоты Ковчега</h2>
    <p class="card-sub">3 одинаковых = x8 ставки | 2 одинаковых = x2</p>
    <div class="game-balance">Баланс: <strong id="slot-balance">${balance}</strong> K</div>
    <div class="game-slots">
      <div class="slot-reel" id="s1"><img src="/static/img/ui/question.svg" alt="" class="game-icon"/></div>
      <div class="slot-reel" id="s2"><img src="/static/img/ui/question.svg" alt="" class="game-icon"/></div>
      <div class="slot-reel" id="s3"><img src="/static/img/ui/question.svg" alt="" class="game-icon"/></div>
    </div>
    <div class="game-bet-row">
      <button class="btn btn-sm bet-btn" data-bet="5">5 K</button>
      <button class="btn btn-sm bet-btn" data-bet="10">10 K</button>
      <button class="btn btn-sm bet-btn" data-bet="25">25 K</button>
    </div>
    <div class="game-result" id="slots-result"></div>
  `);

  function spin(bet) {
    if (balance < bet) {
      modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    post("/api/arcade/bet", { amount: bet }).then(() => {
      balance -= bet;
    }).catch(() => {
      modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Не удалось сделать ставку</div>`;
      return;
    });
    
    updateBalanceDisplay("slot-balance", balance);
    const reels = [modal.querySelector("#s1"), modal.querySelector("#s2"), modal.querySelector("#s3")];
    
    let spins = 0;
    const maxSpins = 15;
    const spinInterval = setInterval(() => {
      reels.forEach((r) => {
        const sym = pickSymbol();
        r.innerHTML = `<img src="/static/img/ui/${sym.icon}.svg" alt="" class="game-icon"/>`;
      });
      spins++;
      if (spins >= maxSpins) {
        clearInterval(spinInterval);
        const result = [pickSymbol(), pickSymbol(), pickSymbol()];
        reels.forEach((r, i) => {
          r.innerHTML = `<img src="/static/img/ui/${result[i].icon}.svg" alt="" class="game-icon"/>`;
          animateElement(r, "slotBounce", 300);
        });
        
        let win = 0;
        if (result[0].icon === result[1].icon && result[1].icon === result[2].icon) {
          win = bet * 8;
        } else if (result[0].icon === result[1].icon || result[1].icon === result[2].icon || result[0].icon === result[2].icon) {
          win = bet * 2;
        }
        
        if (win > 0) {
          post("/api/arcade/win", { amount: win }).catch(() => {});
          balance += win;
          updateBalanceDisplay("slot-balance", balance);
          modal.querySelector("#slots-result").innerHTML = `<div class="game-win">Выигрыш: ${win} K!</div>`;
          animateElement(modal.querySelector("#slots-result"), "popIn", 400);
        } else {
          modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Не повезло. Ставка сгорела.</div>`;
        }
      }
    }, 100);
  }

  modal.querySelectorAll(".bet-btn").forEach((btn) => {
    btn.addEventListener("click", () => spin(Number(btn.dataset.bet)));
  });
}

function gameRocket() {
  let multiplier = 1.0;
  let running = false;
  let crashed = false;
  let bet = 10;
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal(); crashed=true">×</button>
    <h2>Ракетка</h2>
    <p class="card-sub">Кэшаут до краха! Множитель растёт...</p>
    <div class="game-balance">Баланс: <strong id="rocket-balance">${balance}</strong> K</div>
    <div class="game-rocket-display">
      <div class="rocket-multiplier" id="rocket-mult">1.00x</div>
      <div class="rocket-visual"><img src="/static/img/ui/rocket.svg" alt="" class="game-icon-lg rocket-img"/></div>
    </div>
    <div class="game-bet-row">
      <button class="btn btn-sm bet-btn" data-bet="5">5 K</button>
      <button class="btn btn-sm bet-btn" data-bet="10">10 K</button>
      <button class="btn btn-sm bet-btn" data-bet="25">25 K</button>
    </div>
    <button class="btn" id="rocket-cashout" disabled>Кэшаут</button>
    <div class="game-result" id="rocket-result"></div>
  `);

  const multEl = modal.querySelector("#rocket-mult");
  const cashoutBtn = modal.querySelector("#rocket-cashout");
  const resultEl = modal.querySelector("#rocket-result");
  const rocketImg = modal.querySelector(".rocket-img");
  
  modal.querySelectorAll(".bet-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (running) return;
      bet = Number(btn.dataset.bet);
      if (balance < bet) {
        resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
        return;
      }
      
      running = true;
      crashed = false;
      multiplier = 1.0;
      cashoutBtn.disabled = false;
      resultEl.innerHTML = "";
      
      const crashPoint = 1.05 + Math.random() * 2.5;
      
      const interval = setInterval(() => {
        if (crashed) { clearInterval(interval); return; }
        multiplier += 0.02;
        multEl.textContent = multiplier.toFixed(2) + "x";
        if (rocketImg) rocketImg.style.transform = `translateY(${-multiplier * 3}px)`;
        
        if (multiplier >= crashPoint) {
          crashed = true;
          running = false;
          cashoutBtn.disabled = true;
          clearInterval(interval);
          multEl.textContent = "💥 " + multiplier.toFixed(2) + "x";
          multEl.style.color = "#E53935";
          resultEl.innerHTML = `<div class="game-lose">Крах на ${multiplier.toFixed(2)}x! Ставка сгорела.</div>`;
        }
      }, 80);
      
      cashoutBtn.onclick = async () => {
        if (!running || crashed) return;
        crashed = true;
        running = false;
        cashoutBtn.disabled = true;
        clearInterval(interval);
        const win = Math.floor(bet * multiplier);
        post("/api/arcade/win", { amount: win }).catch(() => {});
        balance += win;
        updateBalanceDisplay("rocket-balance", balance);
        resultEl.innerHTML = `<div class="game-win">Кэшаут на ${multiplier.toFixed(2)}x! +${win} K</div>`;
        animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
      };
    });
  });
}

function gameDice() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Кубик удачи</h2>
    <p class="card-sub">Угадай чёт/нечёт или конкретное число!</p>
    <div class="game-balance">Баланс: <strong id="dice-balance">${balance}</strong> K</div>
    <div class="game-dice-display" id="dice-display"><img src="/static/img/ui/dice.svg" alt="" class="game-icon-lg dice-img"/></div>
    <div class="game-bet-row">
      <button class="btn btn-sm" id="dice-even">Чёт (x1.8)</button>
      <button class="btn btn-sm" id="dice-odd">Нечёт (x1.8)</button>
    </div>
    <div class="game-bet-row">
      ${[1,2,3,4,5,6].map(n => `<button class="btn btn-sm dice-num" data-num="${n}">${n} (x5)</button>`).join("")}
    </div>
    <div class="game-bet-amount">
      <label>Ставка:</label>
      <input type="number" id="dice-bet" value="10" min="1" class="input input-sm"/>
    </div>
    <div class="game-result" id="dice-result"></div>
  `);

  const display = modal.querySelector("#dice-display");
  const resultEl = modal.querySelector("#dice-result");
  const diceImg = modal.querySelector(".dice-img");
  
  function roll(predicate, multiplier) {
    const actualBet = Number(modal.querySelector("#dice-bet").value);
    if (balance < actualBet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    post("/api/arcade/bet", { amount: actualBet }).then(() => {
      balance -= actualBet;
    }).catch(() => {
      resultEl.innerHTML = `<div class="game-lose">Не удалось сделать ставку</div>`;
      return;
    });
    
    updateBalanceDisplay("dice-balance", balance);
    let rolls = 0;
    const anim = setInterval(() => {
      if (diceImg) diceImg.style.transform = `rotate(${rolls * 36}deg)`;
      rolls++;
      if (rolls > 10) {
        clearInterval(anim);
        const final = Math.floor(Math.random() * 6) + 1;
        if (diceImg) diceImg.style.transform = "rotate(0deg)";
        
        if (predicate(final)) {
          const win = Math.floor(actualBet * multiplier);
          post("/api/arcade/win", { amount: win }).catch(() => {});
          balance += win;
          updateBalanceDisplay("dice-balance", balance);
          resultEl.innerHTML = `<div class="game-win">Выпало ${final}! Выигрыш: ${win} K</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
        } else {
          resultEl.innerHTML = `<div class="game-lose">Выпало ${final}. Ставка сгорела.</div>`;
        }
      }
    }, 100);
  }

  modal.querySelector("#dice-even").addEventListener("click", () => roll((n) => n % 2 === 0, 1.8));
  modal.querySelector("#dice-odd").addEventListener("click", () => roll((n) => n % 2 === 1, 1.8));
  modal.querySelectorAll(".dice-num").forEach((btn) => {
    btn.addEventListener("click", () => {
      const num = Number(btn.dataset.num);
      roll((n) => n === num, 5);
    });
  });
}

function gameWheelRisk() {
  const sectors = [
    { label: "x0", color: "#E55454", weight: 25 },
    { label: "x0.5", color: "#FF8A65", weight: 20 },
    { label: "x1", color: "#F2B33C", weight: 20 },
    { label: "x1.5", color: "#6BD995", weight: 15 },
    { label: "x2", color: "#6CB6FB", weight: 10 },
    { label: "x3", color: "#D387E5", weight: 7 },
    { label: "x5", color: "#F58E5D", weight: 3 },
  ];
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Колесо риска</h2>
    <p class="card-sub">Крути и умножай ставку!</p>
    <div class="game-balance">Баланс: <strong id="wheel-balance">${balance}</strong> K</div>
    <div class="game-wheel-risk" id="risk-wheel">
      ${sectors.map((s) => `<div class="risk-sector" style="background:${s.color}">${s.label}</div>`).join("")}
    </div>
    <div class="game-bet-row">
      <button class="btn btn-sm bet-btn" data-bet="5">5 K</button>
      <button class="btn btn-sm bet-btn" data-bet="10">10 K</button>
      <button class="btn btn-sm bet-btn" data-bet="25">25 K</button>
    </div>
    <div class="game-result" id="risk-result"></div>
  `);

  const wheel = modal.querySelector("#risk-wheel");
  const resultEl = modal.querySelector("#risk-result");
  
  modal.querySelectorAll(".bet-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bet = Number(btn.dataset.bet);
      if (balance < bet) {
        resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
        return;
      }
      
      post("/api/arcade/bet", { amount: bet }).then(() => {
        balance -= bet;
      }).catch(() => {
        resultEl.innerHTML = `<div class="game-lose">Не удалось сделать ставку</div>`;
        return;
      });
      
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
      
      // Roulette animation - light up sectors sequentially
      wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("active"));
      let currentIdx = 0;
      let spins = 0;
      const maxSpins = 20 + chosenIdx;
      
      const spinInterval = setInterval(() => {
        wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("highlight"));
        wheel.children[currentIdx].classList.add("highlight");
        currentIdx = (currentIdx + 1) % sectors.length;
        spins++;
        
        if (spins >= maxSpins) {
          clearInterval(spinInterval);
          wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("highlight"));
          wheel.children[chosenIdx].classList.add("active");
          animateElement(wheel.children[chosenIdx], "popIn", 300);
          
          if (mult > 1) {
            post("/api/arcade/win", { amount: win }).catch(() => {});
            balance += win;
            updateBalanceDisplay("wheel-balance", balance);
            resultEl.innerHTML = `<div class="game-win">${chosen.label}! Выигрыш: ${win} K</div>`;
            animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
          } else if (mult === 1) {
            post("/api/arcade/win", { amount: bet }).catch(() => {});
            balance += bet;
            updateBalanceDisplay("wheel-balance", balance);
            resultEl.innerHTML = `<div class="game-neutral">x1. Ставка возвращена.</div>`;
          } else {
            resultEl.innerHTML = `<div class="game-lose">${chosen.label}. Ставка потеряна.</div>`;
          }
        }
      }, 100);
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
    </section>

    <h2 class="section-title">Мини-игры</h2>
    <p class="card-sub" style="margin: -8px 0 12px 4px">Зарабатывай K, играя!</p>
    
    <div class="game-grid">
      <div class="game-tile" data-game="moshonka">
        <div class="game-tile-icon"><img src="/static/img/ui/villager.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Где Мошонка?</div>
        <div class="game-tile-desc">Угадай, где спрятался житель</div>
        <div class="game-tile-reward">3-8 K</div>
      </div>
      <div class="game-tile" data-game="tictactoe">
        <div class="game-tile-icon"><img src="/static/img/ui/tictactoe.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Крестики-нолики</div>
        <div class="game-tile-desc">Играй против Мошонки</div>
        <div class="game-tile-reward">10 K</div>
      </div>
      <div class="game-tile" data-game="minesweeper">
        <div class="game-tile-icon"><img src="/static/img/ui/mine.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Сапёр</div>
        <div class="game-tile-desc">Найди безопасные клетки</div>
        <div class="game-tile-reward">15 K</div>
      </div>
      <div class="game-tile" data-game="harvest">
        <div class="game-tile-icon"><img src="/static/img/ui/harvest.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Собери урожай</div>
        <div class="game-tile-desc">Собирай тыквы за время</div>
        <div class="game-tile-reward">1 K/тыква</div>
      </div>
    </div>

    <h2 class="section-title">Казино</h2>
    <p class="card-sub" style="margin: -8px 0 12px 4px">Испытай удачу! Баланс: <strong>${balance} K</strong></p>
    
    <div class="game-grid">
      <div class="game-tile casino" data-game="slots">
        <div class="game-tile-icon"><img src="/static/img/ui/slots.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Слоты Ковчега</div>
        <div class="game-tile-desc">3 одинаковых = x8</div>
        <div class="game-tile-reward">Ставь и крути</div>
      </div>
      <div class="game-tile casino" data-game="rocket">
        <div class="game-tile-icon"><img src="/static/img/ui/rocket.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Ракетка</div>
        <div class="game-tile-desc">Кэшаут до краха</div>
        <div class="game-tile-reward">До x3.5</div>
      </div>
      <div class="game-tile casino" data-game="dice">
        <div class="game-tile-icon"><img src="/static/img/ui/dice.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Кубик</div>
        <div class="game-tile-desc">Чёт/нечёт или число</div>
        <div class="game-tile-reward">x1.8 или x5</div>
      </div>
      <div class="game-tile casino" data-game="wheel">
        <div class="game-tile-icon"><img src="/static/img/ui/wheel.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Колесо риска</div>
        <div class="game-tile-desc">От x0 до x5</div>
        <div class="game-tile-reward">Крути колесо</div>
      </div>
    </div>
  `;
  
  const games = {
    moshonka: gameWhereIsMoshonka,
    tictactoe: gameTicTacToe,
    minesweeper: gameMinesweeper,
    harvest: gameHarvest,
    slots: gameSlots,
    rocket: gameRocket,
    dice: gameDice,
    wheel: gameWheelRisk,
  };
  
  root.querySelectorAll(".game-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const game = tile.dataset.game;
      if (games[game]) games[game]();
    });
  });
}
