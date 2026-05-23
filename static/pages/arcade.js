import { post, get } from "/static/api.js?v=30";

import { playUISound } from "/static/pages/settings.js?v=30";
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
  const CUP_COUNT = 5;
  let round = 1;
  let score = 0;
  let villagerIdx, canClick, gameEnded;
  
  function resetRound() {
    villagerIdx = Math.floor(Math.random() * CUP_COUNT);
    canClick = false;
    gameEnded = false;
  }
  resetRound();
  
  let root, result, scoreEl, cupContainer, againBtn;
  
  const html = `
    <h2 style="margin:0 0 4px">Где Мошонка?</h2>
    <p class="card-sub" style="margin:0 0 6px">Следи за кустом — Мошонка спрятался!</p>
    <div class="moshonka-score" style="text-align:center;font-size:14px;color:var(--text-soft);margin-bottom:8px">
      Счёт: <span id="moshonka-score-val">0</span> | Раунд: <span id="moshonka-round-val">1</span>
    </div>
    <div class="game-bushes" id="moshonka-cups">
      ${Array(CUP_COUNT).fill("").map((_, i) => `
        <button class="game-cup" data-idx="${i}">
          <div class="cup-front">
            <img src="/static/img/ui/bush.svg" alt="" class="game-icon-lg"/>
          </div>
          <div class="cup-back" style="display:none">
            <img src="/static/img/ui/villager.svg" alt="" class="game-icon-lg"/>
          </div>
        </button>
      `).join("")}
    </div>
    <div class="game-result" id="moshonka-result"></div>
    <div class="game-play-again" id="moshonka-again" style="display:none">
      <button class="btn" id="moshonka-play-again">Играть заново</button>
    </div>
  `;
  
  if (isInline) {
    root = container;
    root.innerHTML = html;
  } else {
    root = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      ${html}
    `);
  }
  
  result = root.querySelector("#moshonka-result");
  againBtn = root.querySelector("#moshonka-play-again");
  cupContainer = root.querySelector("#moshonka-cups");
  scoreEl = root.querySelector("#moshonka-score-val");
  
  const cups = cupContainer.querySelectorAll(".game-cup");
  
  function getCup(idx) {
    return cupContainer.querySelector(`.game-cup[data-idx="${idx}"]`);
  }
  
  function showMoshonka(show) {
    cups.forEach((cup, i) => {
      const front = cup.querySelector(".cup-front");
      const back = cup.querySelector(".cup-back");
      if (i === villagerIdx && show) {
        front.style.display = "none";
        back.style.display = "";
      } else {
        front.style.display = "";
        back.style.display = "none";
      }
    });
  }
  
  function shuffleAnimation() {
    resetRound();
    canClick = false;
    gameEnded = false;
    result.innerHTML = "";
    const againEl = root.querySelector("#moshonka-again");
    if (againEl) againEl.style.display = "none";
    const shuffleCount = 3 + round;
    
    showMoshonka(true);
    result.innerHTML = `<div class="game-neutral">Запоминай куст…</div>`;
    
    setTimeout(() => {
      showMoshonka(false);
      
      setTimeout(() => {
        let swaps = 0;
        const totalSwaps = shuffleCount * 2;
        
        function doSwap() {
          if (swaps >= totalSwaps) {
            canClick = true;
            result.innerHTML = `<div class="game-neutral">Где Мошонка? Жми на куст!</div>`;
            return;
          }
          
          const a = Math.floor(Math.random() * CUP_COUNT);
          let b = Math.floor(Math.random() * CUP_COUNT);
          while (b === a) b = Math.floor(Math.random() * CUP_COUNT);
          
          const cupA = getCup(a);
          const cupB = getCup(b);
          
          const rectA = cupA.getBoundingClientRect();
          const rectB = cupB.getBoundingClientRect();
          const dx = rectB.left - rectA.left;
          const dy = rectB.top - rectA.top;
          
          cupA.style.transition = "transform 0.15s ease-in-out";
          cupB.style.transition = "transform 0.15s ease-in-out";
          cupA.style.transform = `translate(${dx}px, ${dy}px)`;
          cupB.style.transform = `translate(${-dx}px, ${-dy}px)`;
          cupA.style.zIndex = "2";
          cupB.style.zIndex = "2";
          
          setTimeout(() => {
            cupA.style.transition = "none";
            cupB.style.transition = "none";
            cupA.style.transform = "";
            cupB.style.transform = "";
            cupA.style.zIndex = "";
            cupB.style.zIndex = "";
            
            cupA.dataset.idx = b;
            cupB.dataset.idx = a;
            
            if (villagerIdx === a) villagerIdx = b;
            else if (villagerIdx === b) villagerIdx = a;
            
            playUISound("spin");
            swaps++;
            setTimeout(doSwap, 80);
          }, 150);
        }
        
        doSwap();
      }, 600);
    }, 1200);
  }
  
  cups.forEach((cup) => {
    cup.addEventListener("click", () => {
      if (!canClick || gameEnded) return;
      gameEnded = true;
      canClick = false;
      
      const idx = Number(cup.dataset.idx);
      
      if (idx === villagerIdx) {
        result.innerHTML = `<div class="game-win">Угадал! Мошонка тут! 🎉</div>`;
        playUISound("win");
        score += 10 * round;
        round++;
        scoreEl.textContent = score;
        const roundEl = root.querySelector("#moshonka-round-val");
        if (roundEl) roundEl.textContent = round;
      } else {
        result.innerHTML = `<div class="game-lose">Мимо! Мошонка был под другим кустом</div>`;
        playUISound("lose");
        score = Math.max(0, score - 5);
        scoreEl.textContent = score;
      }
      
      showMoshonka(true);
      cups.forEach(c => c.disabled = true);
      
      const again = root.querySelector("#moshonka-again");
      again.style.display = "block";
    });
  });
  
  againBtn.addEventListener("click", () => {
    if (isInline) {
      root.innerHTML = html;
      gameWhereIsMoshonka(root);
    } else {
      closeModal();
      setTimeout(gameWhereIsMoshonka, 100);
    }
  });
  
  shuffleAnimation();
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
    <button class="close" onclick="closeModal(); clearInterval(gameInterval); clearInterval(spawnInterval)">×</button>
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

// ШАШКИ против Мошонки
function gameCheckers() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Шашки</h2>
    <p class="card-sub">Выбери сложность:</p>
    <div class="checkers-difficulty">
      <button class="btn btn-outline" data-diff="easy">Лёгкая</button>
      <button class="btn btn-outline" data-diff="medium">Средняя</button>
      <button class="btn btn-outline" data-diff="hard">Сложная</button>
    </div>
  `);

  modal.querySelectorAll("[data-diff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      setTimeout(() => startCheckersGame(btn.dataset.diff), 100);
    });
  });
}

function startCheckersGame(difficulty) {
  const boardSize = 8;
  let board = [];
  let selectedPiece = null;
  let playerTurn = true;
  let gameActive = true;
  let multiCapture = null;
  
  const diffSettings = {
    easy: { depth: 2, searchBranches: 6 },
    medium: { depth: 3, searchBranches: 8 },
    hard: { depth: 6, searchBranches: 14 },
  };
  const settings = diffSettings[difficulty];
  
  const positionalWeights = [
    [0, 5, 10, 15, 15, 10, 5, 0],
    [5, 10, 20, 25, 25, 20, 10, 5],
    [10, 20, 35, 45, 45, 35, 20, 10],
    [15, 25, 45, 60, 60, 45, 25, 15],
    [15, 25, 45, 60, 60, 45, 25, 15],
    [10, 20, 35, 45, 45, 35, 20, 10],
    [5, 10, 20, 25, 25, 20, 10, 5],
    [0, 5, 10, 15, 15, 10, 5, 0]
  ];
  
  const kingPosWeights = [
    [20, 15, 10, 5, 5, 10, 15, 20],
    [15, 10, 5, 2, 2, 5, 10, 15],
    [10, 5, 2, 0, 0, 2, 5, 10],
    [5, 2, 0, -2, -2, 0, 2, 5],
    [5, 2, 0, -2, -2, 0, 2, 5],
    [10, 5, 2, 0, 0, 2, 5, 10],
    [15, 10, 5, 2, 2, 5, 10, 15],
    [20, 15, 10, 5, 5, 10, 15, 20]
  ];
  
  const edgeBonus = [[0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,0]];
  
  const backRowBonus = [15, 8, 0, 0, 0, 0, 8, 15];
  const centerControl = [[0,2,4,5,5,4,2,0],[2,4,6,8,8,6,4,2],[4,6,8,10,10,8,6,4],[5,8,10,12,12,10,8,5],[5,8,10,12,12,10,8,5],[4,6,8,10,10,8,6,4],[2,4,6,8,8,6,4,2],[0,2,4,5,5,4,2,0]];
  
  function evaluateBoardState(b, isMaximizing) {
    let score = 0;
    let blackCount = 0, whiteCount = 0;
    let blackKingCount = 0, whiteKingCount = 0;
    let blackMobility = 0, whiteMobility = 0;
    let blackAdvancement = 0, whiteAdvancement = 0;
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = b[r][c];
        if (!piece) continue;
        
        const isKing = piece.includes("king");
        const isBlack = piece.startsWith("black");
        
        if (isBlack) {
          blackCount++;
          if (isKing) blackKingCount++;
          let material = isKing ? 250 : (200 + (7 - r) * 10);
          score += material;
          score += positionalWeights[r][c] * 0.5;
          score += edgeBonus[r][c] * 20;
          
          const caps = getCapturesForPiece(r, c, b);
          blackMobility += caps.length > 0 ? caps.length * 4 : 1;
          
          if (!isKing) blackAdvancement += (7 - r) * 2;
          
          if (isKing) {
            score += kingPosWeights[r][c] * 0.6;
            const safeMoves = countSafeKingMoves(r, c, b, true);
            score += safeMoves * 6;
          } else {
            if (c > 0 && c < 7 && r > 0 && r < 7) score += 12;
          }
          
          if (isExposedToCapture(r, c, b, true)) score -= 45;
          if (isInDangerZone(r, c, b, true)) score -= 30;
          
        } else {
          whiteCount++;
          if (isKing) whiteKingCount++;
          let material = isKing ? 250 : (200 + r * 10);
          score -= material;
          score -= positionalWeights[r][c] * 0.5;
          score -= edgeBonus[r][c] * 20;
          
          const caps = getCapturesForPiece(r, c, b);
          whiteMobility += caps.length > 0 ? caps.length * 4 : 1;
          
          if (!isKing) whiteAdvancement += r * 2;
          
          if (isKing) {
            score -= kingPosWeights[r][c] * 0.6;
            const safeMoves = countSafeKingMoves(r, c, b, false);
            score -= safeMoves * 6;
          } else {
            if (c > 0 && c < 7 && r > 0 && r < 7) score -= 12;
          }
          
          if (isExposedToCapture(r, c, b, false)) score += 45;
          if (isInDangerZone(r, c, b, false)) score += 30;
        }
      }
    }
    
    score += (blackMobility - whiteMobility) * 8;
    score += (blackAdvancement - whiteAdvancement) * 6;
    
    const blackThreats = countThreateningMoves(b, true);
    const whiteThreats = countThreateningMoves(b, false);
    score += blackThreats * 20;
    score -= whiteThreats * 20;
    
    if (blackCount === 1 && whiteCount >= 3) score -= 150;
    if (whiteCount === 1 && blackCount >= 3) score += 150;
    
    if (blackCount <= 3 && blackKingCount > 0) {
      const centerDist = getKingCenterProximity(b, true);
      score += centerDist * 15;
    }
    if (whiteCount <= 3 && whiteKingCount > 0) {
      const centerDist = getKingCenterProximity(b, false);
      score -= centerDist * 15;
    }
    
    return score;
  }
  
  function isExposedToCapture(r, c, board, isBlack) {
    const opponent = isBlack ? "white" : "black";
    const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
    
    for (const [dr, dc] of dirs) {
      const mr = r + dr, mc = c + dc;
      const jr = r + dr * 2, jc = c + dc * 2;
      if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8) {
        const mid = board[mr][mc];
        const jumpDest = board[jr][jc];
        if (mid && mid.startsWith(opponent) && !jumpDest) {
          if (!isKing(board[r][c])) {
            const forward = isBlack ? 1 : -1;
            if (dr === forward) return true;
          } else {
            return true;
          }
        }
      }
    }
    return false;
  }
  
  function isInDangerZone(r, c, board, isBlack) {
    if (isKing(board[r][c])) return false;
    const backRow = isBlack ? 0 : 7;
    if (r === backRow) return false;
    
    const frontDir = isBlack ? -1 : 1;
    for (const dc of [-1, 1]) {
      const trapR = r + frontDir;
      const trapC = c + dc;
      if (trapR >= 0 && trapR < 8 && trapC >= 0 && trapC < 8) {
        if (board[trapR][trapC] && board[trapR][trapC].startsWith(isBlack ? "white" : "black")) {
          const behindR = r + frontDir * 2;
          const behindC = c + dc * 2;
          if (behindR >= 0 && behindR < 8 && behindC >= 0 && behindC < 8 && !board[behindR][behindC]) {
            return true;
          }
        }
      }
    }
    return false;
  }
  
  function countSafeKingMoves(r, c, board, isBlack) {
    const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
    let safeMoves = 0;
    for (const [dr, dc] of dirs) {
      for (let step = 1; step < 8; step++) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
        if (board[nr][nc]) break;
        safeMoves++;
      }
    }
    return safeMoves;
  }
  
  function getKingCenterProximity(board, isBlack) {
    let minDist = 10;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.startsWith(isBlack ? "black" : "white") && piece.includes("king")) {
          const dist = Math.abs(r - 3.5) + Math.abs(c - 3.5);
          minDist = Math.min(minDist, dist);
        }
      }
    }
    return minDist;
  }
  
  function countThreateningMoves(board, isBlack) {
    let threats = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] && board[r][c].startsWith(isBlack ? "black" : "white")) {
          const caps = getCapturesForPiece(r, c, board);
          threats += caps.length;
        }
      }
    }
    return threats;
  }

  function countPieces(b) {
    let black = 0, white = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (b[r][c]) {
          if (b[r][c].startsWith("black")) black++;
          else white++;
        }
      }
    }
    return { black, white };
  }

  function minimax(b, depth, alpha, beta, isMaximizing) {
    if (depth === 0) {
      return evaluateBoardState(b, isMaximizing);
    }
    
    const player = isMaximizing ? "black" : "white";
    const allMoves = getAllMoves(player, b);
    
    if (allMoves.length === 0) {
      const pieces = countPiecesFunc(player, b);
      if (pieces === 0) return isMaximizing ? -100000 : 100000;
      return isMaximizing ? -5000 : 5000;
    }
    
    function countPiecesFunc(p, brd) {
      let c = 0;
      for (let r = 0; r < 8; r++)
        for (let col = 0; col < 8; col++)
          if (brd[r][col] && brd[r][col].startsWith(p)) c++;
      return c;
    }
    
    const captures = allMoves.filter(m => m.captures.length > 0);
    const movesToConsider = captures.length > 0 ? captures : allMoves;
    
    const sortedMoves = movesToConsider.map(m => {
      let priority = m.captures.length * 1000;
      const [tr, tc] = m.to;
      priority += positionalWeights[tr][tc];
      const piece = b[m.from[0]][m.from[1]];
      if (isKing(piece)) priority += 50;
      return { move: m, priority };
    }).sort((a, b) => b.priority - a.priority);
    
    const prunedMoves = sortedMoves.slice(0, Math.min(sortedMoves.length, settings.searchBranches));
    
    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const { move } of prunedMoves) {
        const tempB = b.map(row => [...row]);
        const piece = applyMoveToBoard({ ...move, from: move.from, to: move.to }, tempB);
        
        let evalScore;
        const [tr, tc] = move.to;
        if (move.captures.length > 0) {
          const contCaps = getContinuationCapturesOnBoard(tr, tc, tempB, piece);
          if (contCaps.length > 0 && depth > 1) {
            let bestCont = -Infinity;
            for (const cont of contCaps) {
              if (bestCont === -Infinity) {
                const tempB2 = tempB.map(row => [...row]);
                applyMoveToBoard({ ...cont, from: cont.from, to: cont.to }, tempB2);
                bestCont = minimax(tempB2, depth - 2, alpha, beta, false);
              }
            }
            evalScore = bestCont;
          } else {
            evalScore = minimax(tempB, depth - 1, alpha, beta, false);
          }
        } else {
          evalScore = minimax(tempB, depth - 1, alpha, beta, false);
        }
        
        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const { move } of prunedMoves) {
        const tempB = b.map(row => [...row]);
        const piece = applyMoveToBoard({ ...move, from: move.from, to: move.to }, tempB);
        
        let evalScore;
        const [tr, tc] = move.to;
        if (move.captures.length > 0) {
          const contCaps = getContinuationCapturesOnBoard(tr, tc, tempB, piece);
          if (contCaps.length > 0 && depth > 1) {
            let bestCont = Infinity;
            for (const cont of contCaps) {
              if (bestCont === Infinity) {
                const tempB2 = tempB.map(row => [...row]);
                applyMoveToBoard({ ...cont, from: cont.from, to: cont.to }, tempB2);
                bestCont = minimax(tempB2, depth - 2, alpha, beta, true);
              }
            }
            evalScore = bestCont;
          } else {
            evalScore = minimax(tempB, depth - 1, alpha, beta, true);
          }
        } else {
          evalScore = minimax(tempB, depth - 1, alpha, beta, true);
        }
        
        minEval = Math.min(minEval, evalScore);
        beta = Math.min(beta, evalScore);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }
  
  function applyMoveToBoard(move, b) {
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    let piece = b[fr][fc];
    b[tr][tc] = piece;
    b[fr][fc] = null;
    for (const [cr, cc] of move.captures) {
      b[cr][cc] = null;
    }
    if (tr === 0 && piece.startsWith("white")) piece = "white-king";
    if (tr === 7 && piece.startsWith("black")) piece = "black-king";
    b[tr][tc] = piece;
    return piece;
  }

  function getContinuationCapturesOnBoard(r, c, b, piece) {
    const king = isKing(piece);
    const captures = [];
    
    if (king) {
      const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [dr, dc] of dirs) {
        let enemyR = -1, enemyC = -1;
        let foundEnemy = false;
        for (let step = 1; step < 8; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
          const cell = b[nr][nc];
          if (!foundEnemy) {
            if (cell === null) continue;
            if (isWhite(piece) && isBlack(cell)) {
              foundEnemy = true;
              enemyR = nr;
              enemyC = nc;
            } else if (isBlack(piece) && isWhite(cell)) {
              foundEnemy = true;
              enemyR = nr;
              enemyC = nc;
            } else break;
          } else {
            if (cell === null) {
              const newB = b.map(row => [...row]);
              newB[enemyR][enemyC] = null;
              const tempPiece = piece;
              newB[nr][nc] = tempPiece;
              newB[r][c] = null;
              captures.push({
                from: [r, c],
                to: [nr, nc],
                captures: [[enemyR, enemyC]]
              });
            } else break;
          }
        }
      }
    } else {
      const dir = isBlack(piece) ? -1 : 1;
      const captureDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]].filter(([dr]) => dr === -dir);
      
      for (const [dr, dc] of captureDirs) {
        const er = r + dr;
        const ec = c + dc;
        if (er < 0 || er >= 8 || ec < 0 || ec >= 8) continue;
        const enemy = b[er][ec];
        if (enemy && isWhite(enemy) !== isBlack(piece)) {
          const lr = er + dr;
          const lc = ec + dc;
          if (lr >= 0 && lr < 8 && lc >= 0 && lc < 8 && b[lr][lc] === null) {
            captures.push({
              from: [r, c],
              to: [lr, lc],
              captures: [[er, ec]]
            });
          }
        }
      }
    }
return captures;
  }

  function handlePlayerMove(move) {
    const piece = applyMove(move, board);
    selectedPiece = null;
    playUISound("click");
    renderBoard();

    if (move.captures.length > 0) {
      const [tr, tc] = move.to;
      const contCaptures = getContinuationCaptures(tr, tc, board, piece);
      if (contCaptures.length > 0) {
        selectedPiece = { r: tr, c: tc };
        renderBoard();
        return;
      }
    }

    if (!checkEnd()) {
      playerTurn = false;
      setTimeout(aiMove, 500);
    }
  }

  for (let r = 0; r < boardSize; r++) {
    board[r] = [];
    for (let c = 0; c < boardSize; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) board[r][c] = "black";
        else if (r > 4) board[r][c] = "white";
        else board[r][c] = null;
      } else {
        board[r][c] = null;
      }
    }
  }

  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Шашки — ${difficulty === "easy" ? "Лёгкая" : difficulty === "medium" ? "Средняя" : "Сложная"}</h2>
    <p class="card-sub">Ты — белые (внизу). Мошонка — чёрные (вверху). Дамка ходит на любое число клеток.</p>
    <div class="checkers-board" id="checkers-board">
      ${Array(boardSize).fill("").map((_, r) => 
        Array(boardSize).fill("").map((_, c) => {
          const isDark = (r + c) % 2 === 1;
          const piece = board[r][c];
          const pieceClass = piece === "white" ? "checker-white" : piece === "black" ? "checker-black" : "";
          const crown = piece && piece.includes("king") ? "👑" : "";
          return `<div class="checkers-cell ${isDark ? 'dark' : 'light'}" data-r="${r}" data-c="${c}">
            ${piece ? `<div class="checker ${pieceClass}">${crown}</div>` : ""}
          </div>`;
        }).join("")
      ).join("")}
    </div>
    <div class="game-result" id="checkers-result"></div>
    <div class="game-play-again" id="checkers-again" style="display:none">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  function renderBoard() {
    const cells = modal.querySelectorAll(".checkers-cell");
    cells.forEach((cell) => {
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      const piece = board[r][c];
      const crown = piece && piece.includes("king") ? "👑" : "";
      cell.innerHTML = piece ? `<div class="checker ${piece === 'white' || piece === 'white-king' ? 'checker-white' : 'checker-black'}">${crown}</div>` : "";
      cell.classList.toggle("selected", selectedPiece && selectedPiece.r === r && selectedPiece.c === c);
    });
  }

  function isKing(piece) {
    return piece && piece.includes("king");
  }

  function isWhite(piece) {
    return piece && piece.startsWith("white");
  }

  function isBlack(piece) {
    return piece && piece.startsWith("black");
  }

  function getCapturesForPiece(r, c, brd) {
    const piece = brd[r][c];
    if (!piece) return [];
    const king = isKing(piece);
    const captures = [];

    if (king) {
      const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [dr, dc] of dirs) {
        let enemyR = -1, enemyC = -1;
        let foundEnemy = false;
        for (let step = 1; step < 8; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
          const cell = brd[nr][nc];
          if (!foundEnemy) {
            if (cell === null) continue;
            if (isWhite(piece) && isBlack(cell)) {
              foundEnemy = true;
              enemyR = nr;
              enemyC = nc;
            } else if (isBlack(piece) && isWhite(cell)) {
              foundEnemy = true;
              enemyR = nr;
              enemyC = nc;
            } else {
              break;
            }
          } else {
            if (cell === null) {
              captures.push({ from: [r, c], to: [nr, nc], captures: [[enemyR, enemyC]] });
            } else {
              break;
            }
          }
        }
      }
    } else {
      const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [dr, dc] of dirs) {
        const mr = r + dr, mc = c + dc;
        const jr = r + dr * 2, jc = c + dc * 2;
        if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8) {
          const mid = brd[mr][mc];
          if (mid && !brd[jr][jc]) {
            if (isWhite(piece) && isBlack(mid)) {
              captures.push({ from: [r, c], to: [jr, jc], captures: [[mr, mc]] });
            } else if (isBlack(piece) && isWhite(mid)) {
              captures.push({ from: [r, c], to: [jr, jc], captures: [[mr, mc]] });
            }
          }
        }
      }
    }
    return captures;
  }

  function getSimpleMovesForPiece(r, c, brd) {
    const piece = brd[r][c];
    if (!piece) return [];
    const king = isKing(piece);
    const moves = [];

    if (king) {
      const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [dr, dc] of dirs) {
        for (let step = 1; step < 8; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
          if (brd[nr][nc]) break;
          moves.push({ from: [r, c], to: [nr, nc], captures: [] });
        }
      }
    } else {
      const forward = isWhite(piece) ? -1 : 1;
      for (const dc of [-1, 1]) {
        const nr = r + forward, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !brd[nr][nc]) {
          moves.push({ from: [r, c], to: [nr, nc], captures: [] });
        }
      }
    }
    return moves;
  }

  function getAllCaptures(player, brd) {
    const captures = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (brd[r][c] && brd[r][c].startsWith(player)) {
          captures.push(...getCapturesForPiece(r, c, brd));
        }
      }
    }
    return captures;
  }

  function getAllMoves(player, brd) {
    const captures = getAllCaptures(player, brd);
    if (captures.length > 0) return captures;
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (brd[r][c] && brd[r][c].startsWith(player)) {
          moves.push(...getSimpleMovesForPiece(r, c, brd));
        }
      }
    }
    return moves;
  }

  function getContinuationCaptures(r, c, brd, piece) {
    const tempBoard = brd.map(row => [...row]);
    tempBoard[r][c] = piece;
    return getCapturesForPiece(r, c, tempBoard);
  }

  function countPieces(player, brd) {
    let count = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (brd[r][c] && brd[r][c].startsWith(player)) count++;
    return count;
  }

  function checkEnd() {
    if (countPieces("black", board) === 0) {
      gameActive = false;
      modal.querySelector("#checkers-result").innerHTML = `<div class="game-win">Ты победил!</div>`;
      playUISound("win");
      modal.querySelector("#checkers-again").style.display = "block";
      return true;
    }
    if (countPieces("white", board) === 0) {
      gameActive = false;
      modal.querySelector("#checkers-result").innerHTML = `<div class="game-lose">Мошонка победил!</div>`;
      playUISound("lose");
      modal.querySelector("#checkers-again").style.display = "block";
      return true;
    }
    if (!playerTurn && getAllMoves("black", board).length === 0) {
      gameActive = false;
      modal.querySelector("#checkers-result").innerHTML = `<div class="game-win">Мошонка не может ходить. Ты победил!</div>`;
      playUISound("win");
      modal.querySelector("#checkers-again").style.display = "block";
      return true;
    }
    if (playerTurn && getAllMoves("white", board).length === 0) {
      gameActive = false;
      modal.querySelector("#checkers-result").innerHTML = `<div class="game-lose">Ты не можешь ходить. Мошонка победил!</div>`;
      playUISound("lose");
      modal.querySelector("#checkers-again").style.display = "block";
      return true;
    }
    return false;
  }

  function applyMove(move, brd) {
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    let piece = brd[fr][fc];
    brd[fr][fc] = null;
    for (const [cr, cc] of move.captures) brd[cr][cc] = null;
    if (tr === 0 && piece.startsWith("white")) piece = "white-king";
    if (tr === 7 && piece.startsWith("black")) piece = "black-king";
    brd[tr][tc] = piece;
    return piece;
  }

  function aiMove() {
    if (!gameActive) return;
    
    const moves = getAllMoves("black", board);
    if (!moves || moves.length === 0) {
      playerTurn = true;
      return;
    }
    
    let bestMove = moves[0];
    let bestScore = -Infinity;
    
    for (const move of moves) {
      const tempB = board.map(row => [...row]);
      applyMoveToBoard({ ...move, from: [...move.from], to: [...move.to] }, tempB);
      const score = minimax(tempB, settings.depth, -Infinity, Infinity, false);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    
    const piece = applyMove(bestMove, board);
    renderBoard();
    playUISound("click");
    
    const [tr, tc] = bestMove.to;
    const contCaps = getContinuationCapturesOnBoard(tr, tc, board, piece);
    if (contCaps.length > 0 && bestMove.captures.length > 0) {
      setTimeout(() => continueCapture(tr, tc, piece), 400);
    } else {
      playerTurn = true;
    }
  }

  function continueCapture(r, c, piece) {
    const contCaps = getContinuationCapturesOnBoard(r, c, board, piece);
    if (contCaps.length === 0) {
      playerTurn = true;
      return;
    }
    
    let bestMove = contCaps[0];
    let bestScore = -Infinity;
    
    for (const cap of contCaps) {
      const tempB = board.map(row => [...row]);
      applyMove({ ...cap, from: [...cap.from], to: [...cap.to] }, tempB);
      const score = minimax(tempB, settings.depth - 1, -Infinity, Infinity, false);
      if (score > bestScore) {
        bestScore = score;
        bestMove = cap;
      }
    }
    
    applyMove(bestMove, board);
    renderBoard();
    playUISound("click");
    
    const [tr, tc] = bestMove.to;
    const newPiece = board[tr][tc];
    setTimeout(() => continueCapture(tr, tc, newPiece), 400);
  }

  function handlePlayerMove(move) {
    const piece = applyMove(move, board);
    selectedPiece = null;
    playUISound("click");
    renderBoard();

    if (move.captures.length > 0) {
      const [tr, tc] = move.to;
      const contCaptures = getContinuationCaptures(tr, tc, board, piece);
      if (contCaptures.length > 0) {
        selectedPiece = { r: tr, c: tc };
        renderBoard();
        return;
      }
    }

    if (!checkEnd()) {
      playerTurn = false;
      setTimeout(aiMove, 500);
    }
  }

  modal.querySelectorAll(".checkers-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      if (!gameActive || !playerTurn) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      
      if (selectedPiece) {
        let moves;
        if (multiCapture) {
          moves = getCapturesForPiece(selectedPiece.r, selectedPiece.c, board);
        } else {
          const allMoves = getAllMoves("white", board);
          const hasCaptures = allMoves.some(m => m.captures.length > 0);
          if (hasCaptures) {
            moves = allMoves.filter(m => m.captures.length > 0 && m.from[0] === selectedPiece.r && m.from[1] === selectedPiece.c);
          } else {
            moves = getSimpleMovesForPiece(selectedPiece.r, selectedPiece.c, board);
          }
        }
        const move = moves.find(m => m.to[0] === r && m.to[1] === c);
        if (move) {
          handlePlayerMove(move);
          return;
        }
      }
      
      if (board[r][c] && board[r][c].startsWith("white")) {
        const allMoves = getAllMoves("white", board);
        const hasCaptures = allMoves.some(m => m.captures.length > 0);
        const pieceMoves = hasCaptures
          ? allMoves.filter(m => m.captures.length > 0 && m.from[0] === r && m.from[1] === c)
          : [...getSimpleMovesForPiece(r, c, board), ...getCapturesForPiece(r, c, board)];
        if (pieceMoves.length > 0) {
          selectedPiece = { r, c };
          renderBoard();
        }
      } else {
        selectedPiece = null;
        renderBoard();
      }
    });
  });

  modal.querySelector("#play-again-btn").addEventListener("click", () => {
    closeModal();
    setTimeout(gameCheckers, 100);
  });
}

// ПИНГ-ПОНГ
function gamePingPong() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Пинг-понг</h2>
    <p class="card-sub">Двигай ракетку! Игра до 5 очков.</p>
    <div class="pong-container">
      <canvas id="pong-canvas" width="300" height="400"></canvas>
    </div>
    <div class="game-result" id="pong-result"></div>
    <div class="game-play-again" id="pong-again" style="display:none">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  const canvas = modal.querySelector("#pong-canvas");
  const ctx = canvas.getContext("2d");
  const W = 300, H = 400;
  const paddleW = 60, paddleH = 12;
  const ballR = 8;
  
  let playerX = W / 2 - paddleW / 2;
  let aiX = W / 2 - paddleW / 2;
  let ballX = W / 2, ballY = H / 2;
  let ballVX = 2, ballVY = 3;
  let playerScore = 0, aiScore = 0;
  let gameRunning = true;
  let animFrame;

  function resetBall() {
    ballX = W / 2;
    ballY = H / 2;
    ballVX = (Math.random() > 0.5 ? 1 : -1) * (1.5 + Math.random());
    ballVY = (Math.random() > 0.5 ? 1 : -1) * 3;
  }

  function draw() {
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, 0, W, H);
    
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#363d4d";
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = "#6CB6FB";
    ctx.fillRect(playerX, H - 20, paddleW, paddleH);
    
    ctx.fillStyle = "#E55454";
    ctx.fillRect(aiX, 8, paddleW, paddleH);
    
    ctx.fillStyle = "#F2B33C";
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = "#9ba3b5";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${aiScore} — ${playerScore}`, W / 2, H / 2 + 5);
  }

  function update() {
    if (!gameRunning) return;
    
    ballX += ballVX;
    ballY += ballVY;
    
    if (ballX - ballR < 0 || ballX + ballR > W) ballVX *= -1;
    
    if (ballY - ballR < 8 + paddleH && ballY + ballR > 8 && ballX > aiX && ballX < aiX + paddleW) {
      ballVY = Math.abs(ballVY);
      ballVX += (ballX - (aiX + paddleW / 2)) * 0.05;
    }
    
    if (ballY + ballR > H - 20 && ballY - ballR < H && ballX > playerX && ballX < playerX + paddleW) {
      ballVY = -Math.abs(ballVY);
      ballVX += (ballX - (playerX + paddleW / 2)) * 0.05;
      playUISound("reveal");
    }
    
    if (ballY < 0) {
      playerScore++;
      playUISound("win");
      if (playerScore >= 5) {
        gameRunning = false;
        modal.querySelector("#pong-result").innerHTML = `<div class="game-win">Ты победил! ${playerScore}:${aiScore}</div>`;
        modal.querySelector("#pong-again").style.display = "block";
        return;
      }
      resetBall();
    }
    if (ballY > H) {
      aiScore++;
      playUISound("lose");
      if (aiScore >= 5) {
        gameRunning = false;
        modal.querySelector("#pong-result").innerHTML = `<div class="game-lose">Мошонка победил! ${aiScore}:${playerScore}</div>`;
        modal.querySelector("#pong-again").style.display = "block";
        return;
      }
      resetBall();
    }
    
    const aiTarget = ballX - paddleW / 2;
    aiX += (aiTarget - aiX) * 0.06;
    aiX = Math.max(0, Math.min(W - paddleW, aiX));
    
    draw();
    animFrame = requestAnimationFrame(update);
  }

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    playerX = (touch.clientX - rect.left) / rect.width * W - paddleW / 2;
    playerX = Math.max(0, Math.min(W - paddleW, playerX));
  }, { passive: false });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    playerX = (e.clientX - rect.left) / rect.width * W - paddleW / 2;
    playerX = Math.max(0, Math.min(W - paddleW, playerX));
  });

  draw();
  animFrame = requestAnimationFrame(update);
  
  modal.querySelector("#play-again-btn").addEventListener("click", () => {
    cancelAnimationFrame(animFrame);
    closeModal();
    setTimeout(gamePingPong, 100);
  });
}

// ============ КАЗИНО ============

function gameSlots() {
  const symbols = [
    { icon: "coal", weight: 42 },
    { icon: "iron", weight: 30 },
    { icon: "gold", weight: 10 },
    { icon: "diamond", weight: 3 },
    { icon: "castle", weight: 1 },
    { icon: "pumpkin", weight: 14 },
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
    <h2>Слоты</h2>
    <p class="card-sub">3 одинаковых = x5 ставки | 2 одинаковых = x1.5</p>
    <div class="game-balance">Баланс: <strong id="slot-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div class="game-slots">
      <div class="slot-reel" id="s1"><img src="/static/img/ui/question.svg" alt="" class="game-icon"/></div>
      <div class="slot-reel" id="s2"><img src="/static/img/ui/question.svg" alt="" class="game-icon"/></div>
      <div class="slot-reel" id="s3"><img src="/static/img/ui/question.svg" alt="" class="game-icon"/></div>
    </div>
    ${betInputHTML("slot-bet")}
    <button class="btn" id="slot-spin-btn">Крутить</button>
    <div class="game-result" id="slots-result"></div>
  `);

  function spin() {
    const bet = getBetValue("slot-bet");
    if (balance < bet) {
      modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    balance -= bet;
    updateBalanceDisplay("slot-balance", balance);
    playUISound("bet");
    post("/api/arcade/bet", { amount: bet }).catch(() => {});
    
    const reels = [modal.querySelector("#s1"), modal.querySelector("#s2"), modal.querySelector("#s3")];
    
    let spins = 0;
    const maxSpins = 15;
    const spinInterval = setInterval(() => {
      reels.forEach((r) => {
        const sym = pickSymbol();
        r.innerHTML = `<img src="/static/img/ui/${sym.icon}.svg" alt="" class="game-icon"/>`;
      });
      spins++;
      if (spins % 3 === 0) playUISound("spin");
      if (spins >= maxSpins) {
        clearInterval(spinInterval);
        const result = [pickSymbol(), pickSymbol(), pickSymbol()];
        reels.forEach((r, i) => {
          r.innerHTML = `<img src="/static/img/ui/${result[i].icon}.svg" alt="" class="game-icon"/>`;
          animateElement(r, "slotBounce", 300);
        });
        
        let win = 0;
        if (result[0].icon === result[1].icon && result[1].icon === result[2].icon) {
          win = bet * 5;
        } else if (result[0].icon === result[1].icon || result[1].icon === result[2].icon || result[0].icon === result[2].icon) {
          win = Math.floor(bet * 1.5);
        }
        
        if (win > 0) {
          post("/api/arcade/win", { amount: win }).catch(() => {});
          balance += win;
          updateBalanceDisplay("slot-balance", balance);
          modal.querySelector("#slots-result").innerHTML = `<div class="game-win">Выигрыш: ${win} K!</div>`;
          animateElement(modal.querySelector("#slots-result"), "popIn", 400);
          playUISound("win");
        } else {
          modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Не повезло. Ставка сгорела.</div>`;
          playUISound("lose");
        }
        syncBalance();
      }
    }, 100);
  }

  modal.querySelector("#slot-spin-btn").addEventListener("click", spin);
}

function gameRocket() {
  let multiplier = 1.0;
  let running = false;
  let crashed = false;
  let bet = 10;
  let rocketInterval = null;
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal(); crashed=true; clearInterval(rocketInterval)">×</button>
    <h2>Ракетка</h2>
    <p class="card-sub">Кэшаут до краха! Множитель растёт...</p>
    <div class="game-balance">Баланс: <strong id="rocket-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div class="game-rocket-display">
      <div class="rocket-multiplier yellow" id="rocket-mult">1.00x</div>
      <div class="rocket-visual">
        <img src="/static/img/ui/rocket.svg" alt="" class="rocket-img"/>
      </div>
    </div>
    ${betInputHTML("rocket-bet")}
    <button class="btn" id="rocket-start-btn">Старт</button>
    <button class="btn" id="rocket-cashout" style="display:none">Кэшаут</button>
    <div class="game-result" id="rocket-result"></div>
  `);

  const multEl = modal.querySelector("#rocket-mult");
  const cashoutBtn = modal.querySelector("#rocket-cashout");
  const startBtn = modal.querySelector("#rocket-start-btn");
  const resultEl = modal.querySelector("#rocket-result");
  const rocketImg = modal.querySelector(".rocket-img");

  startBtn.addEventListener("click", () => {
    bet = getBetValue("rocket-bet");
    if (balance < bet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    balance -= bet;
    updateBalanceDisplay("rocket-balance", balance);
    playUISound("bet");
    post("/api/arcade/bet", { amount: bet }).catch(() => {});
    
    running = true;
    crashed = false;
    multiplier = 1.0;
    cashoutBtn.style.display = "inline-block";
    startBtn.style.display = "none";
    resultEl.innerHTML = "";
    multEl.textContent = "1.00x";
    multEl.className = "rocket-multiplier yellow";
    rocketImg.style.transform = "translateY(0)";
    
    const instantCrash = Math.random() < 0.25;
    
    if (instantCrash) {
      crashed = true;
      running = false;
      cashoutBtn.style.display = "none";
      startBtn.style.display = "inline-block";
      multEl.textContent = "💥 1.00x";
      multEl.className = "rocket-multiplier red";
      rocketImg.style.transition = "transform 0.15s ease-in";
      rocketImg.style.transform = "translateY(-120px) rotate(-30deg)";
      resultEl.innerHTML = `<div class="game-lose">Ракета взорвалась на старте! Ставка сгорела.</div>`;
      playUISound("lose");
      setTimeout(() => {
        rocketImg.style.transition = "";
        rocketImg.style.transform = "translateY(0)";
        syncBalance();
      }, 800);
      return;
    }
    
    const crashPoint = 1.05 + Math.pow(Math.random(), 1.5) * 1.95;
    
    rocketInterval = setInterval(() => {
      if (crashed) { clearInterval(rocketInterval); return; }
      multiplier += 0.008;
      multEl.textContent = multiplier.toFixed(2) + "x";
      
      const flyHeight = Math.min((multiplier - 1) * 30, 80);
      rocketImg.style.transition = "transform 0.1s ease-out";
      rocketImg.style.transform = `translateY(${-flyHeight}px)`;
      
      if (multiplier >= crashPoint) {
        crashed = true;
        running = false;
        cashoutBtn.style.display = "none";
        startBtn.style.display = "inline-block";
        clearInterval(rocketInterval);
        multEl.textContent = "💥 " + multiplier.toFixed(2) + "x";
        multEl.className = "rocket-multiplier red";
        rocketImg.style.transition = "transform 0.3s ease-in";
        rocketImg.style.transform = `translateY(${-flyHeight - 40}px) rotate(-25deg)`;
        resultEl.innerHTML = `<div class="game-lose">Крах на ${multiplier.toFixed(2)}x! Ставка сгорела.</div>`;
        playUISound("lose");
        setTimeout(() => {
          rocketImg.style.transition = "";
          rocketImg.style.transform = "translateY(0)";
          syncBalance();
        }, 800);
      }
    }, 80);
  });

  cashoutBtn.addEventListener("click", () => {
    if (!running || crashed) return;
    crashed = true;
    running = false;
    cashoutBtn.style.display = "none";
    startBtn.style.display = "inline-block";
    clearInterval(rocketInterval);
    const win = Math.floor(bet * multiplier);
    post("/api/arcade/win", { amount: win }).catch(() => {});
    balance += win;
    updateBalanceDisplay("rocket-balance", balance);
    multEl.className = "rocket-multiplier green";
    resultEl.innerHTML = `<div class="game-win">Кэшаут на ${multiplier.toFixed(2)}x! +${win} K</div>`;
    animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
    playUISound("cashout");
    rocketImg.style.transition = "transform 0.3s ease-out";
    rocketImg.style.transform = "translateY(-20px)";
    setTimeout(() => {
      rocketImg.style.transition = "";
      rocketImg.style.transform = "translateY(0)";
      syncBalance();
    }, 500);
  });
}

function gameDice() {
  const diceFaces = ["⚀","⚁","⚂","⚃","⚄","⚅"];
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Кубик удачи</h2>
    <p class="card-sub">Угадай чёт/нечёт или конкретное число!</p>
    <div class="game-balance">Баланс: <strong id="dice-balance">${balance}</strong> ${kovbaksWord(balance)}</div>
    <div class="game-dice-display" id="dice-display"><span class="dice-face">⚀</span></div>
    <div class="game-bet-row">
      <button class="btn btn-sm" id="dice-even">Чёт (x1.7)</button>
      <button class="btn btn-sm" id="dice-odd">Нечёт (x1.7)</button>
    </div>
    <div class="game-bet-row">
      ${[1,2,3,4,5,6].map(n => `<button class="btn btn-sm dice-num" data-num="${n}">${n} (x4.5)</button>`).join("")}
    </div>
    ${betInputHTML("dice-bet")}
    <div class="game-result" id="dice-result"></div>
  `);

  const display = modal.querySelector(".dice-face");
  const resultEl = modal.querySelector("#dice-result");
  
  function roll(predicate, multiplier) {
    const actualBet = getBetValue("dice-bet");
    if (balance < actualBet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    balance -= actualBet;
    updateBalanceDisplay("dice-balance", balance);
    playUISound("bet");
    post("/api/arcade/bet", { amount: actualBet }).catch(() => {});
    
    let rolls = 0;
    const anim = setInterval(() => {
      display.textContent = diceFaces[Math.floor(Math.random() * 6)];
      display.style.transform = `rotate(${rolls * 36}deg)`;
      rolls++;
      if (rolls % 3 === 0) playUISound("spin");
      if (rolls > 15) {
        clearInterval(anim);
        const final = Math.floor(Math.random() * 6) + 1;
        display.textContent = diceFaces[final - 1];
        display.style.transform = "rotate(0deg)";
        
        if (predicate(final)) {
          const win = Math.floor(actualBet * multiplier);
          post("/api/arcade/win", { amount: win }).catch(() => {});
          balance += win;
          updateBalanceDisplay("dice-balance", balance);
          resultEl.innerHTML = `<div class="game-win">Выпало ${final}! Выигрыш: ${win} K</div>`;
          animateElement(resultEl.querySelector(".game-win"), "popIn", 400);
          playUISound("win");
        } else {
          resultEl.innerHTML = `<div class="game-lose">Выпало ${final}. Ставка сгорела.</div>`;
          playUISound("lose");
        }
        syncBalance();
      }
    }, 80);
  }

  modal.querySelector("#dice-even").addEventListener("click", () => roll((n) => n % 2 === 0, 1.65));
  modal.querySelector("#dice-odd").addEventListener("click", () => roll((n) => n % 2 === 1, 1.65));
  modal.querySelectorAll(".dice-num").forEach((btn) => {
    btn.addEventListener("click", () => {
      const num = Number(btn.dataset.num);
      roll((n) => n === num, 5.2);
    });
  });
}

function gameChess() {
  const difficultyModal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Шахматы</h2>
    <p class="card-sub">Выбери сложность:</p>
    <div class="chess-difficulty">
      <button class="btn btn-outline" data-diff="easy">Лёгкая</button>
      <button class="btn btn-outline" data-diff="medium">Средняя</button>
      <button class="btn btn-outline" data-diff="hard">Сложная</button>
    </div>
  `);

  difficultyModal.querySelectorAll("[data-diff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal();
      setTimeout(() => startChessGame(btn.dataset.diff), 100);
    });
  });
}

function startChessGame(difficulty) {
  const pieceSymbols = {
    K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
  };

  const board8x8 = [
    ["r", "n", "b", "q", "k", "b", "n", "r"],
    ["p", "p", "p", "p", "p", "p", "p", "p"],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["P", "P", "P", "P", "P", "P", "P", "P"],
    ["R", "N", "B", "Q", "K", "B", "N", "R"]
  ];

  let board = board8x8.map(r => [...r]);
  let selected = null;
  let playerTurn = true;
  let gameActive = true;
  let castlingRights = { K: true, Q: true, k: true, q: true };
  let enPassantTarget = null;
  let moveHistory = [];

  const diffSettings = {
    easy: { randomChance: 0.7, lookAhead: 1, evalDepth: 1 },
    medium: { randomChance: 0.3, lookAhead: 2, evalDepth: 2 },
    hard: { randomChance: 0.05, lookAhead: 3, evalDepth: 3 },
  };
  const settings = diffSettings[difficulty];

  const pieceValues = { P: 10, N: 30, B: 30, R: 50, Q: 90, K: 900 };

  function evaluateBoard(b) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = b[r][c];
        if (piece) {
          const value = pieceValues[piece.toUpperCase()] || 0;
          if (piece === piece.toUpperCase()) {
            score += value;
          } else {
            score -= value;
          }
        }
      }
    }
    return score;
  }

  function getBestMove(moves, b, isWhite, depth) {
    if (moves.length === 0) return null;
    if (depth <= 0 || moves.length > 50) {
      const scoredMoves = moves.map(move => {
        let score = 0;
        const [tr, tc] = move.to;
        const captured = b[tr][tc];
        if (captured) {
          const piece = captured.toUpperCase();
          const pieceVal = pieceValues[piece] || 0;
          score += pieceVal * 10;
        }
        score += Math.random() * 2;
        return { move, score };
      });
      scoredMoves.sort((a, b) => isWhite ? b.score - a.score : a.score - b.score);
      return scoredMoves[0];
    }

    const allMoves = [];
    for (const move of moves) {
      const tempBoard = b.map(row => [...row]);
      const [fr, fc] = move.from;
      const [tr, tc] = move.to;
      tempBoard[tr][tc] = tempBoard[fr][fc];
      tempBoard[fr][fc] = null;

      let score = evaluateBoard(tempBoard);
      const captured = b[tr][tc];
      if (captured) {
        const piece = captured.toUpperCase();
        score += (pieceValues[piece] || 0) * 5;
      }

      const isCheckAfterMove = isCheck(isWhite, tempBoard);
      if (isCheckAfterMove) score += 50;

      const isCaptureAfterMove = captured !== undefined;
      if (isCaptureAfterMove && !captured) score += 5;

      allMoves.push({ move, score });
    }

    allMoves.sort((a, b) => isWhite ? b.score - a.score : a.score - b.score);

    const topMoves = allMoves.slice(0, Math.min(5, allMoves.length));
    return topMoves[Math.floor(Math.random() * Math.min(2, topMoves.length))];
  }

const piecesCSS = {
    K: '<img src="/static/img/chess/kl.svg" class="chess-piece-img"/>',
    Q: '<img src="/static/img/chess/ql.svg" class="chess-piece-img"/>',
    R: '<img src="/static/img/chess/rl.svg" class="chess-piece-img"/>',
    B: '<img src="/static/img/chess/bl.svg" class="chess-piece-img"/>',
    N: '<img src="/static/img/chess/nl.svg" class="chess-piece-img"/>',
    P: '<img src="/static/img/chess/pl.svg" class="chess-piece-img"/>',
    k: '<img src="/static/img/chess/kl.svg" class="chess-piece-img black-piece"/>',
    q: '<img src="/static/img/chess/ql.svg" class="chess-piece-img black-piece"/>',
    r: '<img src="/static/img/chess/rl.svg" class="chess-piece-img black-piece"/>',
    b: '<img src="/static/img/chess/bl.svg" class="chess-piece-img black-piece"/>',
    n: '<img src="/static/img/chess/nl.svg" class="chess-piece-img black-piece"/>',
    p: '<img src="/static/img/chess/pl.svg" class="chess-piece-img black-piece"/>'
  };

  function findKing(board, isWhite) {
    const king = isWhite ? "K" : "k";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === king) return [r, c];
      }
    }
    return null;
  }

  function isSquareAttacked(board, row, col, byWhite) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const pieceIsWhite = piece === piece.toUpperCase();
        if (pieceIsWhite !== byWhite) continue;

        const moves = getRawMoves(r, c, board, true);
        if (moves.some(m => m[0] === row && m[1] === col)) {
          return true;
        }
      }
    }
    return false;
  }

  function getRawMoves(r, c, b, ignoreKingSafety = false) {
    const piece = b[r][c];
    if (!piece) return [];
    const moves = [];
    const isWhite = piece === piece.toUpperCase();
    const type = piece.toLowerCase();

    const canMoveTo = (tr, tc) => {
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
      const target = b[tr][tc];
      if (!target) return true;
      return target.toUpperCase() !== piece.toUpperCase();
    };

    // Pawn
    if (type === "p") {
      const dir = isWhite ? -1 : 1;
      const startRow = isWhite ? 6 : 1;
      const nr = r + dir;
      
      // Forward move
      if (nr >= 0 && nr < 8 && !b[nr][c]) {
        moves.push([nr, c]);
        // Double move from start
        if (r === startRow && r + dir * 2 >= 0 && r + dir * 2 < 8 && !b[r + dir * 2][c]) {
          moves.push([r + dir * 2, c]);
        }
      }
      
      // Captures
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc >= 0 && nc < 8 && nr >= 0 && nr < 8) {
          const target = b[nr][nc];
          if (target && target.toUpperCase() !== piece.toUpperCase()) {
            moves.push([nr, nc]);
          }
          if (enPassantTarget && enPassantTarget[0] === nr && enPassantTarget[1] === nc) {
            moves.push([nr, nc]);
          }
        }
      }
    }

    // Knight
    if (type === "n") {
      const offsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const [dr, dc] of offsets) {
        if (canMoveTo(r + dr, c + dc)) moves.push([r + dr, c + dc]);
      }
    }

    // Bishop
    if (type === "b" || type === "q") {
      const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [dr, dc] of dirs) {
        for (let i = 1; i < 8; i++) {
          const tr = r + dr * i, tc = c + dc * i;
          if (!canMoveTo(tr, tc)) break;
          moves.push([tr, tc]);
          if (b[tr][tc]) break; // Stop after capture
        }
      }
    }

    // Rook
    if (type === "r" || type === "q") {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dr, dc] of dirs) {
        for (let i = 1; i < 8; i++) {
          const tr = r + dr * i, tc = c + dc * i;
          if (!canMoveTo(tr, tc)) break;
          moves.push([tr, tc]);
          if (b[tr][tc]) break;
        }
      }
    }

    // King
    if (type === "k") {
      const offsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dr, dc] of offsets) {
        if (canMoveTo(r + dr, c + dc)) moves.push([r + dr, c + dc]);
      }

      // Castling
      if (!ignoreKingSafety) {
        if (isWhite && r === 7 && c === 4) {
          if (castlingRights.K && canMoveTo(7, 5) && canMoveTo(7, 6) && !b[7][5] && !b[7][6] && !b[7][7]) {
            if (!isSquareAttacked(b, 7, 5, false) && !isSquareAttacked(b, 7, 6, false)) moves.push([7, 6]);
          }
          if (castlingRights.Q && !b[7][1] && !b[7][2] && !b[7][3] && !b[7][0]) {
            if (!isSquareAttacked(b, 7, 3, false) && !isSquareAttacked(b, 7, 2, false)) moves.push([7, 2]);
          }
        }
        if (!isWhite && r === 0 && c === 4) {
          if (castlingRights.k && !b[0][5] && !b[0][6] && !b[0][7]) {
            if (!isSquareAttacked(b, 0, 5, true) && !isSquareAttacked(b, 0, 6, true)) moves.push([0, 6]);
          }
          if (castlingRights.q && !b[0][1] && !b[0][2] && !b[0][3] && !b[0][0]) {
            if (!isSquareAttacked(b, 0, 3, true) && !isSquareAttacked(b, 0, 2, true)) moves.push([0, 2]);
          }
        }
      }
    }

    return moves;
  }

  function getValidMoves(r, c, b) {
    const piece = b[r][c];
    if (!piece) return [];
    const isWhite = piece === piece.toUpperCase();
    const rawMoves = getRawMoves(r, c, b, false);
    const validMoves = [];

    rawMoves.forEach(([tr, tc]) => {
      const tempBoard = b.map(row => [...row]);
      tempBoard[tr][tc] = tempBoard[r][c];
      tempBoard[r][c] = null;

      if (enPassantTarget && tr === enPassantTarget[0] && tc === enPassantTarget[1]) {
        const captureRow = isWhite ? tr + 1 : tr - 1;
        tempBoard[captureRow][tc] = null;
      }

      const kingPos = findKing(tempBoard, isWhite);
      if (kingPos && !isSquareAttacked(tempBoard, kingPos[0], kingPos[1], !isWhite)) {
        validMoves.push([tr, tc]);
      }
    });

    return validMoves;
  }

  function isCheck(isWhite, b) {
    const kingPos = findKing(b, isWhite);
    if (!kingPos) return true;
    return isSquareAttacked(b, kingPos[0], kingPos[1], !isWhite);
  }

  function isCheckmate(isWhite, b) {
    if (!isCheck(isWhite, b)) return false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = b[r][c];
        if (piece && (piece === piece.toUpperCase()) === isWhite) {
          if (getValidMoves(r, c, b).length > 0) return false;
        }
      }
    }
    return true;
  }

  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Шахматы</h2>
    <p class="card-sub" id="chess-status">Ход белых</p>
    <div class="chess-board" id="chess-board">
      ${Array(8).fill("").map((_, r) => 
        Array(8).fill("").map((_, c) => {
          const isDark = (r + c) % 2 === 1;
          const piece = board[r][c];
          return `<div class="chess-cell ${isDark ? 'dark' : 'light'}" data-r="${r}" data-c="${c}">
            ${piece ? piecesCSS[piece] : ""}
          </div>`;
        }).join("")
      ).join("")}
    </div>
    <div class="game-result" id="chess-result"></div>
    <div class="game-play-again" id="chess-again" style="display:none">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  function render() {
    modal.querySelectorAll(".chess-cell").forEach(cell => {
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      const piece = board[r][c];
      cell.innerHTML = piece ? piecesCSS[piece] : "";
      cell.classList.toggle("selected", selected && selected.r === r && selected.c === c);
      cell.classList.remove("valid-move", "valid-capture");
    });
    
    if (selected) {
      const validMoves = getValidMoves(selected.r, selected.c, board);
      const selectedPiece = board[selected.r][selected.c];
      
      validMoves.forEach(([tr, tc]) => {
        const targetCell = modal.querySelector(`.chess-cell[data-r="${tr}"][data-c="${tc}"]`);
        if (targetCell && !targetCell.classList.contains("selected")) {
          const targetPiece = board[tr][tc];
          if (targetPiece) {
            targetCell.classList.add("valid-capture");
          } else {
            targetCell.classList.add("valid-move");
          }
        }
      });
    }
    
    const statusEl = modal.querySelector("#chess-status");
    if (isCheckmate(true, board)) {
      statusEl.textContent = "Мат! Ты проиграл";
    } else if (isCheckmate(false, board)) {
      statusEl.textContent = "Мат! Ты победил";
    } else if (isCheck(true, board)) {
      statusEl.textContent = "Шах белым!";
    } else if (isCheck(false, board)) {
      statusEl.textContent = "Шах чёрным!";
    } else if (isStalemate(true, board)) {
      statusEl.textContent = "Пат! Ничья";
    } else {
      statusEl.textContent = playerTurn ? "Ход белых" : "Ход чёрных";
    }
  }

  function isStalemate(isWhite, b) {
    if (isCheck(isWhite, b)) return false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = b[r][c];
        if (piece && (piece === piece.toUpperCase()) === isWhite) {
          if (getValidMoves(r, c, b).length > 0) return false;
        }
      }
    }
    return true;
  }

  function makeMove(fromR, fromC, toR, toC) {
    const piece = board[fromR][fromC];
    const isWhite = piece === piece.toUpperCase();
    const type = piece.toLowerCase();

    if (type === "k") {
      if (isWhite) {
        castlingRights.K = false;
        castlingRights.Q = false;
      } else {
        castlingRights.k = false;
        castlingRights.q = false;
      }
      if (Math.abs(toC - fromC) === 2) {
        if (toC === 6) {
          board[toR][5] = board[toR][7];
          board[toR][7] = null;
        } else if (toC === 2) {
          board[toR][3] = board[toR][0];
          board[toR][0] = null;
        }
      }
    }
    if (type === "r") {
      if (isWhite) {
        if (fromC === 7) castlingRights.K = false;
        if (fromC === 0) castlingRights.Q = false;
      } else {
        if (fromC === 7) castlingRights.k = false;
        if (fromC === 0) castlingRights.q = false;
      }
    }

    if (type === "p" && Math.abs(toR - fromR) === 2) {
      enPassantTarget = [(fromR + toR) / 2, fromC];
    } else {
      enPassantTarget = null;
    }

    if (type === "p" && enPassantTarget && toR === enPassantTarget[0] && toC === enPassantTarget[1]) {
      const captureRow = isWhite ? toR + 1 : toR - 1;
      board[captureRow][toC] = null;
    }

    board[toR][toC] = board[fromR][fromC];
    board[fromR][fromC] = null;

    if (type === "p" && (toR === 0 || toR === 7)) {
      board[toR][toC] = isWhite ? "Q" : "q";
    }
  }

  function aiMove() {
    if (!gameActive) return;

    if (isCheckmate(false, board)) {
      gameActive = false;
      modal.querySelector("#chess-result").innerHTML = `<div class="game-win">Мат! Ты победил!</div>`;
      playUISound("win");
      modal.querySelector("#chess-again").style.display = "block";
      return;
    }

    if (isStalemate(false, board)) {
      gameActive = false;
      modal.querySelector("#chess-result").innerHTML = `<div class="game-draw">Пат! Ничья.</div>`;
      playUISound("click");
      modal.querySelector("#chess-again").style.display = "block";
      return;
    }

    let moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece === piece.toLowerCase()) {
          const validMoves = getValidMoves(r, c, board);
          validMoves.forEach(([tr, tc]) => {
            moves.push({ from: [r, c], to: [tr, tc] });
          });
        }
      }
    }

    if (moves.length === 0) {
      gameActive = false;
      if (isCheck(false, board)) {
        modal.querySelector("#chess-result").innerHTML = `<div class="game-win">Мат! Ты победил!</div>`;
      } else {
        modal.querySelector("#chess-result").innerHTML = `<div class="game-draw">Пат! Ничья.</div>`;
      }
      playUISound("win");
      modal.querySelector("#chess-again").style.display = "block";
      return;
    }

    const captureMoves = moves.filter(m => board[m.to[0]][m.to[1]]);
    const checkMoves = moves.filter(m => {
      const tempBoard = board.map(row => [...row]);
      const [fr, fc] = m.from;
      const [tr, tc] = m.to;
      tempBoard[tr][tc] = tempBoard[fr][fc];
      tempBoard[fr][fc] = null;
      return isCheck(true, tempBoard);
    });
    
    let selectedMove;
    
    if (Math.random() < settings.randomChance) {
      const attackMoves = moves.filter(m => board[m.to[0]][m.to[1]]);
      if (attackMoves.length > 0) {
        selectedMove = attackMoves[Math.floor(Math.random() * attackMoves.length)];
      } else if (checkMoves.length > 0) {
        selectedMove = checkMoves[Math.floor(Math.random() * checkMoves.length)];
      } else {
        selectedMove = moves[Math.floor(Math.random() * moves.length)];
      }
    } else {
      const result = getBestMove(moves, board, false, settings.evalDepth);
      selectedMove = result.move;
    }

    makeMove(selectedMove.from[0], selectedMove.from[1], selectedMove.to[0], selectedMove.to[1]);
    playUISound("click");
    render();

    if (isCheckmate(true, board)) {
      gameActive = false;
      modal.querySelector("#chess-result").innerHTML = `<div class="game-lose">Мат! Ты проиграл.</div>`;
      playUISound("lose");
      modal.querySelector("#chess-again").style.display = "block";
      return;
    }
    
    if (isStalemate(true, board)) {
      gameActive = false;
      modal.querySelector("#chess-result").innerHTML = `<div class="game-draw">Пат! Ничья.</div>`;
      playUISound("click");
      modal.querySelector("#chess-again").style.display = "block";
      return;
    }
    
    playerTurn = true;
  }

  modal.querySelectorAll(".chess-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      if (!gameActive || !playerTurn) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      
      const clickedPiece = board[r][c];
      const isClickedPieceWhite = clickedPiece ? clickedPiece === clickedPiece.toUpperCase() : false;

      if (selected) {
        const selectedPiece = board[selected.r][selected.c];
        const isSelectedPieceWhite = selectedPiece === selectedPiece.toUpperCase();
        
        if (isClickedPieceWhite && isSelectedPieceWhite) {
          // Clicked on own piece - select it instead
          selected = { r, c };
          render();
          return;
        }
        
        const validMoves = getValidMoves(selected.r, selected.c, board);
        const move = validMoves.find(m => m[0] === r && m[1] === c);
        if (move) {
          makeMove(selected.r, selected.c, r, c);
          selected = null;
          playUISound("click");
          render();

          if (isCheckmate(true, board)) {
            gameActive = false;
            modal.querySelector("#chess-result").innerHTML = `<div class="game-lose">Мат! Ты проиграл.</div>`;
            playUISound("lose");
            modal.querySelector("#chess-again").style.display = "block";
            return;
          }

          playerTurn = false;
          setTimeout(aiMove, 500);
          return;
        } else {
          // Invalid move - deselect
          selected = null;
          render();
        }
      }

      if (clickedPiece && isClickedPieceWhite) {
        const validMoves = getValidMoves(r, c, board);
        if (validMoves.length > 0) {
          selected = { r, c };
          render();
        }
      } else {
        selected = null;
        render();
      }
    });
  });

  modal.querySelector("#play-again-btn").addEventListener("click", () => {
    closeModal();
    setTimeout(() => startChessGame(difficulty), 100);
  });
}

function gameTanks() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Танчики</h2>
    <p class="card-sub">Управляй танком! Стреляй в противника.</p>
    <div class="tank-game-container" id="tank-game">
      <canvas id="tank-canvas" width="300" height="400"></canvas>
    </div>
    <div class="game-result" id="tank-result"></div>
    <div class="game-play-again" id="tank-again" style="display:none">
      <button class="btn" id="play-again-btn">Играть заново</button>
    </div>
  `);

  const canvas = modal.querySelector("#tank-canvas");
  const ctx = canvas.getContext("2d");
  const W = 300, H = 400;
  
  let playerTank = { x: 40, y: 350, angle: -Math.PI/2, alive: true };
  let enemyTank = { x: 260, y: 50, angle: Math.PI/2, alive: true };
  let bullets = [];
  let gameRunning = true;
  let animFrame;

  const keys = {};
  
  function drawTank(tank, color) {
    if (!tank.alive) return;
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);
    ctx.fillStyle = color;
    ctx.fillRect(-15, -10, 30, 20);
    ctx.fillStyle = "#333";
    ctx.fillRect(5, -4, 18, 8);
    ctx.fillStyle = "#666";
    ctx.beginPath();
    ctx.arc(-10, 10, 6, 0, Math.PI * 2);
    ctx.arc(0, 10, 6, 0, Math.PI * 2);
    ctx.arc(10, 10, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-10, -10, 6, 0, Math.PI * 2);
    ctx.arc(0, -10, 6, 0, Math.PI * 2);
    ctx.arc(10, -10, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBullets() {
    ctx.fillStyle = "#FF5722";
    bullets.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function update() {
    if (!gameRunning) return;
    
    if (keys["ArrowLeft"]) playerTank.angle -= 0.08;
    if (keys["ArrowRight"]) playerTank.angle += 0.08;
    if (keys["ArrowUp"]) {
      playerTank.x += Math.cos(playerTank.angle) * 2;
      playerTank.y += Math.sin(playerTank.angle) * 2;
    }
    if (keys["ArrowDown"]) {
      playerTank.x -= Math.cos(playerTank.angle) * 1.5;
      playerTank.y -= Math.sin(playerTank.angle) * 1.5;
    }
    playerTank.x = Math.max(15, Math.min(W-15, playerTank.x));
    playerTank.y = Math.max(15, Math.min(H-15, playerTank.y));
    
    if (keys[" "] && !keys["_fired"]) {
      keys["_fired"] = true;
      bullets.push({
        x: playerTank.x + Math.cos(playerTank.angle) * 20,
        y: playerTank.y + Math.sin(playerTank.angle) * 20,
        vx: Math.cos(playerTank.angle) * 6,
        vy: Math.sin(playerTank.angle) * 6,
        owner: "player"
      });
      playUISound("spin");
    }
    if (!keys[" "]) keys["_fired"] = false;
    
    const dx = playerTank.x - enemyTank.x;
    const dy = playerTank.y - enemyTank.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 80) {
      const angle = Math.atan2(dy, dx);
      enemyTank.x += Math.cos(angle) * 1.2;
      enemyTank.y += Math.sin(angle) * 1.2;
      enemyTank.angle = angle;
    } else {
      if (Math.random() < 0.02 && bullets.filter(b => b.owner === "enemy").length < 3) {
        bullets.push({
          x: enemyTank.x + Math.cos(enemyTank.angle) * 20,
          y: enemyTank.y + Math.sin(enemyTank.angle) * 20,
          vx: Math.cos(enemyTank.angle) * 5,
          vy: Math.sin(enemyTank.angle) * 5,
          owner: "enemy"
        });
      }
    }
    
    bullets = bullets.filter(b => {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) return false;
      
      if (b.owner === "player") {
        const dx = b.x - enemyTank.x;
        const dy = b.y - enemyTank.y;
        if (Math.sqrt(dx*dx + dy*dy) < 20) {
          enemyTank.alive = false;
          playUISound("win");
          gameRunning = false;
          modal.querySelector("#tank-result").innerHTML = `<div class="game-win">Победа! Танк противника уничтожен.</div>`;
          modal.querySelector("#tank-again").style.display = "block";
          return false;
        }
      } else {
        const dx = b.x - playerTank.x;
        const dy = b.y - playerTank.y;
        if (Math.sqrt(dx*dx + dy*dy) < 20) {
          playerTank.alive = false;
          playUISound("lose");
          gameRunning = false;
          modal.querySelector("#tank-result").innerHTML = `<div class="game-lose">Твой танк уничтожен!</div>`;
          modal.querySelector("#tank-again").style.display = "block";
          return false;
        }
      }
      return true;
    });
    
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2a2d36";
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 8; j++) {
        if ((i+j) % 2 === 0) ctx.fillRect(i*30+2, j*50+2, 26, 46);
      }
    }
    drawTank(playerTank, "#4CAF50");
    drawTank(enemyTank, "#E53935");
    drawBullets();
    
    animFrame = requestAnimationFrame(update);
  }

  canvas.addEventListener("keydown", e => { keys[e.key] = true; e.preventDefault(); });
  canvas.addEventListener("keyup", e => { keys[e.key] = false; });
  
  canvas.addEventListener("touchstart", e => {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const angle = Math.atan2(y - playerTank.y, x - playerTank.x);
    if (y < playerTank.y - 30) keys["ArrowUp"] = true;
    else if (y > playerTank.y + 30) keys["ArrowDown"] = true;
    else if (x < playerTank.x - 30) keys["ArrowLeft"] = true;
    else if (x > playerTank.x + 30) keys["ArrowRight"] = true;
  });
  canvas.addEventListener("touchend", () => {
    keys["ArrowUp"] = false;
    keys["ArrowDown"] = false;
    keys["ArrowLeft"] = false;
    keys["ArrowRight"] = false;
  });
  canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    keys["ArrowUp"] = y < playerTank.y - 20;
    keys["ArrowDown"] = y > playerTank.y + 20;
    keys["ArrowLeft"] = x < playerTank.x - 20;
    keys["ArrowRight"] = x > playerTank.x + 20;
    if (y < 100 && Math.random() < 0.1 && !keys["_fired"]) {
      keys[" "] = true;
    }
  });
  
  update();
  
  modal.querySelector("#play-again-btn").addEventListener("click", () => {
    cancelAnimationFrame(animFrame);
    closeModal();
    setTimeout(gameTanks, 100);
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
      <div class="game-tile" data-game="chess">
        <div class="game-tile-icon"><img src="/static/img/ui/chess.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Шахматы</div>
        <div class="game-tile-desc">4 уровня сложности</div>
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
    chess: gameChess,
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
