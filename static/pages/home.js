import { get, post, iconHtml } from "/static/api.js?v=30";

import { openAssistantChat } from "/static/pages/assistant.js?v=31";

import { playUISound } from "/static/pages/settings.js?v=30";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function bannerCarousel(banners) {
  if (!banners.length) return "";
  if (banners.length === 1) return `
    <div class="carousel narrow">
      <div class="banner solo" style="background-image:url('${escapeHtml(banners[0].image_url)}')"></div>
    </div>`;
  const n = banners.length;
  const all = [banners[n - 1], ...banners, banners[0]];
  return `
    <div class="carousel narrow" id="bn-carousel">
      <div class="carousel-track" id="bn-track">
        ${all.map((b, i) => {
          const isClone = i === 0 || i === all.length - 1;
          return `<div class="slide" data-banner-idx="${(i - 1 + n) % n}"${isClone ? ' data-clone="true"' : ''}><div class="banner" style="background-image:url('${escapeHtml(b.image_url)}')"></div></div>`;
        }).join("")}
      </div>
      <button class="carousel-arrow carousel-arrow-left" id="bn-prev">‹</button>
      <button class="carousel-arrow carousel-arrow-right" id="bn-next">›</button>
      <div class="dots" id="bn-dots">
        ${banners.map((_, i) => `<span class="dot ${i === 0 ? "active" : ""}"></span>`).join("")}
      </div>
    </div>`;
}

function assistantCard() {
  return `
    <div class="card assistant-card-wide" id="assistant-card">
      <div class="assistant-bust">
        <div class="assistant-bust-bg"></div>
        <div class="assistant-bust-img"></div>
      </div>
      <div class="assistant-text">
        <div class="assistant-label">ИИ-ассистент</div>
        <h3 class="assistant-name">Мошонка</h3>
        <p class="assistant-sub">Верный спутник граждан Ковчега</p>
      </div>
      <span class="assistant-arrow">›</span>
    </div>`;
}

function bigSquareCard(opts) {
  if (opts.type === "wheel") {
    return `
      <div class="card big-square ${opts.cssClass || ''}" id="${opts.id}">
        <div class="big-square-visual wheel-visual">
          <img src="/static/img/ui/wheel_fortune.png" alt="Колесо фортуны" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"/>
        </div>
        <div class="big-square-footer">
          <span class="big-square-title">${escapeHtml(opts.title)}</span>
          <span class="big-square-arrow">›</span>
        </div>
      </div>`;
  }
  if (opts.type === "news") {
    const slides = opts.slides || [];
    const hasSlides = slides.length > 0;
    return `
      <div class="card big-square ${opts.cssClass || ''}" id="${opts.id}">
        <div class="big-square-visual news-visual" id="news-visual">
          ${hasSlides
            ? slides.map((s, i) => `<div class="news-slide ${i === 0 ? 'active' : ''}" style="background-image:url('${escapeHtml(s.image_url)}')" data-news-idx="${i}"></div>`).join("")
            : `<div class="big-square-icon">${iconHtml("/static/img/ui/mail.svg", "lg", "Новости")}</div>`
          }
        </div>
        <div class="big-square-footer">
          <span class="big-square-title">${hasSlides ? escapeHtml(slides[0].title) : escapeHtml(opts.title)}</span>
          <span class="big-square-arrow">›</span>
        </div>
      </div>`;
  }
  return `
    <div class="card big-square ${opts.cssClass || ''}" id="${opts.id}">
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

function taskRow(t, userTasks) {
  const startedIds = userTasks ? userTasks.map(ut => String(ut.task.id)) : [];
  const isStarted = startedIds.includes(String(t.id));
  return `
    <div class="task-row" data-task-id="${t.id}" ${isStarted ? 'data-in-progress="true"' : ''}>
      <div class="meta">
        <h4>${escapeHtml(t.name)}</h4>
        <p>Награда: ${t.reward} K</p>
      </div>
      ${isStarted
        ? `<span class="task-status task-status-in_progress">В процессе</span>`
        : `<button class="btn btn-sm" data-action="start" data-task-id="${t.id}">Начать</button>`
      }
    </div>`;
}

function tasksList(tasks, userTasks) {
  if (!tasks.length) return `<div class="empty">Заданий пока нет</div>`;
  return `<div class="tasks-list">${tasks.map(t => taskRow(t, userTasks)).join("")}</div>`;
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
      ${bigSquareCard({ id: "wheel-card", type: "wheel", title: "Колесо фортуны", cssClass: "wheel-square" })}
      ${bigSquareCard({ id: "news-card", type: "news", title: "Новости", slides: data.news || [], cssClass: "news-square" })}
    </div>

    ${
      data.daily_plan
        ? `<div class="card plan-card">
            <div class="plan-icon">${iconHtml(data.daily_plan.icon, "lg", "План")}</div>
            <div style="flex:1">
              <h3 class="card-title" style="margin-top:4px">${escapeHtml(data.daily_plan.name)}</h3>
              <p class="card-sub" style="padding-top:3pt">${escapeHtml(data.daily_plan.description || "")}</p>
            </div>
            ${data.daily_plan.is_completed
              ? `<span class="plan-badge plan-badge-done">Выполнен</span>`
              : ""
            }
          </div>`
        : ""
    }

    <div class="card tasks-card">
      <div class="tasks-head">
        <h3 class="card-title">Задания</h3>
        <button class="see-all" data-action="all-tasks">Смотреть все</button>
      </div>
      ${tasksList(data.tasks.slice(0, 3), data.user_tasks)}
    </div>

    <div class="chip-row">
      <button class="chip big-chip" data-action="legal" data-slug="constitution">
        ${iconHtml("/static/img/ui/constitution.svg", "md", "")}<span>Конституция</span>
      </button>
      <button class="chip big-chip" data-action="legal" data-slug="laws">
        ${iconHtml("/static/img/ui/scales.svg", "md", "")}<span>Законодательство</span>
      </button>
      <button class="chip big-chip" data-action="channel">
        ${iconHtml("/static/img/ui/telegram.svg", "md", "")}<span>Телеграм канал</span>
      </button>
      <button class="chip big-chip" data-action="settings">
        ${iconHtml("/static/img/ui/settings.svg", "md", "")}<span>Настройки</span>
      </button>
    </div>
  `;

  const carousel = root.querySelector("#bn-carousel");
  if (carousel) {
    const track = carousel.querySelector("#bn-track");
    const dots = carousel.querySelectorAll("#bn-dots .dot");
    const prevBtn = carousel.querySelector("#bn-prev");
    const nextBtn = carousel.querySelector("#bn-next");
    const total = dots.length;
    if (total > 1) {
      const step = track.querySelector(".slide").offsetWidth + 10;
      let currentIdx = 0;

      const updateDots = () => {
        dots.forEach((d, i) => d.classList.toggle("active", i === currentIdx));
      };

      let jumpTimer;
      track.addEventListener("scroll", () => {
        const vpCenter = track.getBoundingClientRect().left + track.clientWidth / 2;
        let best = 0, bestDist = Infinity;
        track.querySelectorAll(".slide").forEach((el) => {
          const r = el.getBoundingClientRect();
          const d = Math.abs(r.left + r.width / 2 - vpCenter);
          if (d < bestDist) { bestDist = d; best = +el.dataset.bannerIdx; }
        });
        currentIdx = best;
        updateDots();

        clearTimeout(jumpTimer);
        jumpTimer = setTimeout(() => {
          const vpCenter = track.getBoundingClientRect().left + track.clientWidth / 2;
          let best = null, bestDist = Infinity;
          track.querySelectorAll(".slide").forEach((el) => {
            const r = el.getBoundingClientRect();
            const d = Math.abs(r.left + r.width / 2 - vpCenter);
            if (d < bestDist) { bestDist = d; best = el; }
          });
          if (!best || best.dataset.clone !== "true") return;
          const idx = best.dataset.bannerIdx;
          const real = track.querySelector('.slide[data-clone="false"][data-banner-idx="' + idx + '"]');
          if (!real) return;
          track.style.scrollBehavior = "auto";
          track.scrollLeft = real.offsetLeft + real.offsetWidth / 2 - track.clientWidth / 2;
          track.style.scrollBehavior = "smooth";
        }, 60);
      });

      prevBtn.addEventListener("click", () => { playUISound("click"); track.scrollBy({ left: -step, behavior: "smooth" }); });
      nextBtn.addEventListener("click", () => { playUISound("click"); track.scrollBy({ left: step, behavior: "smooth" }); });

      track.scrollTo({ left: step, behavior: "instant" });
      updateDots();
    }
  }

  const newsSlides = root.querySelectorAll("#news-visual .news-slide");
  const newsTitleEl = root.querySelector("#news-card .big-square-title");
  if (newsSlides.length > 1) {
    let currentSlide = 0;
    setInterval(() => {
      newsSlides[currentSlide].classList.remove("active");
      currentSlide = (currentSlide + 1) % newsSlides.length;
      newsSlides[currentSlide].classList.add("active");
      const idx = Number(newsSlides[currentSlide].dataset.newsIdx);
      if (newsTitleEl && data.news && data.news[idx]) {
        newsTitleEl.textContent = data.news[idx].title;
      }
    }, 5000);
  }

  const ac = root.querySelector("#assistant-card");
  if (ac) ac.addEventListener("click", () => { playUISound("click"); openAssistantChat(); });
  root.querySelector("#wheel-card").addEventListener("click", () => { playUISound("click"); openWheel(); });
  const newsCard = root.querySelector("#news-card");
  if (newsCard) newsCard.addEventListener("click", () => { playUISound("click"); openAllNews(); });
  const newsVisual = root.querySelector("#news-visual");
  if (newsVisual) {
    newsVisual.addEventListener("click", (e) => {
      e.stopPropagation();
      playUISound("click");
      openAllNews();
    });
  }

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
      if (row.dataset.inProgress === "true") return;
      const id = row.dataset.taskId;
      openTaskDetails(allTasksList.find((t) => String(t.id) === String(id)));
    });
  });

  root.querySelector('[data-action="all-tasks"]').addEventListener("click", () =>
    openAllTasks(allTasksList, data.user_tasks),
  );

  root.querySelectorAll('[data-action="legal"]').forEach((btn) =>
    btn.addEventListener("click", () => openLegal(btn.dataset.slug)),
  );
  const settingsBtn = root.querySelector('[data-action="settings"]');
  if (settingsBtn) settingsBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    import("/static/pages/settings.js?v=16").then((m) => m.openSettings()).catch((e) => console.error("Settings load error:", e));
  });
  const channelBtn = root.querySelector('[data-action="channel"]');
  if (channelBtn) channelBtn.addEventListener("click", () => {
    window.open("https://t.me/+2fe2Nsj0J9FiYzky", "_blank");
  });

  loadQuizzes(root);
}

async function openAllNews() {
  try {
    const news = await get("/api/home/news");
    if (!news.length) { window.kov.toast("Новостей пока нет"); return; }
    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2>Новости</h2>
      <div style="display:flex;flex-direction:column;gap:16px;margin-top:12px;overflow-y:auto;max-height:60dvh">
        ${news.map(n => `
          <div class="full-news-card" style="flex-shrink:0;margin-bottom:0">
            <div class="full-news-image" style="background-image:url('${escapeHtml(n.image_url)}')"></div>
            <div class="full-news-body">
              <h3>${escapeHtml(n.title)}</h3>
              <p>${escapeHtml(n.body)}</p>
              <div class="full-news-date">${fmtDate(n.published_at)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `);
  } catch (e) {
    window.kov.toast(e.message);
  }
}

function openAllTasks(tasks, userTasks) {
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Все задания</h2>
    <p class="card-sub" style="margin:0 0 14px">Доступные задания для выполнения.</p>
    ${tasks.length === 0
      ? `<div class="empty">Заданий пока нет.</div>`
      : `<div class="tasks-list">${tasks.map(t => taskRow(t, userTasks)).join("")}</div>`}
  `);
  modal.querySelectorAll('[data-action="start"]').forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.taskId;
      openTaskDetails(tasks.find((t) => String(t.id) === String(id)));
    });
  });
  modal.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      if (row.dataset.inProgress === "true") return;
      const id = row.dataset.taskId;
      openTaskDetails(tasks.find((t) => String(t.id) === String(id)));
    });
  });
}

function openTaskDetails(t) {
  if (!t) return;
  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2 style="text-align:center;margin-top:8px">${escapeHtml(t.name)}</h2>
    <p style="color:var(--text-soft);font-size:14px;margin:8px 0 16px;text-align:center">${escapeHtml(t.description)}</p>
    <div class="task-card-reward">Награда: ${iconHtml("/static/img/ui/coin.svg", "sm", "")} ${t.reward} K</div>
    <button class="btn" id="start-btn" style="margin-top:16px">Начать</button>
  `);
  modal.querySelector("#start-btn").addEventListener("click", async () => {
    try {
      await post(`/api/tasks/${t.id}/start`);
      window.kov.toast("Задание начато — выполняй и жди подтверждения админа");
      window.closeModal();
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
    const N = sectors.length;
    const seg = 360 / N;
    const cx = 190, cy = 190, innerR = 162, contentR = 110;

    const arcPath = (start, end, r) => {
      const s = ((start - 90) * Math.PI) / 180;
      const e = ((end - 90) * Math.PI) / 180;
      const large = end - start > 180 ? 1 : 0;
      return `M${cx},${cy} L${cx + r * Math.cos(s)},${cy + r * Math.sin(s)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(e)},${cy + r * Math.sin(e)} Z`;
    };

    const slices = sectors.map((s, i) => {
      const start = i * seg, end = (i + 1) * seg, mid = start + seg / 2;
      const rad = ((mid - 90) * Math.PI) / 180;
      const c1 = i % 2 === 0 ? "#FFD700" : "#F0C040";
      const c2 = i % 2 === 0 ? "#DAA520" : "#C8961E";
      const c3 = i % 2 === 0 ? "#E6B800" : "#D4A020";

      const cx2 = cx + contentR * Math.cos(rad);
      const cy2 = cy + contentR * Math.sin(rad);

      let content;
      if (s.kind === "coins") {
        const val = s.value;
        content = `
          <text x="${cx2}" y="${cy2 - 10}" text-anchor="middle" font-size="20" font-weight="800" fill="#fff" transform="rotate(${mid},${cx2},${cy2})" style="text-shadow:0 2px 4px rgba(0,0,0,.45)">${val}</text>
          <image href="/static/img/ui/coin.svg" x="${cx2 - 12}" y="${cy2 + 2}" width="24" height="24" transform="rotate(${mid},${cx2},${cy2})"/>`;
      } else {
        content = `<image href="${s.icon}" x="${cx2 - 20}" y="${cy2 - 20}" width="40" height="40" transform="rotate(${mid},${cx2},${cy2})"/>`;
      }

      return `
        <defs>
          <linearGradient id="sg${i}" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c3}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>
        </defs>
        <path d="${arcPath(start, end, innerR)}" fill="url(#sg${i})" stroke="#B8860B" stroke-width="2"/>
        ${content}
      `;
    }).join("");

    const tickMarks = Array.from({ length: N * 4 }, (_, i) => {
      const a = ((i * seg / 4 - 90) * Math.PI) / 180;
      const r1 = 172, r2 = 182;
      return `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}" stroke="${i % 4 === 0 ? "#FFD700" : "rgba(255,215,0,.5)"}" stroke-width="${i % 4 === 0 ? 3 : 1.5}" stroke-linecap="round"/>`;
    }).join("");

    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2 style="text-align:center;margin-top:0;margin-bottom:4px">Ежедневное колесо фортуны</h2>
      <p style="text-align:center;color:var(--text-soft);margin:0 0 10px;font-size:13px">Крутите колесо и выигрывайте K и призы!</p>
      <div class="wheel-stage">
        <div class="wheel-wrap">
          <div class="wheel-pointer"></div>
          <svg class="wheel-svg" id="wheel-svg" viewBox="0 0 380 380">
            <defs>
              <radialGradient id="rimGrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFEAA7"/><stop offset="60%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/></radialGradient>
              <filter id="dropGlow"><feDropShadow dx="0" dy="3" stdDeviation="6" flood-opacity=".4"/></filter>
            </defs>
            <circle cx="${cx}" cy="${cy}" r="194" fill="#B8860B" opacity=".2" filter="url(#dropGlow)"/>
            <circle cx="${cx}" cy="${cy}" r="188" fill="url(#rimGrad)" stroke="#8B6914" stroke-width="2"/>
            <circle cx="${cx}" cy="${cy}" r="176" fill="none" stroke="rgba(139,105,20,.25)" stroke-width="3"/>
            ${tickMarks}
            <g filter="url(#dropGlow)">${slices}</g>
            <circle cx="${cx}" cy="${cy}" r="18" fill="#FFD700" stroke="#B8860B" stroke-width="2"/>
            <circle cx="${cx}" cy="${cy}" r="11" fill="#FFF8DC"/>
          </svg>
        </div>
        <button class="btn" id="spin-btn" ${status.can_spin ? "" : "disabled"}>
          ${status.can_spin ? "Крутить" : "Доступно завтра"}
        </button>
        <div class="wheel-prize" id="prize">
          <div class="ic" id="prize-ic">${iconHtml("/static/img/ui/coin.svg", "lg", "")}</div>
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

async function loadQuizzes(root) {
  const container = root.querySelector("#quiz-list");
  if (!container) return;
  try {
    const quizzes = await get("/api/quiz/available");
    if (quizzes.length === 0) {
      container.innerHTML = `<div class="empty">Нет доступных тестов</div>`;
      return;
    }
    const passed = quizzes.find((q) => q.already_passed);
    if (passed) {
      container.innerHTML = `<div class="empty">Тестирование пройдено</div>`;
      return;
    }
    container.innerHTML = quizzes.map((q) => `
      <div class="quiz-row" data-quiz-id="${q.id}">
        <div class="quiz-row-info">
          <h4>${escapeHtml(q.title)}</h4>
          <p>${escapeHtml(q.description || "")} ${q.question_count} вопросов · Приз: ${escapeHtml(q.prize_label)}</p>
        </div>
        <div class="quiz-row-badge">▶</div>
      </div>
    `).join("");

    container.querySelectorAll(".quiz-row").forEach((row) => {
      row.addEventListener("click", () => {
        openQuiz(Number(row.dataset.quizId));
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty">Ошибка загрузки</div>`;
  }
}

async function openQuiz(quizId) {
  let questions = [];
  try {
    questions = await get(`/api/quiz/${quizId}/start`);
  } catch (err) {
    window.kov.toast(err.message);
    return;
  }
  if (questions.length === 0) {
    window.kov.toast("В тесте нет вопросов");
    return;
  }

  const modal = window.kov.showModal(`
    <button class="close" onclick="closeModal()">×</button>
    <h2>Тест</h2>
    <div id="quiz-questions"></div>
    <button class="btn" id="quiz-submit" style="margin-top:16px">Ответить</button>
  `);

  const container = modal.querySelector("#quiz-questions");
  container.innerHTML = questions.map((q, i) => `
    <div class="quiz-q-block" data-qid="${q.id}">
      <p class="quiz-q-text">${i + 1}. ${escapeHtml(q.text)}</p>
      <div class="quiz-options">
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="a"/> <span>A</span> ${escapeHtml(q.option_a)}</label>
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="b"/> <span>B</span> ${escapeHtml(q.option_b)}</label>
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="c"/> <span>C</span> ${escapeHtml(q.option_c)}</label>
        <label class="quiz-opt"><input type="radio" name="q-${q.id}" value="d"/> <span>D</span> ${escapeHtml(q.option_d)}</label>
      </div>
    </div>
  `).join("");

  modal.querySelector("#quiz-submit").addEventListener("click", async () => {
    const answers = {};
    questions.forEach((q) => {
      const sel = modal.querySelector(`input[name="q-${q.id}"]:checked`);
      if (sel) answers[q.id] = sel.value;
    });
    if (Object.keys(answers).length < questions.length) {
      window.kov.toast("Ответь на все вопросы");
      return;
    }
    try {
      const result = await post("/api/quiz/submit", { quiz_id: quizId, answers });
      window.closeModal();
      const gradeLabels = { bad: "Не сдан", good: "Хорошо", excellent: "Отлично" };
      window.kov.showModal(`
        <button class="close" onclick="closeModal()">×</button>
        <h2>Результат</h2>
        <div style="text-align:center; padding: 20px 0">
          <div style="font-size:48px; font-weight:800">${result.score}/${result.total}</div>
          <div style="font-size:18px; margin-top:8px; color:var(--primary)">${gradeLabels[result.grade] || result.grade}</div>
          ${result.prize_awarded
            ? `<div class="quiz-prize-awarded" style="margin-top:16px">🎁 Приз получен: ${escapeHtml(result.prize_label)}</div>`
            : ""
          }
        </div>
        <button class="btn" style="margin-top:16px" onclick="closeModal()">Закрыть</button>
      `);
    } catch (err) {
      window.kov.toast(err.message);
    }
  });
}
