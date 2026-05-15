import { get, post } from "/static/api.js";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function bannerCarousel(banners) {
  if (!banners.length) return "";
  return `
    <div class="carousel">
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

function tasksList(tasks) {
  if (!tasks.length) return `<div class="empty">Заданий пока нет</div>`;
  return `<div class="tasks-list">${tasks
    .map(
      (t) => `
        <div class="task-row" data-task-id="${t.id}">
          <div class="ico">${t.icon}</div>
          <div class="meta">
            <h4>${escapeHtml(t.name)}</h4>
            <p>Награда: ${t.reward} монет</p>
          </div>
          <button class="btn btn-sm" data-action="start" data-task-id="${t.id}">Начать</button>
        </div>`,
    )
    .join("")}</div>`;
}

export async function renderHome(root) {
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/home");
  const user = data.user;
  const welcome = `${escapeHtml(user.first_name || "Гражданин")}, Добро пожаловать!`;
  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${welcome}</h1>
        <div class="subtitle">${escapeHtml(data.server_time_msk)} мск</div>
      </div>
      <div class="hero-art" title="Ковчег">🧱</div>
    </section>

    ${bannerCarousel(data.banners)}

    <div class="card wheel-card" id="wheel-card">
      <div class="wheel-thumb">🎡</div>
      <div>
        <h3 class="card-title">Ежедневное колесо фортуны</h3>
        <p class="card-sub">Крутите колесо и получайте ценные награды каждый день!</p>
      </div>
      <span class="arrow">›</span>
    </div>

    <h2 class="section-title">Новость <button class="see-all">Смотреть все</button></h2>
    ${
      data.news
        ? `<div class="card news-card">
            <img src="${escapeHtml(data.news.image_url)}" alt="" />
            <div class="news-body">
              <h3>${escapeHtml(data.news.title)}</h3>
              <p>${escapeHtml(data.news.body)}</p>
              <div class="date">${new Date(data.news.published_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</div>
            </div>
          </div>`
        : ""
    }

    <h2 class="section-title">План</h2>
    ${
      data.daily_plan
        ? `<div class="card plan-card">
            <div class="plan-icon">📜</div>
            <div style="flex:1">
              <h3 class="card-title">${escapeHtml(data.daily_plan.name)}</h3>
              <p class="card-sub">${escapeHtml(data.daily_plan.description.split("\n")[0])}</p>
              <span class="mandatory-tag">Обязательный</span>
            </div>
            <span class="lock">🔒</span>
          </div>`
        : ""
    }

    <h2 class="section-title">Задания <button class="see-all" data-action="profile-tab">Смотреть все</button></h2>
    ${tasksList(data.tasks.slice(0, 6))}

    <div class="quick-actions">
      <button class="chip" data-action="legal" data-slug="constitution">📖 <span>Конституция</span></button>
      <button class="chip" data-action="legal" data-slug="laws">⚖️ <span>Законодательство</span></button>
      <button class="chip" data-action="channel">✉️ <span>Телеграм канал</span></button>
    </div>
  `;

  // Banner dots
  const track = root.querySelector("#bn-track");
  const dots = root.querySelectorAll("#bn-dots .dot");
  if (track && dots.length) {
    track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, idx) => d.classList.toggle("active", idx === i));
    });
  }

  root.querySelector("#wheel-card").addEventListener("click", openWheel);
  root.querySelectorAll('[data-action="start"]').forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.taskId;
      openTaskDetails(data.tasks.find((t) => String(t.id) === String(id)));
    });
  });
  root.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.taskId;
      openTaskDetails(data.tasks.find((t) => String(t.id) === String(id)));
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
  const seeAllBtn = root.querySelector('[data-action="profile-tab"]');
  seeAllBtn?.addEventListener("click", () => window.kov.setTab("profile"));
}

function openTaskDetails(t) {
  if (!t) return;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <div class="task-card-icon">${t.icon}</div>
    <h2 style="text-align:center;margin-top:0">${escapeHtml(t.name)}</h2>
    <p style="color:var(--text-soft); text-align:center; margin: 6px 0 14px">${escapeHtml(t.description)}</p>
    <div class="task-card-reward">Награда: <span style="color: var(--accent)">🪙</span> ${t.reward} монет</div>
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

// Wheel: client-side animation, server picks the prize
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
          <text x="${tx}" y="${ty}" text-anchor="middle" transform="rotate(${mid}, ${tx}, ${ty})">${s.icon}</text>
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
          <div class="wheel-center">🏰</div>
        </div>
        <button class="btn" id="spin-btn" ${status.can_spin ? "" : "disabled"}>
          ${status.can_spin ? "Крутить" : "Доступно завтра"}
        </button>
        <div class="wheel-prize" id="prize">
          <div class="ic" id="prize-ic">🎁</div>
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
        // We want pointer to land on idx. Pointer is at top.
        // For each sector i, the center angle is i*seg + seg/2 from 0(=top). We need to rotate svg so that this angle is at top (0deg).
        // SVG rotation rotates clockwise from current. Target rotation = -(i*seg + seg/2) modulo 360, plus full spins.
        const targetAngle = -(idx * seg + seg / 2);
        const fullSpins = 5; // turns
        const finalRot = currentRot + fullSpins * 360 + (targetAngle - (currentRot % 360));
        svg.style.transform = `rotate(${finalRot}deg)`;
        currentRot = finalRot;

        setTimeout(() => {
          const prize = result.result;
          const box = modal.querySelector("#prize");
          modal.querySelector("#prize-ic").textContent = prize.icon;
          modal.querySelector("#prize-lbl").textContent =
            prize.kind === "coins" ? `+${prize.prize_value} монет` : prize.prize_label;
          box.classList.add("show");
          window.kov.toast("Поздравляем! Награда зачислена");
        }, 4700);
      } catch (e) {
        window.kov.toast(e.message);
        spinBtn.disabled = false;
      }
    });
  } catch (e) {
    window.kov.toast(e.message);
  }
}
