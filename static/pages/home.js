import { get, post, iconHtml } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

function bannerCarousel(banners) {
  if (!banners.length) return "";
  return `
    <div class="carousel carousel-hero" data-carousel>
      <button type="button" class="carousel-nav carousel-nav-prev" data-carousel-prev aria-label="Назад">‹</button>
      <div class="carousel-viewport">
        <div class="carousel-track" id="bn-track">
          ${banners
            .map(
              (b) =>
                `<div class="carousel-slide"><div class="banner" style="background-image:url('${escapeHtml(b.image_url)}')"></div></div>`,
            )
            .join("")}
        </div>
      </div>
      <button type="button" class="carousel-nav carousel-nav-next" data-carousel-next aria-label="Вперёд">›</button>
      <div class="dots" id="bn-dots">
        ${banners.map((_, i) => `<span class="dot ${i === 0 ? "active" : ""}" data-carousel-dot></span>`).join("")}
      </div>
    </div>`;
}

function taskThumb(task) {
  const src = String(task.icon || "").trim() || "/static/img/tasks/scroll.svg";
  if (src.startsWith("/") || src.startsWith("http")) {
    return `<img src="${escapeHtml(src)}" alt="" class="task-card-img" loading="lazy"/>`;
  }
  return `<span class="task-card-emoji" aria-hidden="true">${src}</span>`;
}

function taskCard(t) {
  return `
    <article class="task-card" data-task-id="${t.id}">
      <div class="task-card-media">${taskThumb(t)}</div>
      <div class="task-card-body">
        <h4 class="task-card-title">${escapeHtml(t.name)}</h4>
        <p class="task-card-reward-line">
          <span>Награда:</span>
          ${iconHtml("/static/img/ui/coin.svg", "sm", "")}
          <strong>${t.reward}</strong>
        </p>
        <button type="button" class="btn btn-sm btn-task-start" data-action="start" data-task-id="${t.id}">Начать</button>
      </div>
    </article>`;
}

function tasksCarousel(tasks) {
  if (!tasks.length) return `<div class="empty">Заданий пока нет</div>`;
  const pages = chunk(tasks, 3);
  const pageCount = pages.length;
  return `
    <section class="tasks-carousel" data-carousel>
      <div class="section-title tasks-carousel-head">
        <span>Задания</span>
        <span class="tasks-carousel-counter" data-carousel-counter>1 / ${pageCount}</span>
      </div>
      <div class="tasks-carousel-shell">
        <button type="button" class="carousel-nav carousel-nav-prev" data-carousel-prev aria-label="Предыдущие задания">‹</button>
        <div class="tasks-carousel-viewport">
          <div class="tasks-carousel-track carousel-track">
            ${pages
              .map(
                (page) =>
                  `<div class="tasks-carousel-page carousel-slide">${page.map(taskCard).join("")}</div>`,
              )
              .join("")}
          </div>
        </div>
        <button type="button" class="carousel-nav carousel-nav-next" data-carousel-next aria-label="Следующие задания">›</button>
      </div>
      <div class="dots tasks-carousel-dots">
        ${pages.map((_, i) => `<span class="dot ${i === 0 ? "active" : ""}" data-carousel-dot></span>`).join("")}
      </div>
    </section>`;
}

function newsCardCompact(n) {
  return `
    <article class="news-card-compact card">
      <h3 class="news-card-compact-title">Новость</h3>
      <div class="news-card-compact-media">
        <img src="${escapeHtml(n.image_url)}" alt="" loading="lazy"/>
      </div>
      <div class="news-card-compact-body">
        <h4>${escapeHtml(n.title)}</h4>
        <p>${escapeHtml(n.body)}</p>
        <time class="date">${fmtDate(n.published_at)}</time>
      </div>
    </article>`;
}

function wheelPromoCard() {
  return `
    <article class="wheel-promo card" id="wheel-card" role="button" tabindex="0">
      <h3 class="wheel-promo-title">Ежедневное колесо фортуны</h3>
      <div class="wheel-promo-visual" aria-hidden="true"></div>
      <button type="button" class="btn btn-wheel-open">Крутить колесо</button>
    </article>`;
}

function planBar(plan) {
  if (!plan) return "";
  const line = escapeHtml(plan.description.split("\n")[0] || plan.description);
  return `
    <article class="plan-bar card">
      <div class="plan-bar-icon">${iconHtml(plan.icon, "md", "План")}</div>
      <div class="plan-bar-text">
        <div class="plan-bar-label">План на день</div>
        <div class="plan-bar-task">${escapeHtml(plan.name)}</div>
        <div class="plan-bar-sub">${line}</div>
      </div>
      <div class="plan-bar-meta">
        <span class="mandatory-tag">Обязательный</span>
        <span class="lock" title="Заблокировано">${iconHtml("/static/img/ui/lock.svg", "sm", "")}</span>
      </div>
    </article>`;
}

function quickLinkCards() {
  return `
    <div class="quick-link-grid">
      <button type="button" class="quick-link-card" data-action="legal" data-slug="constitution">
        <span class="quick-link-icon">${iconHtml("/static/img/ui/book.svg", "md", "")}</span>
        <span class="quick-link-text">
          <strong>Конституция</strong>
          <small>Основной закон общины</small>
        </span>
        <span class="quick-link-chevron">›</span>
      </button>
      <button type="button" class="quick-link-card" data-action="legal" data-slug="laws">
        <span class="quick-link-icon">${iconHtml("/static/img/ui/scales.svg", "md", "")}</span>
        <span class="quick-link-text">
          <strong>Законодательство</strong>
          <small>Правила и устав</small>
        </span>
        <span class="quick-link-chevron">›</span>
      </button>
      <button type="button" class="quick-link-card" data-action="channel">
        <span class="quick-link-icon">${iconHtml("/static/img/ui/mail.svg", "md", "")}</span>
        <span class="quick-link-text">
          <strong>Телеграм канал</strong>
          <small>Новости и объявления</small>
        </span>
        <span class="quick-link-chevron">›</span>
      </button>
    </div>`;
}

function bindPagedCarousel(container) {
  if (!container) return;
  const track = container.querySelector(".carousel-track");
  if (!track) return;
  const pages = track.children.length;
  const counter = container.querySelector("[data-carousel-counter]");
  const dots = container.querySelectorAll("[data-carousel-dot]");
  const prev = container.querySelector("[data-carousel-prev]");
  const next = container.querySelector("[data-carousel-next]");

  const pageWidth = () => track.clientWidth;

  const goTo = (index) => {
    const i = Math.max(0, Math.min(index, pages - 1));
    track.scrollTo({ left: i * pageWidth(), behavior: "smooth" });
  };

  const update = () => {
    const i = pageWidth() > 0 ? Math.round(track.scrollLeft / pageWidth()) : 0;
    if (counter) counter.textContent = `${i + 1} / ${pages}`;
    dots.forEach((d, idx) => d.classList.toggle("active", idx === i));
  };

  track.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  prev?.addEventListener("click", () => goTo(Math.round(track.scrollLeft / pageWidth()) - 1));
  next?.addEventListener("click", () => goTo(Math.round(track.scrollLeft / pageWidth()) + 1));
  dots.forEach((dot, idx) => dot.addEventListener("click", () => goTo(idx)));
  update();
}

export async function renderHome(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/home");
  const user = data.user;
  const welcome = `${escapeHtml(user.first_name || "Гражданин")}, Добро пожаловать!`;
  const displayTasks = data.tasks.slice(0, 9);

  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${welcome}</h1>
        <div class="subtitle">${escapeHtml(data.server_time_msk)} (МСК)</div>
      </div>
      <div class="hero-art" title="Ковчег"><img src="/static/img/cube.svg" alt="Ковчег" class="hero-img"/></div>
    </section>

    ${bannerCarousel(data.banners)}

    <div class="home-duo">
      ${wheelPromoCard()}
      ${data.news ? newsCardCompact(data.news) : `<article class="news-card-compact card news-card-compact--empty"><h3>Новость</h3><p class="card-sub">Пока нет новостей</p></article>`}
    </div>

    ${planBar(data.daily_plan)}

    ${tasksCarousel(displayTasks)}

    ${quickLinkCards()}
  `;

  root.querySelectorAll("[data-carousel]").forEach(bindPagedCarousel);

  const wheelCard = root.querySelector("#wheel-card");
  wheelCard?.addEventListener("click", (e) => {
    if (e.target.closest(".btn-wheel-open") || e.target === wheelCard) openWheel();
  });
  wheelCard?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openWheel();
    }
  });

  const allTasksList = data.tasks;
  root.querySelectorAll('[data-action="start"]').forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.taskId;
      openTaskDetails(allTasksList.find((t) => String(t.id) === String(id)));
    });
  });
  root.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-action='start']")) return;
      const id = card.dataset.taskId;
      openTaskDetails(allTasksList.find((t) => String(t.id) === String(id)));
    });
  });

  root.querySelectorAll('[data-action="legal"]').forEach((btn) =>
    btn.addEventListener("click", () => openLegal(btn.dataset.slug)),
  );
  root.querySelector('[data-action="channel"]').addEventListener("click", () => {
    const url = data.channel_url;
    if (window.Telegram?.WebApp?.openTelegramLink && /t\.me\//.test(url)) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.Telegram?.WebApp?.openLink?.(url) || window.open(url, "_blank");
    }
  });
}

function openTaskDetails(t) {
  if (!t) return;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="task-card-icon">${iconHtml(t.icon, "xl", t.name)}</div>
    <h2 style="text-align:center;margin-top:0">${escapeHtml(t.name)}</h2>
    <p style="color:var(--text-soft); text-align:center; margin: 6px 0 14px">${escapeHtml(t.description)}</p>
    <div class="task-card-reward">Награда: ${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${t.reward} монет</div>
    <button class="btn" id="start-btn">Начать</button>
    <button class="btn btn-secondary" style="margin-top:8px" onclick="closeModal()">Закрыть</button>
  `);
  modal.querySelector("#start-btn").addEventListener("click", async () => {
    try {
      await post(`/api/tasks/${t.id}/start`);
      window.kov.toast("Задание начато — выполняй и жди подтверждения админа");
      window.closeModal();
      window.kov.setTab("home");
    } catch (e) {
      window.kov.toast(e.message);
    }
  });
}

async function openLegal(slug) {
  try {
    const txt = await get(`/api/content/legal/${slug}`);
    window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2>${escapeHtml(txt.title)}</h2>
      <div class="legal-text">${escapeHtml(txt.body)}</div>
    `);
  } catch (e) {
    window.kov.toast(e.message);
  }
}

async function openWheel() {
  try {
    const status = await get("/api/wheel/status");
    const sectors = status.sectors;
    const colors = ["#F2B33C", "#6CB6FB", "#E25C73", "#6BD995", "#D387E5", "#7BD3D3", "#F58E5D", "#A1A4E5"];
    const N = sectors.length;
    const seg = 360 / N;
    const radius = 130;
    const cx = 140,
      cy = 140;
    const arcPath = (start, end) => {
      const s = ((start - 90) * Math.PI) / 180;
      const e = ((end - 90) * Math.PI) / 180;
      const large = end - start > 180 ? 1 : 0;
      const x1 = cx + radius * Math.cos(s),
        y1 = cy + radius * Math.sin(s);
      const x2 = cx + radius * Math.cos(e),
        y2 = cy + radius * Math.sin(e);
      return `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`;
    };
    const renderSectorIcon = (s, x, y, mid) => {
      const size = 28;
      const isFile = typeof s.icon === "string" && (s.icon.startsWith("/") || s.icon.startsWith("http"));
      if (isFile) {
        return `<image href="${s.icon}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" style="image-rendering: pixelated;" transform="rotate(${mid}, ${x}, ${y})"/>`;
      }
      return `<text x="${x}" y="${y}" text-anchor="middle" transform="rotate(${mid}, ${x}, ${y})">${s.icon}</text>`;
    };
    const slices = sectors
      .map((s, i) => {
        const start = i * seg;
        const end = (i + 1) * seg;
        const mid = start + seg / 2;
        const r = radius * 0.65;
        const rad = ((mid - 90) * Math.PI) / 180;
        const tx = cx + r * Math.cos(rad);
        const ty = cy + r * Math.sin(rad);
        return `
          <path d="${arcPath(start, end)}" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="2"/>
          ${renderSectorIcon(s, tx, ty, mid)}
        `;
      })
      .join("");

    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2 style="text-align:center; margin-top:0">Ежедневное колесо фортуны</h2>
      <p style="text-align:center; color:var(--text-soft); margin:0 0 12px">Крутите колесо и выигрывайте монеты и призы!</p>
      <div class="wheel-stage">
        <div class="wheel-wrap">
          <div class="wheel-pointer"></div>
          <svg class="wheel-svg" id="wheel-svg" viewBox="0 0 280 280">${slices}</svg>
          <div class="wheel-center">${iconHtml("/static/img/ui/castle.svg", "md", "")}</div>
        </div>
        <button class="btn" id="spin-btn" ${status.can_spin ? "" : "disabled"}>
          ${status.can_spin ? "Крутить" : "Доступно завтра"}
        </button>
        <div class="wheel-prize" id="prize">
          <div class="ic" id="prize-ic">${iconHtml("/static/img/ui/box.svg", "lg", "")}</div>
          <div class="lbl" id="prize-lbl"></div>
        </div>
      </div>
    `);

    const svg = modal.querySelector("#wheel-svg");
    const spinBtn = modal.querySelector("#spin-btn");
    let currentRot = 0;

    spinBtn.addEventListener("click", async () => {
      spinBtn.disabled = true;
      try {
        const result = await post("/api/wheel/spin");
        const idx = result.sector_index;
        const targetAngle = -(idx * seg + seg / 2);
        const fullSpins = 5;
        const finalRot = currentRot + fullSpins * 360 + (targetAngle - (currentRot % 360));
        svg.style.transform = `rotate(${finalRot}deg)`;
        currentRot = finalRot;
        setTimeout(() => {
          const prize = modal.querySelector("#prize");
          modal.querySelector("#prize-ic").innerHTML = iconHtml(result.result.icon, "lg", "");
          modal.querySelector("#prize-lbl").textContent = result.result.prize_label;
          prize.classList.add("show");
        }, 4600);
      } catch (e) {
        window.kov.toast(e.message);
        spinBtn.disabled = false;
      }
    });
  } catch (e) {
    window.kov.toast(e.message);
  }
}
