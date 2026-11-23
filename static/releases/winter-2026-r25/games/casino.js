import { get, newIdempotencyKey, post } from "../api.js";
import { getSettings, playUISound, useGameMusic } from "../pages/settings.js";

const MINIMUM = 100;
const MAXIMUM = 10000;
const NUMBER = new Intl.NumberFormat("ru");
const GAMES = {
  slots: {name: "Слоты", subtitle: "Три барабана", action: "Крутить барабаны"},
  roulette: {name: "Рулетка", subtitle: "Девять секторов", action: "Крутить рулетку"},
  rocket: {name: "Ракетка", subtitle: "Множитель в полёте", action: "Запустить"},
  dice: {name: "Кубик", subtitle: "Бросок на сукне", action: "Бросить кубик"},
  riskwheel: {name: "Ва-банк", subtitle: "Колесо множителей", action: "Крутить колесо"},
};
const SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
const SYMBOL_NAMES = ["Вишни", "Лимон", "Апельсин", "Виноград", "Звезда", "Алмаз", "Семёрка"];
const WHEEL_LABELS = {
  roulette: ["10", "20", "30", "40", "50", "100", "200", "500", "1 000"],
  riskwheel: ["×0,05", "×0,25", "×0,5", "×0,75", "×1", "×1,5", "×2", "×2,5", "×3"],
};
const CHOICES = [["even", "Чёт"], ["odd", "Нечёт"], ["low", "1–3"], ["high", "4–6"]];
const PIPS = [[], [4], [0,8], [0,4,8], [0,2,6,8], [0,2,4,6,8], [0,2,3,5,6,8]];
const CHROME = {
  back: '<path d="m14 5-7 7 7 7M7 12h13"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12 0a5 5 0 0 1 0 6m2-8a8 8 0 0 1 0 10"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12 1 5 5m0-5-5 5"/>',
};
const glyph = (name) => '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + CHROME[name] + '</svg>';
const money = (value) => NUMBER.format(value);
const multiplier = (value) => "×" + Number(value).toFixed(2).replace(".", ",");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomSymbol = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
const numberSymbol = (symbol) => symbol === "7️⃣" ? '<b class="casino-seven">7</b>' : symbol;
const dieFace = (value) => PIPS[value].map((pip) => '<i style="grid-column:' + (pip % 3 + 1) +
  ';grid-row:' + (Math.floor(pip / 3) + 1) + '"></i>').join("");

const RULES = {
  slots: "<li>Три премиальных символа одного вида (7 или 💎) — ×5</li><li>Три остальных символа одного вида — ×3</li><li>Две одинаковые премиальные — ×2</li><li>Две одинаковые обычные — возврат ставки</li>",
  roulette: "<li>Фиксированная ставка 100 К. Число на секторе — выплата в ковбаксах.</li>",
  rocket: "<li>Множитель растёт после запуска. Нажмите «Забрать» до остановки полёта.</li><li>Сервер фиксирует множитель в момент получения запроса.</li>",
  dice: "<li>Чёт, нечёт или диапазон — ×1,8 при попадании.</li><li>Точное число — ×5,4 при попадании.</li>",
  riskwheel: "<li>Выплата равна ставке, умноженной на число под стрелкой.</li><li>×1 возвращает ставку. Сектор меньше ×1 возвращает её часть.</li>",
};

function artwork(game) {
  if (game === "slots") return '<div class="casino-art-slots"><b>7</b><b>7</b><b>7</b></div>';
  if (game === "dice") return '<div class="casino-art-die">' + dieFace(5) + '</div>';
  if (game === "rocket") return '<div class="casino-art-rocket"><svg viewBox="0 0 120 74" fill="none"><path d="M3 69h114M3 49h114M3 29h114M3 9h114" stroke="#71e0c326"/><path d="M4 68c35-5 75-20 108-59m0 0-18 5m18-5-1 19" stroke="#9de8d0" stroke-width="3.5" stroke-linecap="round"/></svg></div>';
  return '<div class="casino-art-wheel"><i></i></div>';
}

function gameBoard(game) {
  if (game === "slots") {
    return '<div class="casino-slot"><div class="casino-slot-crown"><span></span><b>✦</b><span></span></div><div class="casino-reels" aria-label="Три барабана">' +
      [0,1,2].map((index) => '<div class="casino-reel"><div class="casino-reel-strip">' +
        [SYMBOLS[index + 1], SYMBOLS[index * 3], SYMBOLS[index + 2]].map((s) => '<span>' + numberSymbol(s) + '</span>').join("") +
      '</div></div>').join("") + '</div><div class="casino-slot-base"></div></div>';
  }
  if (game === "roulette" || game === "riskwheel") {
    return '<div class="casino-wheel"><canvas width="660" height="660" aria-label="Сектора колеса"></canvas><i class="casino-pointer"></i></div>';
  }
  if (game === "dice") return '<div class="casino-dice-tray"><div class="casino-die" aria-label="Кубик">' + dieFace(5) + '</div></div>';
  return '<div class="casino-flight"><canvas width="840" height="380" aria-hidden="true"></canvas><strong data-multiplier>×1,00</strong></div>';
}

function paintWheel(canvas, game) {
  const ctx = canvas.getContext("2d");
  const labels = WHEEL_LABELS[game];
  const center = canvas.width / 2;
  const step = 2 * Math.PI / labels.length;
  ctx.translate(center, center);
  ctx.beginPath();
  ctx.arc(0, 0, 326, 0, Math.PI * 2);
  const brass = ctx.createLinearGradient(-250,-240,250,290);
  brass.addColorStop(0, "#a5713c");
  brass.addColorStop(.28, "#f5dc9f");
  brass.addColorStop(.48, "#8b5228");
  brass.addColorStop(.72, "#dfb675");
  brass.addColorStop(1, "#744221");
  ctx.fillStyle = brass;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 313, 0, Math.PI * 2);
  ctx.fillStyle = "#261711";
  ctx.fill();
  labels.forEach((label, index) => {
    const angle = -Math.PI / 2 + index * step;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 298, angle - step / 2, angle + step / 2);
    ctx.closePath();
    const sector = ctx.createRadialGradient(0, 0, 50, 0, 0, 298);
    sector.addColorStop(0, "#11161b");
    const colors = game === "roulette" ? ["#811e34", "#262425"] : ["#493933", "#703047", "#28334c"];
    sector.addColorStop(1, index === labels.length - 1 ? "#23684e" : colors[index % colors.length]);
    ctx.fillStyle = sector;
    ctx.fill();
    ctx.strokeStyle = "#ae8856";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.rotate(index * step);
    ctx.fillStyle = "#fff1d8";
    ctx.font = (label.length > 4 ? "bold 32px" : "bold 37px") + " system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -224);
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(0, 0, 87, 0, 2 * Math.PI);
  ctx.fillStyle = brass;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, 2 * Math.PI);
  ctx.fillStyle = "#2a211e";
  ctx.fill();
  ctx.font = "50px Georgia";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#efce92";
  ctx.fillText(game === "roulette" ? "♠" : "✦", 0, 2);
}

function paintFlight(board, value, crashed = false) {
  const canvas = board.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const {width, height} = canvas;
  const fraction = Math.max(0, Math.min(1, (value - 1) / 4));
  const x = 55 + (width - 90) * Math.sqrt(fraction);
  const y = height - 38 - (height - 70) * fraction;
  const color = crashed ? "#ee8b91" : "#91e7ce";
  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle = "#82d2c023";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let row = 33; row < height; row += 51) { ctx.moveTo(0,row); ctx.lineTo(width,row); }
  for (let col = 56; col < width; col += 70) { ctx.moveTo(col,0); ctx.lineTo(col,height); }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(55, height - 38);
  ctx.quadraticCurveTo(55 + (x - 55) * .64, height - 38, x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  board.querySelector("[data-multiplier]").textContent = multiplier(value);
  board.classList.toggle("is-crashed", crashed);
}

function renderChoice() {
  const choices = CHOICES.concat([1,2,3,4,5,6].map((value) => [String(value), String(value)]));
  return '<fieldset class="casino-choices"><legend>Что выпадет</legend>' +
    choices.map(([id, label]) => '<button type="button" data-choice="' + id + '" aria-pressed="false">' + label + '</button>').join("") + '</fieldset>';
}

export function openCasino(lifecycle, initialGame) {
  const dialog = window.kov.showModal('<div class="casino-surface"><header class="casino-toolbar"></header><main class="casino-content"></main></div>', {label: "Казино"});
  dialog.classList.add("casino-modal");
  dialog.parentElement.classList.add("casino-overlay");
  document.documentElement.classList.add("casino-active");

  const surface = dialog.querySelector(".casino-surface");
  const header = dialog.querySelector(".casino-toolbar");
  const content = dialog.querySelector(".casino-content");
  const music = useGameMusic(new URL("../media/casino/lounge.mp3", import.meta.url).href);
  const shortMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const prefix = "/api/arcade";
  let musicMuted = false;
  let mounted = true;
  let game = null;
  let balance = null;
  let accountKey = "";
  let amount = MINIMUM;
  let choice = "";
  let pending = null;
  let active = false;
  let mode = "idle";
  let rotation = 0;
  let timer;
  let pollGeneration = 0;
  let hallScroll = 0;

  function muteButton() {
    const button = header.querySelector("[data-sound]");
    const globallyPaused = getSettings().musicPaused;
    button.disabled = globallyPaused;
    button.title = globallyPaused ? "Музыка выключена в настройках Ковчега" : musicMuted ? "Включить музыку" : "Выключить музыку";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = glyph(musicMuted || globallyPaused ? "mute" : "sound");
  }

  function showBalance(value) {
    if (value != null) balance = value;
    header.querySelector("[data-wallet]").textContent = balance == null ? "—" : money(balance) + " К";
    if (value != null) lifecycle.updateBalance(value);
  }

  function setMode(next) {
    mode = next;
    active = next === "busy" || next === "flying" || next === "settling";
    lifecycle.setLocked(active);
    header.querySelector("[data-back]").disabled = active;
    const action = content.querySelector("[data-play]");
    if (!action) return;
    const ready = balance != null && balance >= MINIMUM && (game !== "dice" || choice !== "");
    action.disabled = next === "idle" ? !ready : next === "busy" || next === "settling";
    action.textContent = {
      flying: "Забрать", retry: "Восстановить раунд", busy: "Раунд идёт…", settling: "Расчёт…",
    }[next] || GAMES[game].action;
    content.querySelectorAll("[data-choice], [data-amount], [data-stake]").forEach((node) => {
      node.disabled = next !== "idle";
    });
  }

  function message(text, type = "") {
    const status = content.querySelector("[data-status]");
    status.textContent = text;
    status.dataset.type = type;
  }

  function saveRound(round) {
    pending = round;
    if (!accountKey) return;
    try {
      if (round?.token || round?.requestId) sessionStorage.setItem(accountKey, JSON.stringify(round));
      else sessionStorage.removeItem(accountKey);
    } catch (_) {}
  }

  function stopPolling() {
    clearTimeout(timer);
    pollGeneration += 1;
  }

  function drawHall() {
    content.innerHTML = '<section class="casino-lobby"><div class="casino-lobby-sign"><span aria-hidden="true">♠</span></div>' +
      '<h1>Казино</h1><div class="casino-tables">' +
      Object.entries(GAMES).map(([id, item]) => '<button type="button" class="casino-table casino-' + id +
        '" data-game="' + id + '"><div class="casino-table-copy"><strong>' + item.name + '</strong><small>' +
        item.subtitle + '</small></div>' + artwork(id) + '<span class="casino-table-next">' + glyph("next") + '</span></button>').join("") +
      '</div><details class="casino-rules casino-credits"><summary>Музыка и фото</summary>' +
      '<p><a href="https://www.pexels.com/photo/slot-machines-3021120/" target="_blank" rel="noopener noreferrer">Darya Sannikova, Pexels</a></p>' +
      '<p><a href="https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1700068" target="_blank" rel="noopener noreferrer">Backbay Lounge, Kevin MacLeod</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p></details></section>';
    content.scrollTop = hallScroll;
  }

  function drawTable() {
    const fixed = game === "roulette";
    const stake = fixed ? '<div class="casino-fixed">100 <small>К за вращение</small></div>' :
      '<div class="casino-stake"><label for="casino-stake">Ставка</label><div><button type="button" data-amount="-100" aria-label="Уменьшить ставку на 100">−</button>' +
      '<input data-stake id="casino-stake" name="casino-stake" type="number" inputmode="numeric" step="1" min="100" max="10000" value="' + amount + '">' +
      '<button type="button" data-amount="100" aria-label="Увеличить ставку на 100">+</button></div></div>';
    content.innerHTML = '<section class="casino-game casino-' + game + '"><h1>' + GAMES[game].name +
      '</h1><div class="casino-board">' + gameBoard(game) + '</div>' +
      '<p data-status class="casino-status" role="status" aria-live="polite"></p>' +
      (game === "dice" ? renderChoice() : "") +
      '<div class="casino-controls">' + stake + '<button type="button" class="casino-play" data-play></button></div>' +
      '<details class="casino-rules"><summary>Правила и выплаты</summary><ul>' + RULES[game] + '</ul></details></section>';
    const wheel = content.querySelector(".casino-wheel canvas");
    if (wheel) paintWheel(wheel, game);
    if (game === "rocket") paintFlight(content.querySelector(".casino-flight"), 1);
    content.scrollTop = 0;
    if (balance != null && balance < MINIMUM) message("Для игры нужно минимум 100 К.", "warn");
  }

  function navigate(next, focus = false) {
    if (active) return;
    if (!game) hallScroll = content.scrollTop;
    game = GAMES[next] ? next : null;
    rotation = 0;
    choice = "";
    surface.dataset.room = game || "hall";
    const label = game ? "Вернуться в зал" : "Выйти из казино";
    header.innerHTML = '<button class="casino-icon" type="button" data-back aria-label="' + label + '" title="' + label + '">' +
      glyph(game ? "back" : "close") + '</button><span data-wallet aria-label="Баланс" class="casino-wallet"></span>' +
      '<button class="casino-icon" type="button" data-sound></button>';
    muteButton();
    showBalance();
    if (game) drawTable();
    else drawHall();
    setMode(pending && pending.game === game ? "retry" : "idle");
    if (mode === "retry") message("Предыдущий раунд ждёт расчёта.", "warn");
    music.setLevel(game === "rocket" ? .48 : game ? .58 : .72, .45);
    dialog.setAttribute("aria-label", game ? GAMES[game].name : "Казино");
    if (focus) dialog.focus({ preventScroll: true });
  }

  function spinWheels(outcome, animate) {
    const canvas = content.querySelector(".casino-wheel canvas");
    const turn = 360 / WHEEL_LABELS[game].length;
    const target = (360 - outcome.index * turn) % 360;
    const advance = (target - rotation % 360 + 360) % 360;
    rotation += (animate ? 360 * 5 : 0) + advance;
    canvas.style.transitionDuration = animate ? "2.6s" : "0s";
    canvas.style.transform = "rotate(" + rotation + "deg)";
    return animate ? wait(2620) : Promise.resolve();
  }

  function spinSlots(outcome, animate) {
    const strips = [...content.querySelectorAll(".casino-reel-strip")];
    strips.forEach((strip, index) => {
      const symbol = outcome.reels[index];
      const old = strip.children[strip.children.length - 2]?.innerHTML || numberSymbol(randomSymbol());
      const count = animate ? 17 + index * 5 : 0;
      strip.style.transition = "none";
      strip.style.transform = "none";
      strip.innerHTML = '<span>' + numberSymbol(randomSymbol()) + '</span><span>' + old + '</span>';
      for (let i = 0; i < count; i++) strip.insertAdjacentHTML("beforeend", '<span>' + numberSymbol(randomSymbol()) + '</span>');
      strip.insertAdjacentHTML("beforeend", '<span>' + numberSymbol(symbol) + '</span><span>' + numberSymbol(randomSymbol()) + '</span>');
      const offset = 100 * (count + 1) / strip.children.length;
      void strip.offsetHeight;
      strip.style.transition = animate ? "transform " + (1450 + index * 360) + "ms cubic-bezier(.12,.62,.25,1)" : "none";
      strip.style.transform = "translate3d(0," + (-offset) + "%,0)";
      strip.parentElement.setAttribute("aria-label", SYMBOL_NAMES[SYMBOLS.indexOf(symbol)] || symbol);
    });
    return animate ? wait(2200) : Promise.resolve();
  }

  async function rollDie(outcome, animate) {
    const die = content.querySelector(".casino-die");
    if (animate && die.animate) {
      die.animate([
        {transform: "translate(-45%, -18%) rotate(-55deg) scale(.82)"},
        {transform: "translate(32%, -35%) rotate(164deg) scale(1.12)", offset: .48},
        {transform: "translate(0, 0) rotate(365deg) scale(1)"},
      ], {duration: 840, easing: "cubic-bezier(.17,.67,.29,1)"});
      for (const interval of [130, 170, 205, 215]) {
        die.innerHTML = dieFace(1 + Math.floor(Math.random() * 6));
        await wait(interval);
      }
    }
    die.innerHTML = dieFace(outcome.roll);
    die.setAttribute("aria-label", "Выпало " + outcome.roll);
    if (animate) await wait(130);
  }

  async function reveal(outcome, animate) {
    const playMotion = animate && !shortMotion.matches && !document.hidden;
    if (playMotion) playUISound("spin");
    if (game === "slots") await spinSlots(outcome, playMotion);
    else if (game === "dice") await rollDie(outcome, playMotion);
    else await spinWheels(outcome, playMotion);
  }

  function result(round, data) {
    stopPolling();
    showBalance(data.balance);
    saveRound(null);
    if (game === "rocket") {
      paintFlight(content.querySelector(".casino-flight"), data.crashed ? data.crash_multiplier : data.multiplier, data.crashed);
    }
    const prefixText = game === "dice" ? "Выпало " + round.outcome.roll + " · " :
      game === "rocket" ? (data.crashed ? "Полёт остановлен · " : "Выход " + multiplier(data.multiplier) + " · ") : "";
    message(prefixText + (data.payout > 0 ? "Выплата " + money(data.payout) + " К" : "Без выплаты"), data.payout >= round.amount ? "pay" : "warn");
    playUISound(data.payout > round.amount ? "win" : data.payout === 0 ? "lose" : "cashout");
    if (data.failure_fragment_awarded) lifecycle.showFragment(data);
    setMode("idle");
  }

  async function refreshWallet() {
    const me = await get("/api/profile/me", {force: true});
    if (!mounted) return;
    accountKey = "kovcheg.casino.pending." + me.user.id;
    showBalance(me.user.balance);
  }

  function roundError(error) {
    if (!mounted) return;
    const retry = pending != null;
    stopPolling();
    const summary = retry ? "Связь прервалась. Восстановите раунд, чтобы увидеть расчёт." :
      (error?.status ? error.message : "Не удалось подтвердить начало раунда. Проверьте баланс перед повтором.");
    message(summary, "warn");
    setMode(retry ? "retry" : "idle");
    if (!retry && !error?.status) refreshWallet().then(() => setMode("idle")).catch(() => {});
  }

  async function settle(round) {
    stopPolling();
    setMode("settling");
    try {
      const data = await post(prefix + "/casino/settle", {token: round.token});
      if (mounted) result(round, data);
    } catch (error) {
      if (!mounted) return;
      if (error?.status === 409 && error.message.includes("Раунд уже завершён")) {
        try {
          await refreshWallet();
          if (!mounted) return;
          saveRound(null);
          message("Раунд уже рассчитан. Баланс обновлён.", "pay");
          setMode("idle");
          return;
        } catch (_) {}
      }
      roundError(error);
    }
  }

  function resumeFlight(round, immediate = true) {
    stopPolling();
    const generation = pollGeneration;
    let failures = 0;
    if (document.hidden) return;
    async function poll() {
      try {
        const state = await get(prefix + "/casino/rocket/status?token=" + encodeURIComponent(round.token));
        if (!mounted || generation !== pollGeneration) return;
        failures = 0;
        if (state.crashed) {
          paintFlight(content.querySelector(".casino-flight"), state.crash_multiplier, true);
          await settle(round);
          return;
        }
        paintFlight(content.querySelector(".casino-flight"), state.current_multiplier);
        timer = setTimeout(poll, 260);
      } catch (error) {
        if (!mounted || generation !== pollGeneration) return;
        if (error?.status === 409) {
          await settle(round);
          return;
        }
        failures += 1;
        if (failures >= 3) roundError(error);
        else timer = setTimeout(poll, 550);
      }
    }
    if (immediate) void poll();
    else timer = setTimeout(poll, 260);
  }

  async function perform(round) {
    try {
      if (game === "roulette") {
        const data = await post(prefix + "/roulette/spin", {amount: round.amount, request_id: round.requestId});
        if (!mounted) return;
        await reveal(data, true);
        if (mounted) result(round, data);
        return;
      }
      if (!round.token) {
        const started = await post(prefix + "/casino/start",
          {game, amount: round.amount, choice: round.choice}, {idempotencyKey: round.key});
        round = {...round, token: started.token, outcome: started.outcome};
        saveRound(round);
        if (!mounted) return;
        showBalance(started.balance);
      }
      if (game === "rocket") {
        setMode("flying");
        message("Заберите выплату до остановки полёта.");
        resumeFlight(round);
        return;
      }
      await reveal(round.outcome, true);
      if (mounted) await settle(round);
    } catch (error) {
      const rejected = error?.status >= 400 && error.status < 500 && !error.idempotencyStatus;
      if (rejected && !round.token) saveRound(null);
      roundError(error);
    }
  }

  function normalizeAmount(input) {
    const ceiling = Math.max(MINIMUM, Math.min(MAXIMUM, balance ?? MAXIMUM));
    const parsed = Number(input);
    return Math.max(MINIMUM, Math.min(ceiling, Math.trunc(Number.isFinite(parsed) ? parsed : MINIMUM)));
  }

  function playRound() {
    if (mode === "flying" && pending) {
      void settle(pending);
      return;
    }
    if (mode === "retry" && pending) {
      setMode("busy");
      void perform(pending);
      return;
    }
    if (active || balance == null || (game === "dice" && !choice)) return;
    const input = content.querySelector("[data-stake]");
    if (input) input.value = amount = normalizeAmount(input.value);
    const roundAmount = game === "roulette" ? MINIMUM : amount;
    if (balance < roundAmount) {
      message("Недостаточно ковбаксов для ставки.", "warn");
      return;
    }
    if (pending) {
      navigate(pending.game, true);
      message("Сначала завершите предыдущий раунд.", "warn");
      return;
    }
    const round = {game, amount: roundAmount, choice: game === "dice" ? choice : null, key: newIdempotencyKey()};
    if (game === "roulette") {
      round.requestId = "roulette_" + round.key.replaceAll("-", "");
    }
    saveRound(round);
    setMode("busy");
    message("");
    playUISound("bet");
    void perform(round);
  }

  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-sound")) {
      musicMuted = !musicMuted;
      music.setPaused(musicMuted);
      muteButton();
    } else if (button.hasAttribute("data-back")) {
      if (game) navigate(null, true);
      else window.closeModal();
    } else if (button.dataset.game) navigate(button.dataset.game, true);
    else if (button.hasAttribute("data-play")) playRound();
    else if (button.dataset.choice) {
      choice = button.dataset.choice;
      content.querySelectorAll("[data-choice]").forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
      setMode("idle");
    } else if (button.dataset.amount) {
      const input = content.querySelector("[data-stake]");
      amount = normalizeAmount(Number(input.value) + Number(button.dataset.amount));
      input.value = amount;
    }
  });

  lifecycle.registerCleanup(() => {
    mounted = false;
    stopPolling();
    music.release();
    document.documentElement.classList.remove("casino-active");
  }, (hidden) => {
    if (game !== "rocket" || mode !== "flying" || !pending) return;
    if (hidden) stopPolling();
    else resumeFlight(pending);
  }, () => {
    if (!game) return true;
    navigate(null, true);
    return false;
  });

  navigate(initialGame);
  music.setPaused(false);
  refreshWallet().then(() => {
    if (!mounted) return;
    try {
      const restored = JSON.parse(sessionStorage.getItem(accountKey) || "null");
      if (restored && GAMES[restored.game] && (restored.token || restored.requestId)) saveRound(restored);
    } catch (_) {}
    if (pending) navigate(pending.game);
    else if (game) {
      setMode("idle");
      if (balance < MINIMUM) message("Для игры нужно минимум 100 К.", "warn");
    }
  }).catch(() => {
    if (!mounted) return;
    if (game) message("Не удалось загрузить баланс. Вернитесь в зал и откройте казино снова.", "warn");
  });
}
