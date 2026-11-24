import { get, newIdempotencyKey, post } from "../api.js";
import { getSettings, useGameMusic } from "../pages/settings.js";
import { createCasinoSound } from "./casino-sound.js";
import { CASINO_COIN, kov, mountWallet } from "./casino-wallet.js";
import { SLOT_RULES, slotsBoard, slotsBonus, spinSlots } from "./casino-slots.js";
import { paintVault, setVaultKey, updateVaultOffer, vaultArtwork, vaultBoard, vaultOffer, VAULT_RULES } from "./casino-vault.js";
import { diceBoard, dieFace, flightBoard, multiplier, paintFlight, paintWheel, rollDice, spinWheel, wheelBoard } from "./casino-scenes.js";

const MINIMUM = 100;
const MAXIMUM = 10000;
const MAX_SERIES_ROUNDS = 20;
const SERIES_GAMES = new Set(["slots", "roulette", "dice"]);
const NUMBER = new Intl.NumberFormat("ru");
const GAMES = {
  slots: {name: "Слоты", action: "Крутить барабаны"},
  roulette: {name: "Рулетка", action: "Крутить рулетку"},
  rocket: {name: "Ракетка", action: "Запустить"},
  dice: {name: "Кубик", action: "Бросить кубик"},
  vault: {name: "Сейф", action: "Открыть сейф"},
};
const CHOICES = [["even", "Чёт"], ["odd", "Нечёт"], ["low", "1–3"], ["high", "4–6"]];
const CHROME = {
  back: '<path d="m14 5-7 7 7 7M7 12h13"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12 0a5 5 0 0 1 0 6m2-8a8 8 0 0 1 0 10"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12 1 5 5m0-5-5 5"/>',
};
const glyph = (name) => '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + CHROME[name] + '</svg>';
const money = (value) => NUMBER.format(value);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RULES = {
  slots: SLOT_RULES,
  roulette: [
    ["🎡", "Запусти колесо", "Ставка указана рядом с кнопкой. Нажми «Крутить рулетку» и дождись, когда колесо остановится."],
    ["📍", "Смотри на указатель", "Число на секторе под стрелкой — выплата за это вращение. Сумма сразу попадёт на баланс казино."],
    ["↻", "Запусти серию", "Выбери от 1 до 20 вращений по 100 К. Стоп отменит оставшиеся вращения."],
  ],
  rocket: [
    ["🚀", "Дай старт", "Выбери ставку и запусти ракету. Чем дольше она летит, тем выше множитель выплаты."],
    ["💰", "Успей забрать", "Нажми «Забрать» до срыва. Если ракета сорвётся раньше, ставка сгорит. На верхней отметке выплата приходит сама."],
  ],
  dice: [
    ["🎲", "Сделай прогноз", "Выбери конкретное число, чётность или диапазон. Затем укажи ставку и брось кубик."],
    ["🎯", "Проверь бросок", "Выплата приходит, если грань совпала с числом или попала в выбранную группу."],
    ["↻", "Запусти серию", "Выбери от 1 до 20 бросков с одной ставкой и прогнозом. Стоп отменит оставшиеся броски."],
  ],
  vault: VAULT_RULES,
};

function rulesFor(game) {
  return '<details class="casino-rules"><summary>Как играть</summary><ul>' + RULES[game].map(([icon, title, text]) =>
    '<li><span class="casino-rule-icon" aria-hidden="true">' + icon + '</span><div><strong>' + title +
    '</strong><p>' + text + '</p></div></li>').join("") + '</ul></details>';
}

function seriesControls(game) {
  const options = Array.from({length:MAX_SERIES_ROUNDS}, (_, index) => '<option>' + (index + 1) + '</option>').join("");
  const countLabel = game === "dice" ? "Количество бросков" : "Количество вращений";
  return '<div class="casino-series-wrap"><div class="casino-series"><label for="casino-series-count"><span>Автоспин</span>' +
    '<select data-series-count id="casino-series-count" aria-label="' + countLabel + '">' + options + '</select></label>' +
    '<output data-series-progress aria-live="polite" hidden></output>' +
    '<button data-series-auto type="button" disabled>Запустить</button></div></div>';
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
  if (game === "roulette") return wheelBoard();
  if (game === "dice") return diceBoard();
  return flightBoard(rocketArtwork());
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
  let vaultCollection = null;
  const accountKey = "kovcheg.casino.pending." + window.kov.me.id;
  let amount = MINIMUM;
  let choice = "";
  let pending = null;
  let series = null;
  let active = false;
  let mode = "idle";
  let timer;
  let pollGeneration = 0;

  const needsChoice = () => game === "dice" || game === "vault";
  const hasSlotGift = () => Boolean(funds && !funds.bonus_claimed);
  const awaitingGift = () => game === "slots" && hasSlotGift();
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
    if (gift) {
      gift.hidden = !hasSlotGift();
      gift.closest(".casino-table").toggleAttribute("data-has-gift", hasSlotGift());
    }
    const offer = content.querySelector("[data-slot-bonus]");
    if (offer) offer.hidden = !initialized || !awaitingGift();
    const bonusBalance = content.querySelector("[data-slot-balance]");
    if (bonusBalance) {
      bonusBalance.hidden = !funds?.bonus;
      bonusBalance.textContent = funds?.bonus ? "Бонусы " + kov(funds.bonus) : "";
    }
  }

  function openWallet() {
    if (active || series || walletPanel || !funds) return;
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
    if (!awaitingGift() || claimingBonus || !initialized || active) return;
    const button = content.querySelector("[data-claim-slot-bonus]");
    const feedback = content.querySelector("[data-slot-bonus-error]");
    claimingBonus = true;
    button.disabled = true;
    feedback.textContent = "";
    setMode("busy");
    try {
      const data = await post(prefix + "/casino/slots/bonus", {claim: true});
      if (!mounted) return;
      showWallet(data.wallet);
      if (data.awarded) sound.play("win", {level:.68});
    } catch (error) {
      if (mounted) feedback.textContent = error?.status ? error.message : "Бонус не начислился. Попробуйте ещё раз.";
    } finally {
      claimingBonus = false;
      if (mounted) {
        button.disabled = false;
        setMode(pending?.game === "slots" ? "retry" : "idle");
      }
    }
  }

  function setMode(next) {
    mode = next;
    surface.dataset.mode = next;
    active = next === "busy" || next === "flying" || next === "settling";
    const locked = active || Boolean(series);
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
    action.disabled = Boolean(series || vaultCollection) || awaitingGift() ||
      (next === "idle" ? !ready : next === "busy" || next === "settling");
    action.textContent = {
      flying: "Забрать", retry: "Восстановить раунд", busy: "Раунд идёт…", settling: "Расчёт…",
    }[next] || GAMES[game].action;
    content.querySelectorAll("[data-choice], [data-amount], [data-stake]").forEach((node) => {
      node.disabled = next !== "idle" || Boolean(series);
    });
    updateSeries();
  }

  function message(text, type = "") {
    const status = content.querySelector("[data-status]");
    status.textContent = text;
    status.dataset.type = type;
  }

  function saveRound(round) {
    pending = round;
    try {
      if (round?.token || round?.requestId) sessionStorage.setItem(accountKey, JSON.stringify(round));
      else sessionStorage.removeItem(accountKey);
    } catch (_) {}
  }

  function collectVault(round, resume = false) {
    if (vaultCollection) return vaultCollection;
    const decision = round?.vaultDecision;
    vaultCollection = post(prefix + "/casino/vault/collect", {
      token: round?.token ?? null,
      vault_key: decision === "left" || decision === "right" ? decision : null,
      resume,
    }, {keepalive: true}).then(({wallet}) => {
      if (round?.token) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(accountKey) || "null");
          if (saved?.token === round.token && pending?.token !== round.token) sessionStorage.removeItem(accountKey);
        } catch (_) {}
      }
      if (mounted) showWallet(wallet);
    }).finally(() => {
      vaultCollection = null;
      if (mounted && initialized) setMode(mode);
    });
    return vaultCollection;
  }

  function leaveVault() {
    if (pending?.game !== "vault" || !pending.token) return;
    const round = pending;
    pending = null;
    void collectVault(round).catch(() => {});
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
        '</strong>' + artwork(id) + (id === "slots" ? '<span class="slot-gift" data-slots-gift hidden aria-label="Бонус 1000">1000<span aria-hidden="true">🎁</span></span>' : "") + '<span class="casino-table-next">' + glyph("next") + '</span></button>').join("") +
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
      (SERIES_GAMES.has(game) ? seriesControls(game) : "") + (game === "vault" ? vaultOffer() : "") +
      rulesFor(game) + '</section>';
    const wheel = content.querySelector(".casino-wheel");
    if (wheel) paintWheel(wheel);
    if (game === "rocket") paintFlight(content.querySelector(".casino-flight"), 1);
    content.scrollTop = 0;
    if (funds && (game !== "slots" || funds.bonus_claimed) && balance < MINIMUM) {
      message("Пополните казино для ставки от 100 К.", "warn");
    }
  }

  function navigate(next, focus = false) {
    if (active || series || walletPanel) return;
    if (game === "vault" && next !== "vault") leaveVault();
    game = GAMES[next] ? next : null;
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
  }

  async function reveal(outcome, animate) {
    const playMotion = animate && canAnimate();
    if (game === "slots") await spinSlots(content.querySelector(".casino-slot"), outcome, playMotion, sound);
    else if (game === "dice") await rollDice(content.querySelector(".casino-dice-tray"), outcome.roll, playMotion, sound);
    else await spinWheel(content.querySelector(".casino-wheel"), outcome.index, playMotion, sound);
  }

  async function offerVault(round, animate) {
    const motion = animate && canAnimate();
    if (animate) {
      if (motion) {
        paintVault(content, round.outcome.choice);
        content.querySelector(".vault-cell[aria-pressed=true]").classList.add("vault-locking");
        sound.play("vault-lock", {level:.78});
        await wait(290);
        if (!mounted) return;
      }
      sound.play("vault-open", {level:.79});
    }
    paintVault(content, round.outcome.choice, round.outcome.offer, motion);
    if (motion) await wait(620);
    if (!mounted) return;
    updateVaultOffer(content, round.outcome.offer);
    message("Сейф открыт.");
    setMode("vault-offer");
  }

  function chooseVaultAction(decision) {
    if (mode !== "vault-offer" || !pending?.token || pending.game !== "vault") return;
    saveRound({...pending, vaultDecision: decision});
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
    if (game !== "slots") {
      const panel = content.querySelector(".casino-game");
      panel.dataset.result = delta > 0 ? "win" : delta < 0 ? "loss" : "even";
      if (game === "roulette") paintWheel(content.querySelector(".casino-wheel"), data.index, delta > 0);
    }
    message(prefixText + (data.payout > 0 ? "Выплата " + money(data.payout) + " К" : "Без выплаты") + " · " + net,
      delta > 0 ? "pay" : delta < 0 ? "warn" : "");
    if (game === "slots") {
      if (delta > 0) sound.play(data.jackpot ? "slot-jackpot" : data.payout >= round.amount * 3 ? "slot-big-win" : "slot-win");
      else if (delta < 0) sound.play("slot-lose");
    } else if (delta > 0) sound.play(game + "-win", {level:.88});
    else if (data.crashed) sound.play("rocket-crash", {level:.82});
    else if (data.vault_key_won === false) sound.play("vault-empty", {level:.71});
    if (data.failure_fragment_awarded) lifecycle.showFragment(data);
    setMode("idle");
  }

  async function refreshWallet() {
    const current = await get(prefix + "/casino/wallet", {cache: false});
    if (!mounted) return;
    showWallet(current);
  }

  function roundError(error) {
    if (!mounted) return;
    const retry = pending != null;
    stopPolling();
    if (game === "vault") setVaultKey(content, null);
    if (game === "rocket") sound.stop();
    const summary = retry ? "Связь прервалась. Восстановите раунд, чтобы увидеть расчёт." :
      (error?.status ? error.message : "Не удалось подтвердить начало раунда. Проверьте баланс перед повтором.");
    message(summary, "warn");
    setMode(retry ? "retry" : "idle");
    if (!retry && !error?.status) refreshWallet().then(() => setMode("idle")).catch(() => {});
  }

  async function settle(round) {
    stopPolling();
    if (round.game === "rocket") sound.stop();
    setMode("settling");
    try {
      const payload = {token: round.token};
      if (round.vaultDecision === "left" || round.vaultDecision === "right") payload.vault_key = round.vaultDecision;
      const request = post(prefix + "/casino/settle", payload);
      if (payload.vault_key) {
        setVaultKey(content, payload.vault_key);
        sound.play("vault-key", {level:.8});
      }
      const [data] = await Promise.all([request, payload.vault_key && canAnimate() ? wait(480) : null]);
      if (mounted) result(round, data);
      return data;
    } catch (error) {
      if (!mounted) return;
      if (error?.status === 409 && error.message.includes("Раунд уже завершён")) {
        try {
          await refreshWallet();
          if (!mounted) return;
          saveRound(null);
          if (game === "vault") setVaultKey(content, null);
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
        paintFlight(content.querySelector(".casino-flight"), state.current_multiplier, false, canAnimate());
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
        return await settle(round);
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
        if (!mounted) {
          if (round.game === "vault") void collectVault(round).catch(() => {});
          return;
        }
        showWallet(started.wallet);
      }
      if (game === "rocket") {
        paintFlight(content.querySelector(".casino-flight"), 1);
        setMode("flying");
        if (!round.resumed) {
          sound.play("rocket-launch", {level:.81});
          sound.play("rocket-engine", {delay:.86, duration:10, level:.33});
        }
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
      if (mounted) return await settle(round);
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

  function currentStake() {
    return game === "roulette" ? MINIMUM : normalizeAmount(content.querySelector("[data-stake]").value);
  }

  function playRound(seriesRound = null) {
    if (walletPanel || vaultCollection || awaitingGift() || (series && seriesRound !== series)) return;
    if (mode === "flying" && pending) {
      void settle(pending);
      return;
    }
    if (mode === "retry" && pending) {
      setMode("busy");
      void perform({...pending, resumed: Boolean(pending.token)});
      return;
    }
    const roundChoice = seriesRound ? seriesRound.choice : needsChoice() ? choice : null;
    if (active || !initialized || balance == null || (needsChoice() && !roundChoice)) return;
    const roundAmount = seriesRound?.stake ?? currentStake();
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
    const input = content.querySelector("[data-stake]");
    if (input) input.value = amount = roundAmount;
    const round = {game, amount: roundAmount, choice: roundChoice, key: newIdempotencyKey()};
    if (game === "roulette" || game === "slots") {
      round.requestId = game + "_" + round.key.replaceAll("-", "");
    }
    saveRound(round);
    delete content.querySelector(".casino-game").dataset.result;
    setMode("busy");
    message("");
    return perform(round);
  }

  function canStartSeries() {
    return SERIES_GAMES.has(game) && mode === "idle" && initialized && !walletPanel && !vaultCollection && !awaitingGift() &&
      !pending && balance != null && balance >= MINIMUM && (!needsChoice() || Boolean(choice));
  }

  function updateSeries() {
    const button = content.querySelector("[data-series-auto]");
    if (!button) return;
    const count = content.querySelector("[data-series-count]");
    const progress = content.querySelector("[data-series-progress]");
    button.closest(".casino-series").toggleAttribute("data-running", Boolean(series));
    count.disabled = mode !== "idle" || Boolean(series);
    count.parentElement.hidden = Boolean(series);
    progress.hidden = !series;
    if (series) {
      progress.textContent = series.completed + " / " + series.total;
      button.textContent = series.stopped ? "Завершаем…" : "Стоп";
      button.disabled = series.stopped;
    } else {
      button.textContent = "Старт · до " + kov(currentStake() * Number(count.value));
      button.disabled = !canStartSeries();
    }
  }

  function stopSeries() {
    if (series) {
      series.stopped = true;
      updateSeries();
      series.finishPause?.();
    }
  }

  async function runSeries() {
    if (series) {
      stopSeries();
      return;
    }
    if (!canStartSeries() || document.hidden) return;
    const count = Number(content.querySelector("[data-series-count]").value);
    if (!Number.isInteger(count) || count < 1 || count > MAX_SERIES_ROUNDS) return;
    const stake = currentStake();
    const running = {stake, choice:needsChoice() ? choice : null, total:count, completed:0, stopped:false};
    series = running;
    setMode("idle");
    let notice = "";
    try {
      while (mounted && !running.stopped && !document.hidden && running.completed < running.total) {
        if (balance < stake) {
          notice = "Серия остановлена: не хватает ковбаксов на следующую ставку.";
          break;
        }
        const data = await playRound(running);
        if (!mounted || !data) break;
        running.completed += 1;
        updateSeries();
        if (data.jackpot || running.completed === running.total || running.stopped) break;
        await new Promise((resolve) => {
          const pause = setTimeout(resolve, data.payout > stake ? 1250 : 680);
          running.finishPause = () => { clearTimeout(pause); resolve(); };
        });
        running.finishPause = null;
      }
    } finally {
      series = null;
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
    else if (button.hasAttribute("data-claim-slot-bonus")) void grantSlotBonus();
    else if (button.hasAttribute("data-back")) {
      if (game) navigate(null, true);
      else window.closeModal();
    } else if (button.dataset.game) navigate(button.dataset.game, true);
    else if (button.hasAttribute("data-series-auto")) void runSeries();
    else if (button.hasAttribute("data-play")) playRound();
    else if (button.dataset.vaultAction) chooseVaultAction(button.dataset.vaultAction);
    else if (button.dataset.choice) {
      choice = button.dataset.choice;
      if (game === "vault") {
        delete content.querySelector(".casino-game").dataset.result;
        paintVault(content, choice);
        message("");
      } else content.querySelectorAll("[data-choice]").forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
      setMode("idle");
    } else if (button.dataset.amount) {
      const input = content.querySelector("[data-stake]");
      amount = normalizeAmount(Number(input.value) + Number(button.dataset.amount));
      input.value = amount;
      updateSeries();
    }
  });

  dialog.addEventListener("input", (event) => {
    if (event.target.matches("[data-stake], [data-series-count]")) updateSeries();
  });

  function collectOnClose() {
    if (pending?.game === "vault" && pending.token) void collectVault(pending).catch(() => {});
  }

  function returnFromPageCache(event) {
    if (event.persisted && game === "vault" && mode === "vault-offer") navigate(null);
  }

  window.addEventListener("pagehide", collectOnClose);
  window.addEventListener("pageshow", returnFromPageCache);
  lifecycle.registerCleanup(() => {
    mounted = false;
    collectOnClose();
    window.removeEventListener("pagehide", collectOnClose);
    window.removeEventListener("pageshow", returnFromPageCache);
    series?.finishPause?.();
    stopPolling();
    music.release();
    sound.dispose();
    walletPanel?.dispose();
    document.documentElement.classList.remove("casino-active");
  }, (hidden) => {
    if (hidden) {
      stopSeries();
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
  let restored;
  try { restored = JSON.parse(sessionStorage.getItem(accountKey) || "null"); } catch (_) {}
  collectVault(restored?.game === "vault" ? restored : null, true).catch(refreshWallet).then(async () => {
    if (!mounted) return;
    initialized = true;
    showWallet();
    if (restored?.game === "riskwheel" && restored.token) {
      saveRound(restored);
      await recoverRiskWheel(restored);
      if (!mounted || pending) return;
      restored = null;
    }
    if (restored && restored.game !== "vault" && GAMES[restored.game] && (restored.token || restored.requestId)) {
      saveRound(restored);
    } else saveRound(null);

    if (pending) navigate(pending.game);
    else {
      setMode("idle");
      if (game && !awaitingGift() && balance < MINIMUM) message("Пополните казино для ставки от 100 К.", "warn");
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
