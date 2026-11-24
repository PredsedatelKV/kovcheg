const LINES = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2], [0,0,1,2,2], [2,2,1,0,0],
  [1,0,1,2,1], [1,2,1,0,1],
];
const SYMBOLS = {C:"🍒", L:"🍋", G:"🍇", D:"💎", S:'<b class="casino-seven">7</b>', W:'<b class="slot-wild">WILD</b>'};
const LABELS = {C:"Вишни", L:"Лимон", G:"Виноград", D:"Алмаз", S:"Семёрка", W:"Wild"};
const START = [["L","C","G"],["G","D","C"],["C","S","L"],["L","W","G"],["G","C","D"]];
const KEYS = Object.keys(SYMBOLS);
const STOPS = [2020, 2430, 2820, 3290, 3780];
const randomSymbol = () => KEYS[Math.floor(Math.random() * KEYS.length)];
const cell = (id) => '<span class="slot-symbol" data-slot-symbol="' + id + '" aria-label="' + LABELS[id] +
  '"><span class="slot-icon">' + SYMBOLS[id] + '</span></span>';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SLOT_RULES = [
  ["🎰", "Крути барабаны", "Выбери ставку. Если на линии совпали хотя бы три символа подряд с первого барабана, получишь выплату. Линии бывают прямыми и зигзагом."],
  ["✨", "Лови WILD", "Он заменяет недостающий символ. Выиграло сразу несколько линий? Их выплаты складываются. Нажми на линию под полем, чтобы рассмотреть совпадение."],
  ["↻", "Запусти серию", "Выбери от 1 до 20 вращений с одной ставкой. Стоп отменит оставшиеся, а начатое завершится. После джекпота серия остановится сама. Бонусы тратятся первыми."],
];

export function slotsBoard() {
  return '<div class="casino-slot"><div class="casino-slot-crown"><span></span><b aria-hidden="true">✦</b><span></span>' +
    '<b class="slot-multiplier" data-slot-multiplier hidden></b></div>' +
    '<div class="casino-reels" aria-label="Пять барабанов">' + START.map((column) =>
      '<div class="casino-reel"><div class="casino-reel-strip">' + column.map(cell).join("") + '</div></div>'
    ).join("") + '</div><div class="casino-slot-base"><div class="slot-wins" data-slot-wins hidden></div></div></div>';
}

export function slotsBonus() {
  return '<section class="slot-bonus" data-slot-bonus hidden aria-labelledby="slots-gift-title">' +
    '<span class="slot-bonus-gift" aria-hidden="true">🎁</span>' +
    '<div><strong id="slots-gift-title">Подарок для слотов</strong><small>1 000 К на бонусный счёт</small></div>' +
    '<button class="casino-play" type="button" data-claim-slot-bonus>Забрать</button>' +
    '<p data-slot-bonus-error role="status"></p></section>';
}

function showLines(board, wins, motion) {
  const bar = board.querySelector("[data-slot-wins]");
  if (!wins.length) return;
  const strips = [...board.querySelectorAll(".casino-reel-strip")];
  const cells = [...board.querySelectorAll(".slot-symbol")];

  function highlight(selected, animated) {
    cells.forEach((node) => node.classList.remove("slot-match"));
    for (const win of selected) {
      LINES[win.line - 1].slice(0, win.count).forEach((row, column) => {
        strips[column].children[row].classList.add("slot-match");
      });
    }
    board.classList.toggle("slot-shimmer", animated);
  }

  highlight(wins, motion);
  if (wins.length === 1) {
    bar.textContent = "Линия " + wins[0].line + " · " + LABELS[wins[0].symbol] + " ×" + wins[0].count;
  } else {
    const choices = [["Все", wins], ...wins.map((win) => ["Линия " + win.line, [win]])];
    choices.forEach(([label, selected], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(index === 0));
      button.addEventListener("click", () => {
        bar.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-pressed", "true");
        highlight(selected, false);
      });
      bar.append(button);
    });
  }
  bar.hidden = false;
}

async function animateReel(strip, next, index, animate, sound) {
  const reel = strip.parentElement;
  if (animate) {
    const current = [...strip.children].map((item) => item.dataset.slotSymbol);
    const filler = Array.from({length: 18 + index * 4}, randomSymbol);
    strip.innerHTML = current.concat(filler, next).map(cell).join("");
    reel.classList.remove("slot-landed");
    reel.classList.add("slot-spinning");
    const travel = 100 * (filler.length + 3) / strip.children.length;
    const duration = STOPS[index];
    sound.play("slot-stop", {delay:duration / 1000, level:.50 + .06 * index, rate:1.10 - index * .065});
    if (strip.animate) {
      const animation = strip.animate([
        {transform:"translateY(0)", easing:"cubic-bezier(.34,.65,.58,1)", offset:0},
        {transform:"translateY(" + (-travel * .84) + "%)", easing:"cubic-bezier(.12,.53,.28,1)", offset:.73},
        {transform:"translateY(" + (-travel) + "%)", offset:1},
      ], {duration,fill:"forwards"});
      await animation.finished.catch(() => {});
      animation.cancel();
    } else await wait(duration);
    reel.classList.remove("slot-spinning");
    reel.classList.add("slot-landed");
  }
  strip.innerHTML = next.map(cell).join("");
  reel.setAttribute("aria-label", next.map((id) => LABELS[id]).join(", "));
}

export async function spinSlots(board, outcome, animate, sound) {
  const strips = [...board.querySelectorAll(".casino-reel-strip")];
  const bar = board.querySelector("[data-slot-wins]");
  const badge = board.querySelector("[data-slot-multiplier]");
  bar.replaceChildren();
  bar.hidden = true;
  badge.hidden = true;
  board.classList.remove("slot-jackpot", "slot-shimmer");
  board.classList.toggle("slot-turning", animate);
  if (animate) sound.play("reel", {level:.64, duration:STOPS.at(-1) / 1000});
  await Promise.all(strips.map((strip, index) => animateReel(strip, outcome.grid[index], index, animate, sound)));
  board.classList.remove("slot-turning");
  showLines(board, outcome.wins, animate);
  if (outcome.multiplier > 1) {
    badge.textContent = "×" + outcome.multiplier;
    badge.hidden = false;
  }
  board.classList.toggle("slot-jackpot", outcome.jackpot);
}
