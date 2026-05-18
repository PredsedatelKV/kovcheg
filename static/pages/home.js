import { get, post, iconHtml } from "/static/api.js";
import { openAssistantChat } from "/static/pages/assistant.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function bannerCarousel(banners) {
  if (!banners.length) return "";
  return `
    <div class="carousel narrow">
      <div class="carousel-track" id="bn-track">
        ${banners
          .map(
            (b) => `<div class="slide"><div class="banner" style="background-image:url('${escapeHtml(b.image_url)}')"></div></div>`,
          )
          .join("")}
      </div>
      <div class="dots" id="bn-dots">
        ${banners.map((_, i) => `<span class="dot ${i === 0 ? "active" : ""}"></span>`).join("")}
      </div>
    </div>`;
}

function assistantCard() {
  return `
    <div class="card assistant-card-wide" id="assistant-card">
      <div class="assistant-bust">
        <img src="/static/img/villager.svg" alt="Мошонка"/>
      </div>
      <div class="assistant-text">
        <div class="assistant-label">Ассистент</div>
        <h3 class="assistant-name">Мошонка</h3>
        <p class="assistant-sub">Верный спутник граждан Ковчега</p>
      </div>
      <span class="assistant-arrow">›</span>
    </div>`;
}

function bigSquareCard(opts) {
  if (opts.type === "wheel") {
    return `
      <div class="card big-square ${opts.cssClass || ""}" id="${opts.id}">
        <div class="big-square-visual wheel-visual"></div>
        <div class="big-square-footer">
          <span class="big-square-title">${escapeHtml(opts.title)}</span>
          <span class="big-square-arrow">›</span>
        </div>
      </div>`;
  }
  if (opts.type === "news" && opts.imageUrl) {
    return `
      <div class="card big-square ${opts.cssClass || ""}" id="${opts.id}">
        <div class="big-square-visual news-visual" style="background-image:url('${escapeHtml(opts.imageUrl)}')"></div>
        <div class="big-square-footer">
          <span class="big-square-title">${escapeHtml(opts.title)}</span>
          <span class="big-square-arrow">›</span>
        </div>
      </div>`;
  }
  return `
    <div class="card big-square ${opts.cssClass || ""}" id="${opts.id}">
      <div class="big-square-icon">${iconHtml(opts.icon, "lg", opts.title)}</div>
      <div class="big-square-footer">
        <span class="big-square-title">${escapeHtml(opts.title)}</span>
        <span class="big-square-arrow">›</span>
      </div>
    </div>`;
}

function fullNewsCard(n) {
  if (!n) return "";
  return `
    <div class="card full-news-card" id="full-news-card">
      <div class="full-news-image" style="background-image:url('${escapeHtml(n.image_url)}')"></div>
      <div class="full-news-body">
        <h3>${escapeHtml(n.title)}</h3>
        <p>${escapeHtml(n.body)}</p>
        <div class="full-news-date">${fmtDate(n.published_at)}</div>
      </div>
    </div>`;
}

function taskRow(t) {
  return `
    <div class="task-row" data-task-id="${t.id}">
      <div class="ico">${iconHtml(t.icon, "md", t.name)}</div>
      <div class="meta">
        <h4>${escapeHtml(t.name)}</h4>
        <p>Награда: ${t.reward} K</p>
      </div>
      <button class="btn btn-sm" data-action="start" data-task-id="${t.id}">Начать</button>
    </div>`;
}

function tasksList(tasks) {
  if (!tasks.length) return `<div class="empty">Заданий пока нет</div>`;
  return `<div class="tasks-list">${tasks.map(taskRow).join("")}</div>`;
}

export async function renderHome(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/home");
  const user = data.user;
  const welcome = "Добро пожаловать!";
  
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${welcome}</h1>
        <div class="subtitle">${escapeHtml(data.server_time_msk)} мск</div>
      </div>
      <div class="hero-art" title="Ковчег"><img src="/static/img/cube.svg" alt="Ковчег" class="hero-img"/></div>
    </section>

    ${bannerCarousel(data.banners)}

    ${assistantCard()}

    <div class="square-row">
      ${bigSquareCard({ id: "wheel-card", type: "wheel", title: "Колесо фортуны", sub: "Крути и выигрывай!", cssClass: "wheel-square" })}
      ${bigSquareCard({ id: "news-card", type: "news", title: (data.news && data.news.title) || "Новости", sub: data.news ? "Последняя новость" : "Пока пусто", imageUrl: data.news && data.news.image_url, cssClass: "news-square" })}
    </div>

    <h2 class="section-title">План</h2>
    ${
      data.daily_plan
        ? `<div class="card plan-card">
            <div class="plan-icon">${iconHtml(data.daily_plan.icon, "lg", "План")}</div>
            <div style="flex:1">
              <h3 class="card-title">${escapeHtml(data.daily_plan.name)}</h3>
              <p class="card-sub">${escapeHtml(data.daily_plan.description.split("\n")[0])}</p>
              <span class="mandatory-tag">Обязательный</span>
            </div>
            <span class="lock">${iconHtml("/static/img/ui/lock.svg", "sm", "Заблокировано")}</span>
          </div>`
        : ""
    }

    <h2 class="section-title">Задания <button class="see-all" data-action="all-tasks">Смотреть все</button></h2>
    ${tasksList(data.tasks.slice(0, 3))}

    <div class="quick-actions-grid">
      <button class="chip big-chip" data-action="legal" data-slug="constitution">
        ${iconHtml("/static/img/ui/book.svg", "md", "")}<span>Конституция</span>
      </button>
      <button class="chip big-chip" data-action="legal" data-slug="laws">
        ${iconHtml("/static/img/ui/scales.svg", "md", "")}<span>Законодательство</span>
      </button>
      <button class="chip big-chip" data-action="channel">
        ${iconHtml("/static/img/ui/mail.svg", "md", "")}<span>Телеграм канал</span>
      </button>
      <button class="chip big-chip" data-action="settings">
        ${iconHtml("/static/img/ui/spark.svg", "md", "")}<span>Настройки</span>
      </button>
    </div>
  `;

  const track = root.querySelector("#bn-track");
  const dots = root.querySelectorAll("#bn-dots .dot");
  if (track && dots.length) {
    track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, idx) => d.classList.toggle("active", idx === i));
    });
  }

  root.querySelector("#assistant-card").addEventListener("click", openAssistantChat);
  root.querySelector("#wheel-card").addEventListener("click", openWheel);
  const newsCard = root.querySelector("#news-card");
  if (newsCard) newsCard.addEventListener("click", openAllNews);
  const fullNewsCard = root.querySelector("#full-news-card");
  if (fullNewsCard) fullNewsCard.addEventListener("click", openAllNews);

  const allTasksList = data.tasks;
  root.querySelectorAll('[data-action="start"]').forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.taskId;
      openTaskDetails(allTasksList.find((t) => String(t.id) === String(id)));
    });
  });
  root.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.taskId;
      openTaskDetails(allTasksList.find((t) => String(t.id) === String(id)));
    });
  });

  root.querySelector('[data-action="all-tasks"]').addEventListener("click", () =>
    openAllTasks(allTasksList),
  );

  root.querySelectorAll('[data-action="legal"]').forEach((btn) =>
    btn.addEventListener("click", () => openLegal(btn.dataset.slug)),
  );
  const settingsBtn = root.querySelector('[data-action="settings"]');
  if (settingsBtn) settingsBtn.addEventListener("click", () => {
    import("/static/pages/settings.js").then((m) => m.openSettings());
  });

function openAllTasks(tasks) {
  const body = tasks.length
    ? `<div class="tasks-list">${tasks.map(taskRow).join("")}</div>`
    : `<div class="empty">Заданий пока нет</div>`;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Все задания</h2>
    <p class="card-sub" style="margin: 0 0 14px">Открой задание, чтобы прочитать детали и начать.</p>
    ${body}
  `);
  modal.querySelectorAll('[data-action="start"]').forEach((btn) =>
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.taskId;
      const t = tasks.find((x) => String(x.id) === String(id));
      window.closeModal();
      setTimeout(() => openTaskDetails(t), 80);
    }),
  );
  modal.querySelectorAll(".task-row").forEach((row) =>
    row.addEventListener("click", () => {
      const id = row.dataset.taskId;
      const t = tasks.find((x) => String(x.id) === String(id));
      window.closeModal();
      setTimeout(() => openTaskDetails(t), 80);
    }),
  );
}

async function openAllNews() {
  let items = [];
  try {
    items = await get("/api/home/news");
  } catch (e) {
    window.kov.toast(e.message);
    return;
  }
  const body = items.length
    ? `<div style="display:flex;flex-direction:column;gap:14px">${items.map(fullNewsCard).join("")}</div>`
    : `<div class="empty">Новостей пока нет</div>`;
  window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Все новости</h2>
    <p class="card-sub" style="margin: 0 0 14px">Последние события и объявления.</p>
    ${body}
  `);
}

function openTaskDetails(t) {
  if (!t) return;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="task-card-icon">${iconHtml(t.icon, "xl", t.name)}</div>
    <h2 style="text-align:center;margin-top:0">${escapeHtml(t.name)}</h2>
    <p style="color:var(--text-soft); text-align:center; margin: 6px 0 14px">${escapeHtml(t.description)}</p>
    <div class="task-card-reward">Награда: ${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${t.reward} K</div>
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
    const cx = 140, cy = 140;
    const arcPath = (start, end) => {
      const s = ((start - 90) * Math.PI) / 180;
      const e = ((end - 90) * Math.PI) / 180;
      const large = end - start > 180 ? 1 : 0;
      const x1 = cx + radius * Math.cos(s), y1 = cy + radius * Math.sin(s);
      const x2 = cx + radius * Math.cos(e), y2 = cy + radius * Math.sin(e);
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
      <p style="text-align:center; color:var(--text-soft); margin:0 0 12px">Крутите колесо и выигрывайте K и призы!</p>
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
