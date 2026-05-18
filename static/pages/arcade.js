import { post, get } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let balance = 0;

async function fetchBalance() {
  try {
    const me = await get("/api/profile/me");
    balance = me.user.balance;
    return balance;
  } catch {
    return 0;
  }
}

// ============ МИНИ-ИГРЫ ============

function gameWhereIsMoshonka() {
  let found = false;
  const moshonkaPos = Math.floor(Math.random() * 3);
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>🌿 Где Мошонка?</h2>
    <p class="card-sub">Мошонка спрятался за одним из кустов. Угадай где! Приз: 5-15 K</p>
    <div class="game-bushes">
      <button class="game-bush" data-bush="0">🌳</button>
      <button class="game-bush" data-bush="1">🌳</button>
      <button class="game-bush" data-bush="2">🌳</button>
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
        if (i === moshonkaPos) b.textContent = "🧑‍🌾";
        else b.textContent = "❌";
      });
      
      found = true;
      if (chosen === moshonkaPos) {
        const reward = 5 + Math.floor(Math.random() * 11);
        try {
          await post("/api/profile/transfer", { recipient: "self", amount: reward }); // placeholder
          result.innerHTML = `<div class="game-win">🎉 Угадал! Мошонка доволен. +${reward} K</div>`;
        } catch {
          result.innerHTML = `<div class="game-win">🎉 Угадал! (Демо режим)</div>`;
        }
      } else {
        result.innerHTML = `<div class="game-lose">😅 Мимо! Мошонка был за кустом ${moshonkaPos + 1}</div>`;
      }
    });
  });
}

function gameDefendWall() {
  let score = 0;
  let timeLeft = 15;
  let gameInterval;
  let zombies = [];
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal(); clearInterval(gameInterval)">×</button>
    <h2>🧱 Защити стену!</h2>
    <p class="card-sub">Кликай по зомби, чтобы остановить волну! Приз: 1 K за каждого</p>
    <div class="game-stats">
      <span>🎯 ${score}</span>
      <span>⏱️ ${timeLeft}с</span>
    </div>
    <div class="game-wall" id="game-wall"></div>
    <div class="game-result" id="defend-result"></div>
  `);

  const wall = modal.querySelector("#game-wall");
  const stats = modal.querySelector(".game-stats");
  
  function spawnZombie() {
    if (timeLeft <= 0) return;
    const zombie = document.createElement("button");
    zombie.className = "game-zombie";
    zombie.textContent = "🧟";
    zombie.style.left = Math.random() * 80 + "%";
    zombie.style.top = Math.random() * 70 + "%";
    zombie.addEventListener("click", () => {
      score++;
      stats.innerHTML = `<span>🎯 ${score}</span><span>⏱️ ${timeLeft}с</span>`;
      zombie.remove();
    });
    wall.appendChild(zombie);
    zombies.push(zombie);
    setTimeout(() => zombie.remove(), 2000);
  }

  const spawnInterval = setInterval(spawnZombie, 800);
  
  gameInterval = setInterval(() => {
    timeLeft--;
    stats.innerHTML = `<span>🎯 ${score}</span><span>⏱️ ${timeLeft}с</span>`;
    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      clearInterval(spawnInterval);
      const reward = score;
      modal.querySelector("#defend-result").innerHTML = 
        `<div class="game-win">🏆 Волна отбита! Зомби уничтожено: ${score}. Приз: ${reward} K</div>`;
    }
  }, 1000);
}

function gameHarvest() {
  let score = 0;
  let timeLeft = 20;
  let gameInterval;
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal(); clearInterval(gameInterval)">×</button>
    <h2>🎃 Собери урожай!</h2>
    <p class="card-sub">Кликай по тыквам! Приз: 2 K за каждую</p>
    <div class="game-stats">
      <span>🎃 ${score}</span>
      <span>⏱️ ${timeLeft}с</span>
    </div>
    <div class="game-field" id="harvest-field"></div>
    <div class="game-result" id="harvest-result"></div>
  `);

  const field = modal.querySelector("#harvest-field");
  const stats = modal.querySelector(".game-stats");

  function spawnPumpkin() {
    if (timeLeft <= 0) return;
    const pumpkin = document.createElement("button");
    pumpkin.className = "game-pumpkin";
    pumpkin.textContent = "🎃";
    pumpkin.style.left = Math.random() * 85 + "%";
    pumpkin.style.top = Math.random() * 80 + "%";
    pumpkin.addEventListener("click", () => {
      score++;
      stats.innerHTML = `<span>🎃 ${score}</span><span>⏱️ ${timeLeft}с</span>`;
      pumpkin.remove();
    });
    field.appendChild(pumpkin);
    setTimeout(() => pumpkin.remove(), 1500);
  }

  const spawnInterval = setInterval(spawnPumpkin, 600);
  
  gameInterval = setInterval(() => {
    timeLeft--;
    stats.innerHTML = `<span>🎃 ${score}</span><span>⏱️ ${timeLeft}с</span>`;
    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      clearInterval(spawnInterval);
      const reward = score * 2;
      modal.querySelector("#harvest-result").innerHTML = 
        `<div class="game-win">🏆 Урожай собран! Тыкв: ${score}. Приз: ${reward} K</div>`;
    }
  }, 1000);
}

function gameQuiz() {
  const questions = [
    { q: "Кто охраняет тыквенную грядку?", a: ["Мошонка", "Зомби", "Крипер", "Админ"], correct: 0 },
    { q: "Где живёт Мошонка?", a: ["В замке", "В канаве у стены", "На рынке", "В лесу"], correct: 1 },
    { q: "Что такое Ковчег?", a: ["Корабль", "Цифровая община", "Магазин", "Игра"], correct: 1 },
    { q: "Сколько спинов в день у колеса?", a: ["1", "3", "5", "∞"], correct: 0 },
  ];
  
  let current = 0;
  let correct = 0;
  
  function showQuestion() {
    const q = questions[current];
    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2>📚 Викторина Ковчега</h2>
      <div class="game-progress">Вопрос ${current + 1} из ${questions.length}</div>
      <p class="game-question">${escapeHtml(q.q)}</p>
      <div class="game-answers">
        ${q.a.map((ans, i) => `<button class="game-answer-btn" data-idx="${i}">${escapeHtml(ans)}</button>`).join("")}
      </div>
    `);
    
    modal.querySelectorAll(".game-answer-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        if (idx === q.correct) correct++;
        current++;
        if (current < questions.length) {
          closeModal();
          setTimeout(showQuestion, 50);
        } else {
          const reward = correct * 5;
          window.kov.showModal(`
            <button class="close" onclick="closeModal()">×</button>
            <h2>🏆 Результат</h2>
            <p>Правильно: ${correct} из ${questions.length}</p>
            <div class="game-win">Приз: ${reward} K</div>
          `);
        }
      });
    });
  }
  
  showQuestion();
}

// ============ КАЗИНО ============

function gameSlots() {
  const symbols = ["🍀", "💎", "🪙", "🏰", "🎃", "🧟"];
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>🎰 Слоты Ковчега</h2>
    <p class="card-sub">3 одинаковых = x10 ставки | 2 одинаковых = x3</p>
    <div class="game-balance">Баланс: <strong id="slot-balance">${balance}</strong> K</div>
    <div class="game-slots">
      <div class="slot-reel" id="s1">❓</div>
      <div class="slot-reel" id="s2">❓</div>
      <div class="slot-reel" id="s3">❓</div>
    </div>
    <div class="game-bet-row">
      <button class="btn btn-sm bet-btn" data-bet="5">5 K</button>
      <button class="btn btn-sm bet-btn" data-bet="10">10 K</button>
      <button class="btn btn-sm bet-btn" data-bet="25">25 K</button>
    </div>
    <div class="game-result" id="slots-result"></div>
  `);

  modal.querySelectorAll(".bet-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bet = Number(btn.dataset.bet);
      if (balance < bet) {
        modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Недостаточно K</div>`;
        return;
      }
      
      const reels = [modal.querySelector("#s1"), modal.querySelector("#s2"), modal.querySelector("#s3")];
      let spinning = true;
      
      const spinInterval = setInterval(() => {
        reels.forEach((r) => (r.textContent = symbols[Math.floor(Math.random() * symbols.length)]));
      }, 100);
      
      setTimeout(() => {
        clearInterval(spinInterval);
        const result = reels.map(() => symbols[Math.floor(Math.random() * symbols.length)]);
        reels.forEach((r, i) => (r.textContent = result[i]));
        
        let win = 0;
        if (result[0] === result[1] && result[1] === result[2]) win = bet * 10;
        else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) win = bet * 3;
        
        if (win > 0) {
          modal.querySelector("#slots-result").innerHTML = `<div class="game-win">🎉 Выигрыш: ${win} K!</div>`;
        } else {
          modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">😔 Не повезло. Ставка сгорела.</div>`;
        }
        spinning = false;
      }, 1500);
    });
  });
}

function gameRocket() {
  let multiplier = 1.0;
  let running = false;
  let crashed = false;
  let bet = 10;
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal(); crashed=true">×</button>
    <h2>🚀 Ракетка</h2>
    <p class="card-sub">Кэшаут до краха! Множитель растёт...</p>
    <div class="game-balance">Баланс: <strong id="rocket-balance">${balance}</strong> K</div>
    <div class="game-rocket-display">
      <div class="rocket-multiplier" id="rocket-mult">1.00x</div>
      <div class="rocket-visual">🚀</div>
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
      
      const crashPoint = 1.1 + Math.random() * 4; // 1.1x - 5.1x
      
      const interval = setInterval(() => {
        if (crashed) { clearInterval(interval); return; }
        multiplier += 0.05;
        multEl.textContent = multiplier.toFixed(2) + "x";
        
        if (multiplier >= crashPoint) {
          crashed = true;
          running = false;
          cashoutBtn.disabled = true;
          clearInterval(interval);
          multEl.textContent = "💥 " + multiplier.toFixed(2) + "x";
          resultEl.innerHTML = `<div class="game-lose">💥 Крах на ${multiplier.toFixed(2)}x! Ставка сгорела.</div>`;
        }
      }, 100);
      
      cashoutBtn.onclick = () => {
        if (!running || crashed) return;
        crashed = true;
        running = false;
        cashoutBtn.disabled = true;
        clearInterval(interval);
        const win = Math.floor(bet * multiplier);
        resultEl.innerHTML = `<div class="game-win">🚀 Кэшаут на ${multiplier.toFixed(2)}x! +${win} K</div>`;
      };
    });
  });
}

function gameDice() {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>🎲 Кубик удачи</h2>
    <p class="card-sub">Угадай чёт/нечёт или конкретное число!</p>
    <div class="game-balance">Баланс: <strong id="dice-balance">${balance}</strong> K</div>
    <div class="game-dice-display" id="dice-display">🎲</div>
    <div class="game-bet-row">
      <button class="btn btn-sm" id="dice-even">Чёт (x2)</button>
      <button class="btn btn-sm" id="dice-odd">Нечёт (x2)</button>
    </div>
    <div class="game-bet-row">
      ${[1,2,3,4,5,6].map(n => `<button class="btn btn-sm dice-num" data-num="${n}">${n} (x6)</button>`).join("")}
    </div>
    <div class="game-bet-amount">
      <label>Ставка:</label>
      <input type="number" id="dice-bet" value="10" min="1" class="input input-sm"/>
    </div>
    <div class="game-result" id="dice-result"></div>
  `);

  const display = modal.querySelector("#dice-display");
  const resultEl = modal.querySelector("#dice-result");
  
  async function roll(bet, predicate, multiplier) {
    const actualBet = Number(modal.querySelector("#dice-bet").value);
    if (balance < actualBet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    display.textContent = "🎲";
    let rolls = 0;
    const anim = setInterval(() => {
      display.textContent = ["⚀","⚁","⚂","⚃","⚄","⚅"][Math.floor(Math.random() * 6)];
      rolls++;
      if (rolls > 10) {
        clearInterval(anim);
        const final = Math.floor(Math.random() * 6) + 1;
        display.textContent = ["⚀","⚁","⚂","⚃","⚄","⚅"][final - 1];
        
        if (predicate(final)) {
          const win = actualBet * multiplier;
          resultEl.innerHTML = `<div class="game-win">🎉 Выпало ${final}! Выигрыш: ${win} K</div>`;
        } else {
          resultEl.innerHTML = `<div class="game-lose">😔 Выпало ${final}. Ставка сгорела.</div>`;
        }
      }
    }, 100);
  }

  modal.querySelector("#dice-even").addEventListener("click", () => roll(10, (n) => n % 2 === 0, 2));
  modal.querySelector("#dice-odd").addEventListener("click", () => roll(10, (n) => n % 2 === 1, 2));
  modal.querySelectorAll(".dice-num").forEach((btn) => {
    btn.addEventListener("click", () => {
      const num = Number(btn.dataset.num);
      roll(10, (n) => n === num, 6);
    });
  });
}

function gameWheelRisk() {
  const sectors = [
    { label: "x0", color: "#E55454", weight: 1 },
    { label: "x0.5", color: "#FF8A65", weight: 2 },
    { label: "x1", color: "#F2B33C", weight: 3 },
    { label: "x2", color: "#6BD995", weight: 2 },
    { label: "x5", color: "#6CB6FB", weight: 1 },
    { label: "x10", color: "#D387E5", weight: 0.5 },
  ];
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>🎯 Колесо риска</h2>
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
    btn.addEventListener("click", () => {
      const bet = Number(btn.dataset.bet);
      if (balance < bet) {
        resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
        return;
      }
      
      // Weighted random
      const totalWeight = sectors.reduce((s, sec) => s + sec.weight, 0);
      let rand = Math.random() * totalWeight;
      let chosen = sectors[0];
      for (const sec of sectors) {
        rand -= sec.weight;
        if (rand <= 0) { chosen = sec; break; }
      }
      
      const mult = parseFloat(chosen.label.replace("x", ""));
      const win = Math.floor(bet * mult);
      
      wheel.querySelectorAll(".risk-sector").forEach((s) => s.classList.remove("active"));
      const idx = sectors.indexOf(chosen);
      wheel.children[idx].classList.add("active");
      
      if (mult > 1) {
        resultEl.innerHTML = `<div class="game-win">🎉 ${chosen.label}! Выигрыш: ${win} K</div>`;
      } else if (mult === 1) {
        resultEl.innerHTML = `<div class="game-neutral">😐 x1. Ставка возвращена.</div>`;
      } else {
        resultEl.innerHTML = `<div class="game-lose">😔 ${chosen.label}. Ставка потеряна.</div>`;
      }
    });
  });
}

// ============ RENDER ============

export async function renderArcade(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  await fetchBalance();
  
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>Аркада</h1>
        <div class="subtitle">Игры и развлечения Ковчега</div>
      </div>
    </section>

    <h2 class="section-title">🎮 Мини-игры</h2>
    <p class="card-sub" style="margin: -8px 0 12px 4px">Зарабатывай K, играя!</p>
    
    <div class="game-grid">
      <div class="game-tile" data-game="moshonka">
        <div class="game-tile-icon">🌿</div>
        <div class="game-tile-title">Где Мошонка?</div>
        <div class="game-tile-desc">Угадай, где спрятался житель</div>
        <div class="game-tile-reward">💰 5-15 K</div>
      </div>
      <div class="game-tile" data-game="defend">
        <div class="game-tile-icon">🧱</div>
        <div class="game-tile-title">Защити стену</div>
        <div class="game-tile-desc">Отбивай волны зомби</div>
        <div class="game-tile-reward">💰 1 K/зомби</div>
      </div>
      <div class="game-tile" data-game="harvest">
        <div class="game-tile-icon">🎃</div>
        <div class="game-tile-title">Собери урожай</div>
        <div class="game-tile-desc">Собирай тыквы за время</div>
        <div class="game-tile-reward">💰 2 K/тыква</div>
      </div>
      <div class="game-tile" data-game="quiz">
        <div class="game-tile-icon">📚</div>
        <div class="game-tile-title">Викторина</div>
        <div class="game-tile-desc">Проверь знания о Ковчеге</div>
        <div class="game-tile-reward">💰 5 K/ответ</div>
      </div>
    </div>

    <h2 class="section-title">🎰 Казино</h2>
    <p class="card-sub" style="margin: -8px 0 12px 4px">Испытай удачу! Баланс: <strong>${balance} K</strong></p>
    
    <div class="game-grid">
      <div class="game-tile casino" data-game="slots">
        <div class="game-tile-icon">🎰</div>
        <div class="game-tile-title">Слоты Ковчега</div>
        <div class="game-tile-desc">3 одинаковых = x10</div>
        <div class="game-tile-reward">🎲 Ставь и крути</div>
      </div>
      <div class="game-tile casino" data-game="rocket">
        <div class="game-tile-icon">🚀</div>
        <div class="game-tile-title">Ракетка</div>
        <div class="game-tile-desc">Кэшаут до краха</div>
        <div class="game-tile-reward">🎲 До x50</div>
      </div>
      <div class="game-tile casino" data-game="dice">
        <div class="game-tile-icon">🎲</div>
        <div class="game-tile-title">Кубик</div>
        <div class="game-tile-desc">Чёт/нечёт или число</div>
        <div class="game-tile-reward">🎲 x2 или x6</div>
      </div>
      <div class="game-tile casino" data-game="wheel">
        <div class="game-tile-icon">🎯</div>
        <div class="game-tile-title">Колесо риска</div>
        <div class="game-tile-desc">От x0 до x10</div>
        <div class="game-tile-reward">🎲 Крути колесо</div>
      </div>
    </div>
  `;
  
  const games = {
    moshonka: gameWhereIsMoshonka,
    defend: gameDefendWall,
    harvest: gameHarvest,
    quiz: gameQuiz,
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
