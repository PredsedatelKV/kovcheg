const DOORS = ["1", "2", "3", "4"];
const MONEY = new Intl.NumberFormat("ru");
const value = (amount) => MONEY.format(amount) + " К";
const hardware = '<i class="vault-keypad"></i><i class="vault-hinge"></i>';

export const VAULT_RULES =
  "<li>В четырёх сейфах лежат 45%, 80%, 100% и 135% ставки. Суммы перемешиваются, у каждой шанс 25%.</li>" +
  "<li>Заберите сумму или выберите ключ. Один ключ удвоит её, второй оставит сейф пустым.</li>";

export function vaultArtwork() {
  return '<span class="vault-art" aria-hidden="true"><i class="vault-art-face"></i>' + hardware + '</span>';
}

export function vaultBoard() {
  return '<fieldset class="vault-board"><legend>Выберите сейф</legend><div class="vault-grid">' +
    DOORS.map((id) => '<button type="button" class="vault-cell" data-choice="' + id + '" aria-label="Сейф ' + id +
      '" aria-pressed="false"><span class="vault-recess"><span class="vault-value" aria-hidden="true"></span><span class="vault-door" aria-hidden="true">' + hardware +
      '<span class="vault-number">0' + id + '</span></span></span></button>').join("") + '</div></fieldset>';
}

export function vaultOffer() {
  return '<section class="vault-offer" data-vault-offer hidden aria-label="Выплата из сейфа">' +
    '<button type="button" class="casino-play vault-collect" data-vault-action="collect" data-vault-collect></button>' +
    '<div class="vault-key-panel"><div><strong>Удвоить сумму</strong><span data-vault-double></span></div>' +
    '<p>Один ключ удвоит выплату. Второй обнулит её. Шанс 50%.</p><div class="vault-keys">' +
    '<button type="button" data-vault-action="left"><i class="vault-key" aria-hidden="true"></i>Серебряный ключ</button>' +
    '<button type="button" data-vault-action="right"><i class="vault-key" aria-hidden="true"></i>Золотой ключ</button>' +
    '</div></div></section>';
}

export function paintVault(content, choice = "", payout = null, animate = false) {
  content.querySelector(".vault-board legend").textContent = payout == null ? "Выберите сейф" : "Сейф " + choice.padStart(2, "0");
  content.querySelectorAll(".vault-cell").forEach((door) => {
    const selected = door.dataset.choice === choice;
    const opened = selected && payout != null;
    door.setAttribute("aria-pressed", String(selected));
    door.classList.toggle("vault-animating", opened && animate);
    door.toggleAttribute("data-open", opened);
    door.setAttribute("aria-label", "Сейф " + door.dataset.choice + (opened ? ", " + value(payout) : ""));
    door.querySelector(".vault-value").textContent = opened ? value(payout) : "";
  });
}

export function updateVaultOffer(content, payout) {
  content.querySelector("[data-vault-collect]").textContent = "Забрать " + value(payout);
  content.querySelector("[data-vault-double]").textContent = value(payout * 2);
}
