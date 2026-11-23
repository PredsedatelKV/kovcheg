import { get, newIdempotencyKey, post } from "../api.js";
import { getSettings, useGameMusic } from "../pages/settings.js";
import { createCasinoSound } from "./casino-sound.js";
import { CASINO_COIN, kov, mountWallet } from "./casino-wallet.js";
import { SLOT_RULES, slotsBoard, slotsBonus, slotSeriesControls, spinSlots } from "./casino-slots.js";
import { paintVault, updateVaultOffer, vaultArtwork, vaultBoard, vaultOffer, VAULT_RULES } from "./casino-vault.js";

const MINIMUM = 100;
const MAXIMUM = 10000;
const NUMBER = new Intl.NumberFormat("ru");
const GAMES = {
  slots: {name: "Слоты", action: "Крутить барабаны"},
  roulette: {name: "Рулетка", action: "Крутить рулетку"},
  rocket: {name: "Ракетка", action: "Запустить"},
  dice: {name: "Кубик", action: "Бросить кубик"},
  vault: {name: "Сейф", action: "Открыть сейф"},
};
const WHEEL_LABELS = ["10", "20", "30", "40", "50", "100", "200", "500", "1 000"];
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
const dieFace = (value) => PIPS[value].map((pip) => '<i style="grid-column:' + (pip % 3 + 1) +
  ';grid-row:' + (Math.floor(pip / 3) + 1) + '"></i>').join("");

const RULES = {
  slots: SLOT_RULES,
  roulette: [
    ["🎡", "Запусти колесо", "Ставка указана рядом с кнопкой. Нажми «Крутить рулетку» и дождись, когда колесо остановится."],
    ["📍", "Смотри на указатель", "Число на секторе под стрелкой — выплата за это вращение. Сумма сразу попадёт на баланс казино."],
  ],
  rocket: [
    ["🚀", "Дай старт", "Выбери ставку и запусти ракету. Чем дольше она летит, тем выше множитель выплаты."],
    ["💰", "Успей забрать", "Нажми «Забрать» до срыва. Если ракета сорвётся раньше, ставка сгорит. На верхней отметке выплата приходит сама."],
  ],
  dice: [
    ["🎲", "Сделай прогноз", "Выбери конкретное число, чётность или диапазон. Затем укажи ставку и брось кубик."],
    ["🎯", "Проверь бросок", "Выплата приходит, если грань совпала с числом или попала в выбранную группу."],
  ],
  vault: VAULT_RULES,
};

function rulesFor(game) {
  return '<details class="casino-rules"><summary>Как играть</summary><ul>' + RULES[game].map(([icon, title, text]) =>
    '<li><span class="casino-rule-icon" aria-hidden="true">' + icon + '</span><div><strong>' + title +
    '</strong><p>' + text + '</p></div></li>').join("") + '</ul></details>';
}

function rocketArtwork() {
  return '<span class="casino-rocket-icon" aria-hidden="true"><i class="casino-rocket-fins"></i>' +
    '<i class="casino-rocket-body"></i><i class="casino-rocket-window"></i><i class="casino-rocket-flame"></i></span>';
}

function artwork(game) {
  if (game === "slots") return '<div class="casino-art-slots"><b>7</b><b>7</b><b>7</b></div>';
  if (game === "dice") return '<div class="casino-art-die">' + dieFace(5) + '</div>';
  if (game === "rocket") return '<div class="casino-art-rocket">' + rocketArtwork() + '</div>';
  if (game === "vault") return vaultArtwork();
  return '<div class="casino-art-wheel"><i></i></div>';
}

function gameBoard(game) {
  if (game === "slots") return slotsBoard();
  if (game === "vault") return vaultBoard();
  if (game === "roulette") {
    return '<div class="casino-wheel"><canvas width="660" height="660" aria-label="Сектора колеса"></canvas><i class="casino-pointer"></i></div>';
  }
  if (game === "dice") return '<div class="casino-dice-tray"><div class="casino-die" aria-label="Кубик">' + dieFace(5) + '</div></div>';
  return '<div class="casino-flight"><canvas width="840" height="380" aria-hidden="true"></canvas><span class="casino-flight-rocket">' + rocketArtwork() + '</span><strong data-multiplier>×1,00</strong></div>';
}

function paintWheel(canvas) {
  const ctx = canvas.getContext("2d");
  const labels = WHEEL_LABELS;
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
    const colors = ["#811e34", "#262425"];
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
  ctx.fillText("♠", 0, 2);
}

function paintFlight(board, value, crashed = false) {
  const canvas = board.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const {width, height} = canvas;
  const fraction = Math.max(0, Math.min(1, (value - 1) / 4));
  const x = 55 + (width - 90) * Math.sqrt(fraction);
  const y = height - 38 - (height - 70) * fraction;
  const color = crashed ? "#ee8b91" : "#9acaff";
  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle = "#82b9ff32";
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
  const marker = board.querySelector(".casino-flight-rocket");
  marker.style.setProperty("--flight-x", 100 * x / width + "%");
  marker.style.setProperty("--flight-y", 100 * y / height + "%");
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
  const sound = createCasinoSound();
  const prefix = "/api/arcade";
  let musicMuted = false;
  let mounted = true;
  let initialized = false;
  let game = null;
  let balance = null;
  let funds = null;
  let walletPanel = null;
  let claimingBonus = false;
  let accountKey = "";
  let amount = MINIMUM;
  let choice = "";
  let pending = null;
  let slotSeries = null;
  let active = false;
  let mode = "idle";
  let rotation = 0;
  let timer;
  let pollGeneration = 0;

  const needsChoice = () => game === "dice" || game === "vault";
  const canAnimate = () => !shortMotion.matches && !getSettings().reduceMotion && !document.hidden;

  function muteButton() {
    const button = header.querySelector("[data-sound]");
    const globallyPaused = getSettings().musicPaused;
    button.disabled = globallyPaused;
    button.title = globallyPaused ? "Музыка выключена в настройках Ковчега" : musicMuted ? "Включить музыку" : "Выключить музыку";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = glyph(musicMuted || globallyPaused ? "mute" : "sound");
  }

  function showWallet(value) {
    if (value) {
      funds = value;
      lifecycle.updateBalance(value.main_balance);
    }
    balance = funds ? funds.cash + (game === "slots" ? funds.bonus : 0) : null;
    header.querySelector("[data-wallet-amount]").textContent = funds ? money(funds.cash) : "—";
    const gift = content.querySelector("[data-slots-gift]");
    if (gift) gift.hidden = !funds || (funds.bonus_claimed && !window.kov.me?.is_admin);
    const bonusBalance = content.querySelector("[data-slot-balance]");
    if (bonusBalance) {
      bonusBalance.hidden = !funds?.bonus;
      bonusBalance.textContent = funds?.bonus ? "Бонусы " + kov(funds.bonus) : "";
    }
  }

  function openWallet() {
    if (active || slotSeries || walletPanel || !funds) return;
    walletPanel = mountWallet(surface, funds, {
      onUpdate: (wallet) => {
        showWallet(wallet);
        if (game && mode === "idle" && balance >= MINIMUM && content.querySelector("[data-status]").textContent.startsWith("Пополните казино")) message("");
        setMode(mode);
      },
      onClose: () => {
        walletPanel = null;
        header.querySelector("[data-wallet]").focus({preventScroll:true});
      },
      sound,
    });
  }

  async function grantSlotBonus() {
    if (game !== "slots" || !funds || funds.bonus_claimed || claimingBonus || !initialized || active) return;
    claimingBonus = true;
    setMode("busy");
    try {
      const data = await post(prefix + "/casino/slots/bonus");
      if (!mounted) return;
      showWallet(data.wallet);
      if (data.awarded) {
        content.querySelector("[data-slot-bonus]").hidden = false;
        sound.play("win",{level:.68});
      }
    } catch (error) {
      if (mounted) message(error?.status ? error.message : "Не удалось загрузить бонус. Зайдите в слоты повторно.", "warn");
    } finally {
      claimingBonus = false;
      if (mounted) setMode("idle");
    }
  }

  function setMode(next) {
    mode = next;
    active = next === "busy" || next === "flying" || next === "settling";
    const locked = active || Boolean(slotSeries);
    lifecycle.setLocked(locked);
    header.querySelector("[data-back]").disabled = locked;
    header.querySelector("[data-wallet]").disabled = locked || !funds;
    const action = content.querySelector("[data-play]");
    content.querySelectorAll(".casino-table").forEach((card) => { card.disabled = active; });
    if (!action) return;
    const showingOffer = next === "vault-offer";
    const offer = content.querySelector("[data-vault-offer]");
    if (offer) {
      content.querySelector(".casino-controls").hidden = showingOffer;
      offer.hidden = !showingOffer;
      offer.querySelectorAll("button").forEach((button) => { button.disabled = !showingOffer; });
    }
    const ready = initialized && balance != null && balance >= MINIMUM && (!needsChoice() || choice !== "");
    action.disabled = Boolean(slotSeries) || (next === "idle" ? !ready : next === "busy" || next === "settling");
    action.textContent = {
      flying: "Забрать", retry: "Восстановить раунд", busy: "Раунд идёт…", settling: "Расчёт…",
    }[next] || GAMES[game].action;
    content.querySelectorAll("[data-choice], [data-amount], [data-stake]").forEach((node) => {
      node.disabled = next !== "idle" || Boolean(slotSeries);
    });
    updateSlotSeries();
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
        '" data-game="' + id + '" aria-label="' + item.name + '"><strong class="casino-table-title">' + item.name +
        '</strong>' + artwork(id) + (id === "slots" ? '<span class="slot-gift" data-slots-gift hidden aria-label="Бонус 1000">1000 <span aria-hidden="true">🎁</span></span>' : "") + '<span class="casino-table-next">' + glyph("next") + '</span></button>').join("") +
      '</div></section>';
  }

  function drawTable() {
    const fixed = game === "roulette";
    const stake = fixed ? '<div class="casino-fixed">100 <small>К за вращение</small></div>' :
      '<div class="casino-stake"><label for="casino-stake">Ставка</label><div><button type="button" data-amount="-100" aria-label="Уменьшить ставку на 100">−</button>' +
      '<input data-stake id="casino-stake" name="casino-stake" type="number" inputmode="numeric" step="1" min="100" max="10000" value="' + amount + '">' +
      '<button type="button" data-amount="100" aria-label="Увеличить ставку на 100">+</button></div></div>';
    content.innerHTML = '<section class="casino-game casino-' + game + '"><h1>' + GAMES[game].name +
      '</h1>' + (game === "slots" ? slotsBonus() + '<p class="slot-balance" data-slot-balance hidden></p>' : "") +
      '<div class="casino-board">' + gameBoard(game) + '</div>' +
      '<p data-status class="casino-status" role="status" aria-live="polite"></p>' +
      (game === "dice" ? renderChoice() : "") +
      '<div class="casino-controls">' + stake + '<button type="button" class="casino-play" data-play></button></div>' +
      (game === "slots" ? slotSeriesControls() : "") + (game === "vault" ? vaultOffer() : "") +
      rulesFor(game) + '</section>';
    const wheel = content.querySelector(".casino-wheel canvas");
    if (wheel) paintWheel(wheel);
    if (game === "rocket") paintFlight(content.querySelector(".casino-flight"), 1);
    content.scrollTop = 0;
    if (funds && (game !== "slots" || funds.bonus_claimed) && balance < MINIMUM) {
      message("Пополните казино для ставки от 100 К.", "warn");
    }
  }

  function navigate(next, focus = false) {
    if (active || slotSeries || walletPanel) return;
    game = GAMES[next] ? next : null;
    rotation = 0;
    choice = "";
    surface.dataset.room = game || "hall";
    const label = game ? "Вернуться в зал" : "Выйти из казино";
    header.innerHTML = '<button class="casino-icon" type="button" data-back aria-label="' + label + '" title="' + label + '">' +
      glyph(game ? "back" : "close") + '</button><button type="button" data-wallet aria-label="Кошелёк казино" class="casino-wallet">' +
      CASINO_COIN + '<span data-wallet-amount></span></button>' +
      '<button class="casino-icon" type="button" data-sound></button>';
    muteButton();
    showWallet();
    if (game) drawTable();
    else drawHall();
    showWallet();
    setMode(pending && pending.game === game ? "retry" : "idle");
    if (mode === "retry") {
      if (game === "vault" && pending.token && !pending.vaultDecision) {
        void offerVault(pending, false);
      } else message("Предыдущий раунд ждёт расчёта.", "warn");
    }
    music.setLevel(game === "rocket" ? .48 : game ? .58 : .72, .45);
    dialog.setAttribute("aria-label", game ? GAMES[game].name : "Казино");
    if (focus) dialog.focus({ preventScroll: true });
    if (!pending) void grantSlotBonus();
  }

  function spinWheels(outcome, animate) {
    const canvas = content.querySelector(".casino-wheel canvas");
    const turn = 360 / WHEEL_LABELS.length;
    const target = (360 - outcome.index * turn) % 360;
    const advance = (target - rotation % 360 + 360) % 360;
    rotation += (animate ? 360 * 5 : 0) + advance;
    canvas.style.transitionDuration = animate ? "2.6s" : "0s";
    canvas.style.transform = "rotate(" + rotation + "deg)";
    if (animate) {
      for (const delay of [0, .07, .15, .25, .37, .52, .70, .91, 1.17, 1.47, 1.80, 2.15, 2.55]) {
        sound.play("stop", {delay, level: delay > 2.5 ? .88 : .49, rate: 1.08});
      }
    } else sound.play("stop", {level: .75});
    return animate ? wait(2620) : Promise.resolve();
  }

  async function rollDie(outcome, animate) {
    const die = content.querySelector(".casino-die");
    sound.play("die");
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
    const playMotion = animate && canAnimate();
    if (game === "slots") await spinSlots(content.querySelector(".casino-slot"), outcome, playMotion, sound);
    else if (game === "dice") await rollDie(outcome, playMotion);
    else await spinWheels(outcome, playMotion);
  }

  async function offerVault(round, animate) {
    const motion = animate && canAnimate();
    paintVault(content, round.outcome.choice, round.outcome.offer, motion);
    if (animate) {
      sound.play("stop", {level: .85, rate: .82});
      if (motion) await wait(530);
      if (!mounted) return;
    }
    updateVaultOffer(content, round.outcome.offer);
    message("Сейф открыт.");
    setMode("vault-offer");
  }

  function chooseVaultAction(decision) {
    if (mode !== "vault-offer" || !pending?.token || pending.game !== "vault") return;
    saveRound({...pending, vaultDecision: decision});
    sound.play("stop", {level: .9, rate: .9});
    void settle(pending);
  }

  function result(round, data) {
    stopPolling();
    showWallet(data.wallet);
    saveRound(null);
    if (game === "rocket") {
      paintFlight(content.querySelector(".casino-flight"), data.crashed ? data.crash_multiplier : data.multiplier, data.crashed);
    }
    if (game === "vault") {
      paintVault(content, round.outcome.choice, data.payout);
      choice = "";
    }
    const prefixText = game === "slots" && data.jackpot ? "Джекпот · " :
      game === "vault" && data.vault_key_won != null
      ? (data.vault_key_won ? "Ключ подошёл · " : "Ключ не подошёл · ")
      : game === "dice" ? "Выпало " + round.outcome.roll + " · " :
      game === "rocket" ? (data.crashed ? "Срыв на " + multiplier(data.crash_multiplier) + " · " :
        data.capped ? "Автовыплата ×5 · " : "Выход " + multiplier(data.multiplier) + " · ") : "";
    const delta = data.payout - round.amount;
    const net = delta > 0 ? "+" + money(delta) + " К" : delta < 0 ? "−" + money(-delta) + " К" : "Ставка возвращена";
    message(prefixText + (data.payout > 0 ? "Выплата " + money(data.payout) + " К" : "Без выплаты") + " · " + net,
      delta > 0 ? "pay" : delta < 0 ? "warn" : "");
    if (game === "slots") {
      if (delta > 0) sound.play(data.jackpot ? "slot-jackpot" : data.payout >= round.amount * 3 ? "slot-big-win" : "slot-win");
      else if (delta < 0) sound.play("slot-lose");
    } else if (delta > 0) sound.play(data.jackpot || data.capped ? "jackpot" : "win");
    else if (delta < 0) sound.play(data.crashed ? "crash" : "loss");
    if (data.failure_fragment_awarded) lifecycle.showFragment(data);
    setMode("idle");
  }

  async function refreshWallet() {
    const current = await get(prefix + "/casino/wallet", {cache: false});
    if (!mounted) return;
    accountKey = "kovcheg.casino.pending." + window.kov.me.id;
    showWallet(current);
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
      const payload = {token: round.token};
      if (round.vaultDecision === "left" || round.vaultDecision === "right") payload.vault_key = round.vaultDecision;
      const data = await post(prefix + "/casino/settle", payload);
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
        const state = await get(prefix + "/casino/rocket/status?cap_aware=1&token=" + encodeURIComponent(round.token));
        if (!mounted || generation !== pollGeneration) return;
        failures = 0;
        if (state.crashed || state.capped) {
          paintFlight(content.querySelector(".casino-flight"),
            state.crashed ? state.crash_multiplier : state.current_multiplier, state.crashed);
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
      if (game === "slots" && round.token) {
        await settle(round);
        return;
      }
      if (game === "roulette" || game === "slots") {
        const path = game === "roulette" ? "/roulette/spin" : "/casino/slots/spin";
        const data = await post(prefix + path, {amount: round.amount, request_id: round.requestId, ledger: 1});
        if (!mounted) return;
        await reveal(data, true);
        if (mounted) result(round, data);
        return data;
      }
      if (!round.token) {
        const started = await post(prefix + "/casino/start",
          {game, amount: round.amount, choice: round.choice, ledger: 1}, {idempotencyKey: round.key});
        round = {...round, amount: started.amount ?? round.amount, token: started.token, outcome: started.outcome};
        saveRound(round);
        if (!mounted) return;
        showWallet(started.wallet);
      }
      if (game === "rocket") {
        setMode("flying");
        if (!round.resumed) sound.play("launch", {level: .72});
        resumeFlight(round);
        return;
      }
      if (game === "vault") {
        if (round.vaultDecision) {
          paintVault(content, round.outcome.choice, round.outcome.offer);
          await settle(round);
        } else await offerVault(round, !round.resumed);
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

  function playRound(seriesAmount = null) {
    if (walletPanel || (slotSeries && seriesAmount == null)) return;
    if (mode === "flying" && pending) {
      void settle(pending);
      return;
    }
    if (mode === "retry" && pending) {
      setMode("busy");
      void perform({...pending, resumed: Boolean(pending.token)});
      return;
    }
    if (active || !initialized || balance == null || (needsChoice() && !choice)) return;
    const input = content.querySelector("[data-stake]");
    if (input) input.value = amount = normalizeAmount(input.value);
    const roundAmount = seriesAmount ?? (game === "roulette" ? MINIMUM : amount);
    if (balance < roundAmount) {
      message("Недостаточно ковбаксов для ставки.", "warn");
      return;
    }
    if (pending) {
      if (pending.game === "riskwheel") {
        void recoverRiskWheel(pending);
        return;
      }
      navigate(pending.game, true);
      if (mode !== "vault-offer") message("Сначала завершите предыдущий раунд.", "warn");
      return;
    }
    const round = {game, amount: roundAmount, choice: needsChoice() ? choice : null, key: newIdempotencyKey()};
    if (game === "roulette" || game === "slots") {
      round.requestId = game + "_" + round.key.replaceAll("-", "");
    }
    saveRound(round);
    setMode("busy");
    message("");
    if (game !== "slots") sound.play("stake");
    return perform(round);
  }

  function updateSlotSeries() {
    const button = content.querySelector("[data-slot-auto]");
    if (!button) return;
    const count = content.querySelector("[data-slot-count]");
    const progress = content.querySelector("[data-slot-progress]");
    count.disabled = mode !== "idle" || Boolean(slotSeries);
    count.parentElement.hidden = Boolean(slotSeries);
    progress.hidden = !slotSeries;
    if (slotSeries) {
      progress.textContent = slotSeries.completed + " / " + slotSeries.total;
      button.textContent = slotSeries.stopped ? "Завершаем…" : "Стоп";
      button.disabled = slotSeries.stopped;
      button.dataset.running = "";
      button.removeAttribute("title");
    } else {
      const stake = normalizeAmount(content.querySelector("[data-stake]").value);
      button.textContent = "Старт · до " + kov(stake * Number(count.value));
      button.disabled = !initialized || active || mode !== "idle" || balance == null || balance < MINIMUM || Boolean(pending);
      delete button.dataset.running;
    }
  }

  function stopSlotSeries() {
    if (slotSeries) {
      slotSeries.stopped = true;
      updateSlotSeries();
    }
  }

  async function runSlotSeries() {
    if (slotSeries) {
      stopSlotSeries();
      return;
    }
    if (game !== "slots" || mode !== "idle" || !initialized || active || walletPanel ||
        pending || balance == null || balance < MINIMUM || document.hidden) return;
    const count = Number(content.querySelector("[data-slot-count]").value);
    if (!Number.isInteger(count) || count < 1 || count > 20) return;
    const stake = normalizeAmount(content.querySelector("[data-stake]").value);
    const series = {total:count, completed:0, stopped:false};
    slotSeries = series;
    setMode("idle");
    let notice = "";
    try {
      while (mounted && !series.stopped && !document.hidden && series.completed < series.total) {
        if (balance < stake) {
          notice = "Серия остановлена: не хватает ковбаксов на следующую ставку.";
          break;
        }
        const data = await playRound(stake);
        if (!mounted || !data) break;
        series.completed += 1;
        updateSlotSeries();
        if (data.jackpot || series.completed === series.total || series.stopped) break;
        await wait(data.payout > stake ? 1250 : 680);
      }
    } finally {
      slotSeries = null;
      if (mounted) {
        setMode(mode);
        if (notice) message(notice, "warn");
      }
    }
  }

  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-back") || button.dataset.game) sound.stop();
    if (button.hasAttribute("data-sound")) {
      musicMuted = !musicMuted;
      music.setPaused(musicMuted);
      muteButton();
    } else if (button.hasAttribute("data-wallet")) openWallet();
    else if (button.hasAttribute("data-dismiss-slot-bonus")) content.querySelector("[data-slot-bonus]").hidden = true;
    else if (button.hasAttribute("data-back")) {
      if (game) navigate(null, true);
      else window.closeModal();
    } else if (button.dataset.game) navigate(button.dataset.game, true);
    else if (button.hasAttribute("data-slot-auto")) void runSlotSeries();
    else if (button.hasAttribute("data-play")) playRound();
    else if (button.dataset.vaultAction) chooseVaultAction(button.dataset.vaultAction);
    else if (button.dataset.choice) {
      choice = button.dataset.choice;
      if (game === "vault") {
        paintVault(content, choice);
        message("");
      } else content.querySelectorAll("[data-choice]").forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
      setMode("idle");
    } else if (button.dataset.amount) {
      const input = content.querySelector("[data-stake]");
      amount = normalizeAmount(Number(input.value) + Number(button.dataset.amount));
      input.value = amount;
      updateSlotSeries();
    }
  });

  dialog.addEventListener("input", (event) => {
    if (event.target.matches("[data-stake], [data-slot-count]")) updateSlotSeries();
  });

  lifecycle.registerCleanup(() => {
    mounted = false;
    stopPolling();
    music.release();
    sound.dispose();
    walletPanel?.dispose();
    document.documentElement.classList.remove("casino-active");
  }, (hidden) => {
    if (hidden) {
      stopSlotSeries();
      sound.stop();
    }
    if (game !== "rocket" || mode !== "flying" || !pending) return;
    if (hidden) stopPolling();
    else resumeFlight(pending);
  }, () => {
    if (walletPanel) {
      walletPanel.close();
      return false;
    }
    if (!game) return true;
    sound.stop();
    navigate(null, true);
    return false;
  });

  navigate(initialGame);
  sound.preload();
  music.setPaused(false);
  Promise.all([
    refreshWallet(),
    get(prefix + "/casino/vault/active", {cache: false}).catch(() => undefined),
  ]).then(async ([, savedVault]) => {
    if (!mounted) return;
    initialized = true;
    let restored;
    try { restored = JSON.parse(sessionStorage.getItem(accountKey) || "null"); } catch (_) {}
    if (restored?.game === "riskwheel" && restored.token) {
      saveRound(restored);
      await recoverRiskWheel(restored);
      if (!mounted || pending) return;
      restored = null;
    }
    const unsettled = savedVault?.round;
    if (restored && restored.game !== "vault" && GAMES[restored.game] && (restored.token || restored.requestId)) {
      saveRound(restored);
    } else if (unsettled) {
      if (restored?.token === unsettled.token) unsettled.vaultDecision = restored.vaultDecision;
      saveRound(unsettled);
    } else if (!savedVault && restored?.game === "vault" && restored.token) {
      saveRound(restored);
    } else saveRound(null);

    if (pending) navigate(pending.game);
    else {
      setMode("idle");
      if (game === "slots" && !funds.bonus_claimed) void grantSlotBonus();
      else if (game && balance < MINIMUM) message("Пополните казино для ставки от 100 К.", "warn");
    }
  }).catch(() => {
    if (mounted && game) message("Не удалось загрузить баланс. Вернитесь в зал и откройте казино снова.", "warn");
  });

  async function recoverRiskWheel(round) {
    setMode("settling");
    try {
      const settled = await post(prefix + "/casino/settle", {token: round.token});
      if (!mounted) return;
      showWallet(settled.wallet);
      saveRound(null);
      if (settled.failure_fragment_awarded) lifecycle.showFragment(settled);
    } catch (error) {
      if (!mounted) return;
      if (error?.status === 409 && error.message.includes("Раунд уже завершён")) saveRound(null);
      else window.kov.toast("Предыдущий раунд ждёт восстановления связи.");
    } finally {
      if (mounted) setMode("idle");
    }
  }
}
