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

// ============ МИНИ-ИГРЫ ============

function gameWhereIsMoshonka() {
  let found = false;
  const moshonkaPos = Math.floor(Math.random() * 3);
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Где Мошонка?</h2>
    <p class="card-sub">Мошонка спрятался за одним из кустов. Угадай где! Приз: 3-8 K</p>
    <div class="game-bushes">
      <button class="game-bush" data-bush="0"><img src="/static/img/ui/bush.svg" alt="" class="game-icon"/></button>
      <button class="game-bush" data-bush="1"><img src="/static/img/ui/bush.svg" alt="" class="game-icon"/></button>
      <button class="game-bush" data-bush="2"><img src="/static/img/ui/bush.svg" alt="" class="game-icon"/></button>
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
        if (i === moshonkaPos) b.innerHTML = '<img src="/static/img/ui/villager.svg" alt="" class="game-icon"/>';
        else b.innerHTML = '<img src="/static/img/ui/cross.svg" alt="" class="game-icon"/>';
      });
      
      found = true;
      if (chosen === moshonkaPos) {
        const reward = 3 + Math.floor(Math.random() * 6);
        try {
          await post("/api/arcade/win", { amount: reward });
          balance += reward;
          result.innerHTML = `<div class="game-win">Угадал! Мошонка доволен. +${reward} K</div>`;
        } catch (_) {
          result.innerHTML = `<div class="game-win">Угадал! (Демо режим) +${reward} K</div>`;
        }
      } else {
        result.innerHTML = `<div class="game-lose">Мимо! Мошонка был за кустом ${moshonkaPos + 1}</div>`;
      }
    });
  });
}

// НОВАЯ ИГРА: Копай глубже — кликай по блокам, находи руды
function gameDigDeep() {
  let score = 0;
  let clicksLeft = 12;
  const grid = [];
  const ores = [
    { icon: "coal", value: 1, chance: 0.35 },
    { icon: "iron", value: 2, chance: 0.25 },
    { icon: "gold", value: 4, chance: 0.15 },
    { icon: "diamond", value: 8, chance: 0.08 },
    { icon: "stone", value: 0, chance: 0.17 },
  ];
  
  function pickOre() {
    let r = Math.random();
    for (const ore of ores) {
      r -= ore.chance;
      if (r <= 0) return ore;
    }
    return ores[ores.length - 1];
  }
  
  for (let i = 0; i < 16; i++) grid.push(pickOre());
  
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Копай глубже!</h2>
    <p class="card-sub">Копай блоки, находи руды! Осталось: <strong id="dig-clicks">${clicksLeft}</strong> | Нашёл: <strong id="dig-score">0</strong> K</p>
    <div class="game-dig-grid" id="dig-grid">
      ${grid.map((_, i) => `<button class="dig-block" data-idx="${i}"><img src="/static/img/ui/stone_block.svg" alt="" class="game-icon"/></button>`).join("")}
    </div>
    <div class="game-result" id="dig-result"></div>
  `);

  modal.querySelectorAll(".dig-block").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (clicksLeft <= 0 || btn.disabled) return;
      const idx = Number(btn.dataset.idx);
      const ore = grid[idx];
      
      btn.disabled = true;
      btn.innerHTML = `<img src="/static/img/ui/${ore.icon}.svg" alt="" class="game-icon"/>`;
      btn.classList.add("revealed");
      
      if (ore.value > 0) {
        score += ore.value;
        clicksLeft--;
        modal.querySelector("#dig-score").textContent = score;
        modal.querySelector("#dig-clicks").textContent = clicksLeft;
      } else {
        clicksLeft--;
        modal.querySelector("#dig-clicks").textContent = clicksLeft;
      }
      
      if (clicksLeft <= 0) {
        try {
          await post("/api/arcade/win", { amount: score });
          balance += score;
          modal.querySelector("#dig-result").innerHTML = `<div class="game-win">Копание завершено! Нашёл: ${score} K</div>`;
        } catch (_) {
          modal.querySelector("#dig-result").innerHTML = `<div class="game-win">Копание завершено! (Демо) +${score} K</div>`;
        }
      }
    });
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
      pumpkin.remove();
    });
    field.appendChild(pumpkin);
    setTimeout(() => pumpkin.remove(), 1500);
  }

  const spawnInterval = setInterval(spawnPumpkin, 600);
  
  gameInterval = setInterval(() => {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      clearInterval(spawnInterval);
      const reward = score;
      try {
        post("/api/arcade/win", { amount: reward }).catch(() => {});
        balance += reward;
      } catch (_) {}
      modal.querySelector("#harvest-result").innerHTML = 
        `<div class="game-win">Урожай собран! Тыкв: ${score}. Приз: ${reward} K</div>`;
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
      <h2>Викторина Ковчега</h2>
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
          const reward = correct * 3;
          try {
            post("/api/arcade/win", { amount: reward }).catch(() => {});
            balance += reward;
          } catch (_) {}
          window.kov.showModal(`
            <button class="close" onclick="closeModal()">×</button>
            <h2>Результат</h2>
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

  async function spin(bet) {
    if (balance < bet) {
      modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    try {
      await post("/api/arcade/bet", { amount: bet });
      balance -= bet;
    } catch (_) {
      modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Не удалось сделать ставку</div>`;
      return;
    }
    
    updateBalanceDisplay("slot-balance", balance);
    const reels = [modal.querySelector("#s1"), modal.querySelector("#s2"), modal.querySelector("#s3")];
    
    let spinning = true;
    const spinInterval = setInterval(() => {
      reels.forEach((r) => {
        const sym = pickSymbol();
        r.innerHTML = `<img src="/static/img/ui/${sym.icon}.svg" alt="" class="game-icon"/>`;
      });
    }, 100);
    
    setTimeout(() => {
      clearInterval(spinInterval);
      const result = [pickSymbol(), pickSymbol(), pickSymbol()];
      reels.forEach((r, i) => {
        r.innerHTML = `<img src="/static/img/ui/${result[i].icon}.svg" alt="" class="game-icon"/>`;
      });
      
      let win = 0;
      if (result[0].icon === result[1].icon && result[1].icon === result[2].icon) {
        win = bet * 8;
      } else if (result[0].icon === result[1].icon || result[1].icon === result[2].icon || result[0].icon === result[2].icon) {
        win = bet * 2;
      }
      
      if (win > 0) {
        try { post("/api/arcade/win", { amount: win }).catch(() => {}); } catch (_) {}
        balance += win;
        updateBalanceDisplay("slot-balance", balance);
        modal.querySelector("#slots-result").innerHTML = `<div class="game-win">Выигрыш: ${win} K!</div>`;
      } else {
        modal.querySelector("#slots-result").innerHTML = `<div class="game-lose">Не повезло. Ставка сгорела.</div>`;
      }
    }, 1500);
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
      <div class="rocket-visual"><img src="/static/img/ui/rocket.svg" alt="" class="game-icon-lg"/></div>
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
      
      // House edge: crash point weighted towards low values
      const crashPoint = 1.05 + Math.random() * 2.5; // 1.05x - 3.55x average
      
      const interval = setInterval(() => {
        if (crashed) { clearInterval(interval); return; }
        multiplier += 0.02;
        multEl.textContent = multiplier.toFixed(2) + "x";
        
        if (multiplier >= crashPoint) {
          crashed = true;
          running = false;
          cashoutBtn.disabled = true;
          clearInterval(interval);
          multEl.textContent = "💥 " + multiplier.toFixed(2) + "x";
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
        try { await post("/api/arcade/win", { amount: win }); } catch (_) {}
        balance += win;
        updateBalanceDisplay("rocket-balance", balance);
        resultEl.innerHTML = `<div class="game-win">Кэшаут на ${multiplier.toFixed(2)}x! +${win} K</div>`;
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
    <div class="game-dice-display" id="dice-display"><img src="/static/img/ui/dice.svg" alt="" class="game-icon-lg"/></div>
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
  const diceIcons = ["⚀","⚁","⚂","⚃","⚄","⚅"];
  
  async function roll(predicate, multiplier) {
    const actualBet = Number(modal.querySelector("#dice-bet").value);
    if (balance < actualBet) {
      resultEl.innerHTML = `<div class="game-lose">Недостаточно K</div>`;
      return;
    }
    
    try {
      await post("/api/arcade/bet", { amount: actualBet });
      balance -= actualBet;
    } catch (_) {
      resultEl.innerHTML = `<div class="game-lose">Не удалось сделать ставку</div>`;
      return;
    }
    
    updateBalanceDisplay("dice-balance", balance);
    display.textContent = "🎲";
    let rolls = 0;
    const anim = setInterval(() => {
      display.textContent = diceIcons[Math.floor(Math.random() * 6)];
      rolls++;
      if (rolls > 10) {
        clearInterval(anim);
        const final = Math.floor(Math.random() * 6) + 1;
        display.textContent = diceIcons[final - 1];
        
        if (predicate(final)) {
          const win = Math.floor(actualBet * multiplier);
          try { await post("/api/arcade/win", { amount: win }); } catch (_) {}
          balance += win;
          updateBalanceDisplay("dice-balance", balance);
          resultEl.innerHTML = `<div class="game-win">Выпало ${final}! Выигрыш: ${win} K</div>`;
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
      
      try {
        await post("/api/arcade/bet", { amount: bet });
        balance -= bet;
      } catch (_) {
        resultEl.innerHTML = `<div class="game-lose">Не удалось сделать ставку</div>`;
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
        try { await post("/api/arcade/win", { amount: win }); } catch (_) {}
        balance += win;
        updateBalanceDisplay("wheel-balance", balance);
        resultEl.innerHTML = `<div class="game-win">${chosen.label}! Выигрыш: ${win} K</div>`;
      } else if (mult === 1) {
        try { await post("/api/arcade/win", { amount: bet }); } catch (_) {}
        balance += bet;
        updateBalanceDisplay("wheel-balance", balance);
        resultEl.innerHTML = `<div class="game-neutral">x1. Ставка возвращена.</div>`;
      } else {
        resultEl.innerHTML = `<div class="game-lose">${chosen.label}. Ставка потеряна.</div>`;
      }
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
      <div class="game-tile" data-game="dig">
        <div class="game-tile-icon"><img src="/static/img/ui/pickaxe.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Копай глубже</div>
        <div class="game-tile-desc">Находи руды в блоках</div>
        <div class="game-tile-reward">до 96 K</div>
      </div>
      <div class="game-tile" data-game="harvest">
        <div class="game-tile-icon"><img src="/static/img/ui/pumpkin.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Собери урожай</div>
        <div class="game-tile-desc">Собирай тыквы за время</div>
        <div class="game-tile-reward">1 K/тыква</div>
      </div>
      <div class="game-tile" data-game="quiz">
        <div class="game-tile-icon"><img src="/static/img/ui/book.svg" alt="" class="game-icon-lg"/></div>
        <div class="game-tile-title">Викторина</div>
        <div class="game-tile-desc">Проверь знания о Ковчеге</div>
        <div class="game-tile-reward">3 K/ответ</div>
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
    dig: gameDigDeep,
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
