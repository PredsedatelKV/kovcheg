import {newIdempotencyKey, post} from "../api.js";

export const CASINO_COIN = '<span class="casino-coin" aria-hidden="true">К</span>';
const format = new Intl.NumberFormat("ru");
export const kov = (value) => format.format(value) + " К";

function walletRows(wallet) {
  return '<dl class="casino-wallet-rows"><div><dt>Ковчег</dt><dd>' + kov(wallet.main_balance) +
    '</dd></div><div><dt>Казино</dt><dd>' + kov(wallet.cash) +
    '</dd></div><div><dt>Бонус слотов</dt><dd>' + kov(wallet.bonus) +
    '</dd></div><div><dt>Можно вывести</dt><dd>' + kov(wallet.withdrawable) +
    '</dd></div></dl>';
}

export function mountWallet(surface, initial, {onUpdate, onClose, sound}) {
  const layer = document.createElement("section");
  layer.className = "casino-wallet-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "Кошелёк казино");
  layer.innerHTML = '<div class="casino-wallet-sheet"><header><h2>Кошелёк казино</h2>' +
    '<button type="button" aria-label="Закрыть кошелёк" data-close-wallet>×</button></header>' +
    '<div data-wallet-rows></div><div class="casino-wallet-tabs">' +
    '<button type="button" data-direction="deposit">Пополнить</button><button type="button" data-direction="withdraw">Вывести</button></div>' +
    '<label for="casino-transfer-amount">Сумма</label><div class="casino-wallet-input"><input type="number" inputmode="numeric" id="casino-transfer-amount" min="2" step="1" placeholder="0">' +
    '<button type="button" data-wallet-max>Макс.</button></div>' +
    '<p class="casino-wallet-fee">Комиссия 2,5%, с округлением вверх до целого ковбакса.</p>' +
    '<div class="casino-wallet-totals" data-wallet-totals aria-live="polite"></div>' +
    '<button type="button" class="casino-play" data-transfer></button>' +
    '<p data-wallet-message class="casino-status" role="status"></p></div>';
  surface.append(layer);
  const underlay = surface.querySelectorAll(".casino-toolbar, .casino-content");
  underlay.forEach((element) => { element.inert = true; });

  const input = layer.querySelector("input");
  const action = layer.querySelector("[data-transfer]");
  const status = layer.querySelector("[data-wallet-message]");
  let wallet = initial;
  let direction = "deposit";
  let draft = null;
  let busy = false;
  let disposed = false;
  const maximum = () => direction === "deposit" ? wallet.main_balance : wallet.withdrawable;
  const amount = () => Number(input.value);

  function render() {
    const value = amount();
    const valid = Number.isSafeInteger(value) && value >= 2 && value <= maximum() && value <= 2_000_000_000;
    const fee = valid ? Math.ceil(value / 40) : 0;
    layer.querySelector("[data-wallet-rows]").innerHTML = walletRows(wallet);
    layer.querySelectorAll("[data-direction]").forEach((tab) => {
      tab.setAttribute("aria-pressed", String(tab.dataset.direction === direction));
      tab.disabled = busy || Boolean(draft);
    });
    layer.querySelector("[data-close-wallet]").disabled = busy;
    layer.querySelector("[data-wallet-max]").disabled = busy || Boolean(draft) || maximum() < 2;
    input.disabled = busy || Boolean(draft);
    input.max = maximum();
    layer.querySelector("[data-wallet-totals]").textContent = valid
      ? "Комиссия " + kov(fee) + " · К получению " + kov(value - fee)
      : "Доступно " + kov(maximum());
    action.textContent = busy ? "Переводим…" : draft ? "Повторить перевод" : direction === "deposit" ? "Пополнить казино" : "Вывести в Ковчег";
    action.disabled = busy || (!draft && !valid);
  }

  function close() {
    if (busy) return false;
    disposed = true;
    layer.remove();
    underlay.forEach((element) => { element.inert = false; });
    onClose();
    return true;
  }

  async function submit() {
    if (action.disabled) return;
    status.textContent = "";
    if (!draft) draft = {direction, amount: amount(), request_id: newIdempotencyKey().replace(/[^A-Za-z0-9_-]/g, "")};
    busy = true;
    render();
    try {
      const result = await post("/api/arcade/casino/wallet/transfer", draft);
      if (disposed) return;
      draft = null;
      wallet = result.wallet;
      onUpdate(wallet);
      input.value = "";
      status.textContent = "Переведено " + kov(result.net);
      sound.play("win", {level:.72});
    } catch (error) {
      if (disposed) return;
      if (error?.status >= 400 && error.status < 500 && !error.idempotencyStatus) {
        draft = null;
        status.textContent = error.message;
      } else status.textContent = "Статус перевода уточняется. Повторите тот же запрос.";
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }

  input.addEventListener("input", () => {
    status.textContent = "";
    render();
  });
  layer.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("button");
    if (event.target === layer) { close(); return; }
    if (!button || button.disabled) return;
    sound.play("tap");
    if (button.hasAttribute("data-close-wallet")) close();
    else if (button.hasAttribute("data-transfer")) void submit();
    else if (button.hasAttribute("data-wallet-max")) {
      input.value = Math.min(maximum(), 2_000_000_000);
      render();
    } else if (button.dataset.direction) {
      direction = button.dataset.direction;
      input.value = "";
      status.textContent = "";
      render();
    }
  });
  render();
  layer.querySelector("[data-close-wallet]").focus({preventScroll: true});
  return {close, dispose() { disposed = true; layer.remove(); }};
}
