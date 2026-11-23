// The server has already selected and granted the reward. This scene only reveals it.
const MAX_STARS = 4;
const ATLAS_SIZE = 352;
const ATLAS_COLUMNS = 6;
const FRAMES = 24;
const ART = {
  common: "bronze", rare: "silver", epic: "gold",
  seasonal: "rainbow", legendary: "rainbow", consolation: "bronze",
  "winter-ice": "ice", "winter-seasonal": "festive",
};
const asset = (name, view) => new URL("../media/kovboxes/" + name + "-" + view + ".webp", import.meta.url).pathname;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastArt;

export function prepareKovboxArt(code) {
  const name = Object.hasOwn(ART, code) ? ART[code] : "";
  if (!name) return null;
  if (lastArt?.name === name) return lastArt;
  const closed = new Image();
  const atlas = new Image();
  closed.src = asset(name, "still");
  atlas.src = asset(name, "spin");
  // Decoding is a head start. Slow media must never add an extra tap.
  void atlas.decode?.().catch(() => {});
  lastArt = {name, closed, atlas};
  return lastArt;
}

function turn(sprite, canvas, art, duration) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !art) return wait(duration);
  return new Promise((resolve) => {
    let id;
    const started = performance.now();
    function draw(now) {
      if (!sprite.isConnected) return finish();
      const progress = Math.min(1, (now - started) / duration);
      if (art.atlas.complete && art.atlas.naturalWidth === ATLAS_COLUMNS * ATLAS_SIZE) {
        const phase = progress * progress * (3 - 2 * progress);
        const frame = Math.floor(phase * FRAMES) % FRAMES;
        const x = (frame % ATLAS_COLUMNS) * ATLAS_SIZE;
        const y = Math.floor(frame / ATLAS_COLUMNS) * ATLAS_SIZE;
        ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        ctx.drawImage(art.atlas, x, y, ATLAS_SIZE, ATLAS_SIZE, 0, 0, ATLAS_SIZE, ATLAS_SIZE);
        sprite.classList.add("has-turn");
      }
      if (progress < 1) id = requestAnimationFrame(draw);
      else finish();
    }
    function finish() {
      cancelAnimationFrame(id);
      clearTimeout(timeout);
      sprite.classList.remove("has-turn");
      resolve();
    }
    const timeout = setTimeout(finish, duration + 65);
    id = requestAnimationFrame(draw);
  });
}

const clampStars = (value, fallback = 1) => Math.max(1, Math.min(MAX_STARS, Number(value) || fallback));
function haptic(type) {
  try {
    const feedback = window.Telegram?.WebApp?.HapticFeedback;
    if (type === "success") feedback?.notificationOccurred("success");
    else feedback?.impactOccurred(type);
  } catch (_) {}
}

export function presentKovbox(result, { sound, notifyClaim, rewardTier, reduceMotion, fallbackImage }) {
  const art = prepareKovboxArt(result.pool.code);
  const reward = result.rewards[0];
  const name = result.pool.name || "Ковбокс";
  let stars = clampStars(result.starting_stars);
  let index = 0;
  const steps = Array.isArray(result.star_sequence) && result.star_sequence.length
    ? result.star_sequence.slice(0, 3)
    : [stars, stars, stars];
  const motion = !reduceMotion && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canReveal = () => stars === MAX_STARS || index >= steps.length;

  document.querySelector(".lootbox-chest-overlay")?.remove();
  const overlay = document.createElement("section");
  overlay.className = "lootbox-chest-overlay kovbox-stage";
  overlay.dataset.model = art?.name || "silver";
  overlay.dataset.phase = "ready";
  overlay.classList.toggle("kovbox-quiet", !motion);
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "kovbox-name");
  overlay.innerHTML = `
    <div class="kovbox-atmosphere" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <header class="kovbox-head">
      <span class="kovbox-eyebrow">Ковчег</span>
      <h2 id="kovbox-name"></h2>
      <div class="kovbox-stars" role="img"></div>
    </header>
    <div class="kovbox-arena">
      <div class="kovbox-halo" aria-hidden="true"></div>
      <div class="kovbox-floor" aria-hidden="true"></div>
      <button type="button" class="kovbox-model">
        <span class="kovbox-sprite">
          <img alt="" draggable="false">
          <canvas width="${ATLAS_SIZE}" height="${ATLAS_SIZE}" aria-hidden="true"></canvas>
        </span>
      </button>
      <i class="kovbox-orbit" aria-hidden="true"></i>
      <article class="kovbox-reward" aria-live="polite" hidden>
        <div class="kovbox-reward-seal" aria-hidden="true">К</div>
        <div class="kovbox-reward-content"><span></span><img alt=""><strong></strong></div>
      </article>
      <i class="kovbox-flash" aria-hidden="true"></i>
    </div>
    <footer class="kovbox-foot">
      <p class="kovbox-prompt" role="status"></p>
      <button type="button" class="btn kovbox-claim" hidden>Забрать</button>
    </footer>`;
  const heading = overlay.querySelector("h2");
  const starsEl = overlay.querySelector(".kovbox-stars");
  const button = overlay.querySelector(".kovbox-model");
  const sprite = overlay.querySelector(".kovbox-sprite");
  const box = sprite.querySelector("img");
  const canvas = sprite.querySelector("canvas");
  const card = overlay.querySelector(".kovbox-reward");
  const prompt = overlay.querySelector(".kovbox-prompt");
  const claim = overlay.querySelector(".kovbox-claim");

  heading.textContent = name;
  box.src = art?.closed.src || fallbackImage;
  if (art) box.addEventListener("error", () => { box.src = fallbackImage; }, {once:true});
  const rewardImage = card.querySelector("img");
  rewardImage.src = reward.icon || "/static/img/ui/box.svg";
  card.querySelector("strong").textContent = reward.label || "Награда";
  card.querySelector(".kovbox-reward-content span").textContent = rewardTier(reward);
  document.body.append(overlay);

  function renderStars(previous = stars) {
    overlay.dataset.stars = stars;
    starsEl.replaceChildren(...Array.from({length:MAX_STARS}, (_, i) => {
      const star = document.createElement("span");
      star.className = i < stars ? (i >= previous ? "is-current is-new" : "is-current") : "";
      star.textContent = "★";
      star.setAttribute("aria-hidden", "true");
      return star;
    }));
    starsEl.setAttribute("aria-label", stars + " из 4 звёзд");
  }

  function ready() {
    overlay.dataset.phase = "ready";
    const description = canReveal() ? "Нажми, чтобы открыть" : "Нажми, чтобы улучшить";
    button.setAttribute("aria-label", description);
    prompt.textContent = description;
    button.disabled = false;
  }

  async function reveal() {
    overlay.dataset.phase = "opening";
    prompt.textContent = "Открываем…";
    haptic("heavy");
    void sound("open");
    if (motion) await turn(sprite, canvas, art, 1040);
    else await wait(95);
    if (!overlay.isConnected) return;

    const rank = reward.item?.lootbox_reward_tier;
    const special = rank === "special" || rank === "super_special";
    overlay.dataset.phase = "reward";
    button.hidden = true;
    if (special) card.dataset.rank = rank;
    card.hidden = false;
    if (special && motion) {
      card.classList.add("is-sealed");
      prompt.textContent = rank === "super_special" ? "Сверхособая награда…" : "Особая награда…";
      await Promise.race([sound("special"), wait(230)]);
      await wait(4300);
      if (!overlay.isConnected) return;
      card.classList.remove("is-sealed");
      card.classList.add("is-unsealed");
    } else {
      void sound(special ? "special" : "win");
    }
    prompt.textContent = "Награда получена";
    claim.hidden = false;
    claim.focus({preventScroll:true});
    haptic("success");
  }

  button.addEventListener("click", async () => {
    if (button.disabled || overlay.dataset.phase !== "ready") return;
    button.disabled = true;
    if (canReveal()) {
      await reveal();
      return;
    }
    const prev = stars;
    stars = Math.max(stars, clampStars(steps[index], stars));
    index += 1;
    overlay.dataset.phase = "charging";
    renderStars(prev);
    prompt.textContent = stars > prev ? "Звезда зажглась" : "Звёзды без изменений";
    haptic(stars > prev ? "heavy" : "medium");
    void sound(index);
    if (motion) await turn(sprite, canvas, art, 480);
    else await wait(125);
    if (!overlay.isConnected) return;
    // The fourth star always waits for one intentional opening tap. Below
    // the cap the last unsuccessful upgrade opens on that same tap.
    if (stars < MAX_STARS && index >= steps.length) await reveal();
    else ready();
  });
  claim.addEventListener("click", () => {
    claim.disabled = true;
    notifyClaim();
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), motion ? 180 : 30);
  });
  renderStars();
  ready();
  requestAnimationFrame(() => button.focus({preventScroll:true}));
}
