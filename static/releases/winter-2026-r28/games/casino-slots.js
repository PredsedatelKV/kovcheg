const LINES = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2], [0,0,1,2,2], [2,2,1,0,0],
  [1,0,1,2,1], [1,2,1,0,1],
];
const SYMBOLS = {C:"🍒", L:"🍋", G:"🍇", D:"💎", S:'<b class="casino-seven">7</b>', W:'<b class="slot-wild">WILD</b>'};
const LABELS = {C:"Вишни", L:"Лимон", G:"Виноград", D:"Алмаз", S:"Семёрка", W:"Wild"};
const START = [["L","C","G"],["G","D","C"],["C","S","L"],["L","W","G"],["G","C","D"]];
const KEYS = Object.keys(SYMBOLS);
const AMOUNTS = new Intl.NumberFormat("ru");
const randomSymbol = () => KEYS[Math.floor(Math.random() * KEYS.length)];
const cell = (id) => '<span data-slot-symbol="' + id + '" aria-label="' + LABELS[id] + '">' + SYMBOLS[id] + '</span>';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SLOT_RULES =
  "<li>Всегда играют 9 линий. Нужно собрать от трёх одинаковых знаков слева направо. WILD заменяет знак, кроме первой колонки.</li>" +
  "<li>Все выигрышные линии складываются. Выпавший ×2 или ×3 умножает общую выплату. Пять семёрок на линии с учётом WILD дают джекпот.</li>" +
  "<li>Бонус расходуется первым и действует только в слотах. Выплаты со спинов поступают на баланс казино.</li>";
const PAYTABLE = [
  ["🍒",30,100,240], ["🍋",32,110,280], ["🍇",45,150,360], ["💎",75,225,650], ["7",100,400,1600],
];
export const SLOT_PAYTABLE = '<table class="slot-paytable"><caption>Выплата по линии в процентах от ставки</caption>' +
  '<thead><tr><th>Знак</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>' +
  PAYTABLE.map((row) => '<tr>' + row.map((value, i) => i ? '<td>' + value + '%</td>' : '<th>' + value + '</th>').join("") + '</tr>').join("") +
  '</tbody></table>';

export function slotsBoard() {
  return '<div class="casino-slot"><div class="casino-slot-crown"><span></span><b>✦</b><span></span><b class="slot-multiplier" data-slot-multiplier hidden aria-hidden="true"></b></div>' +
    '<div class="casino-reels" aria-label="Пять барабанов">' + START.map((column) =>
      '<div class="casino-reel"><div class="casino-reel-strip">' + column.map(cell).join("") + '</div></div>'
    ).join("") + '<canvas class="slot-lines" width="640" height="360" aria-hidden="true"></canvas></div>' +
    '<div class="casino-slot-base"><span>9 линий</span><span data-slot-tally></span></div></div>';
}

export function slotsBonus() {
  return '<div class="slot-bonus" data-slot-bonus hidden role="status"><span aria-hidden="true">🎁</span>' +
    '<div><strong>Ваш бонус · 1 000 К</strong><small>Доступен для игры в слотах</small></div>' +
    '<button type="button" data-dismiss-slot-bonus aria-label="Закрыть сообщение">×</button></div>';
}

function paintLines(canvas, wins) {
  const ctx = canvas.getContext("2d");
  const {width, height} = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const colors = ["#dba24f", "#66c7b6", "#7cabf7", "#e480a8", "#ccb3fb"];
  wins.forEach((win, index) => {
    const line = LINES[win.line - 1];
    ctx.beginPath();
    line.slice(0, win.count).forEach((row, col) => {
      const x = width * (col + .5) / 5;
      const y = height * (row + .69) / 3;
      if (col) ctx.lineTo(x,y);
      else ctx.moveTo(x,y);
    });
    ctx.strokeStyle = "#2d1721a0";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = colors[index % colors.length];
    ctx.lineWidth = 5;
    ctx.stroke();
  });
}

export async function spinSlots(board, outcome, animate, sound) {
  const strips = [...board.querySelectorAll(".casino-reel-strip")];
  const canvas = board.querySelector(".slot-lines");
  const badge = board.querySelector("[data-slot-multiplier]");
  const tally = board.querySelector("[data-slot-tally]");
  paintLines(canvas, []);
  badge.hidden = true;
  tally.textContent = "";
  if (animate) sound.play("reel", {level:.85});
  strips.forEach((strip, index) => {
    const current = [...strip.children].slice(-3).map((item) => item.dataset.slotSymbol);
    const filler = animate ? Array.from({length: 12 + index * 2}, randomSymbol) : [];
    const next = outcome.grid[index];
    strip.style.transition = "none";
    strip.style.transform = "none";
    strip.innerHTML = current.concat(filler, next).map(cell).join("");
    const offset = 100 * (filler.length + 3) / strip.children.length;
    void strip.offsetHeight;
    const duration = 1120 + index * 230;
    strip.style.transition = animate ? "transform " + duration + "ms cubic-bezier(.15,.63,.26,1)" : "none";
    strip.style.transform = "translate3d(0," + (-offset) + "%,0)";
    if (animate || index === 4) sound.play("stop", {delay: animate ? duration / 1000 : 0, rate: 1.12 - index * .075});
    strip.parentElement.setAttribute("aria-label", next.map((id) => LABELS[id]).join(", "));
  });
  if (animate) await wait(2050);
  paintLines(canvas, outcome.wins);
  if (outcome.wins.length) {
    tally.textContent = "Линии: " + outcome.wins.map((win) => win.line).join(", ");
  }
  if (outcome.multiplier > 1) {
    badge.textContent = "×" + AMOUNTS.format(outcome.multiplier);
    badge.hidden = false;
    if (animate) sound.play("stop", {level:.76, rate:1.36});
  }
  board.classList.toggle("slot-jackpot", outcome.jackpot);
}
