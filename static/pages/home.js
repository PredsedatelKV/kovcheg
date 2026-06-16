import { get, post, iconHtml } from "/static/api.js?v=213";

import { openAssistantChat } from "/static/pages/assistant.js?v=213";

import { playUISound } from "/static/pages/settings.js?v=213";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function bannerCarousel(banners) {
  if (!banners.length) return "";
  // Single banner: just show it, no carousel machinery.
  if (banners.length === 1) return `
    <div class="kc-carousel" id="bn-carousel" style="margin-bottom:14px">
      <div class="kc-viewport" style="overflow:hidden">
        <div class="kc-track" style="display:flex">
          <div class="kc-slide" style="flex:0 0 100%;box-sizing:border-box;padding:0 4px">
            <div class="banner" style="background-image:url('${escapeHtml(banners[0].image_url)}');width:100%;aspect-ratio:16/9;background-size:cover;background-position:center;border-radius:var(--radius-lg,16px)"></div>
          </div>
        </div>
      </div>
    </div>`;

  const n = banners.length;
  // For infinite looping we clone the last slide before the first and the
  // first slide after the last, then jump (without transition) when we hit
  // a clone. data-real holds the logical banner index for dot syncing.
  const seq = [banners[n - 1], ...banners, banners[0]];
  const slideHtml = (b, realIdx, clone) => `
    <div class="kc-slide" data-real="${realIdx}"${clone ? ' data-clone="1"' : ''}
         style="flex:0 0 80%;box-sizing:border-box;padding:0 6px">
      <div class="banner" style="background-image:url('${escapeHtml(b.image_url)}');width:100%;aspect-ratio:16/9;background-size:cover;background-position:center;border-radius:var(--radius,12px);box-shadow:0 6px 18px rgba(24,39,75,.10)"></div>
    </div>`;
  const slides = seq.map((b, i) => slideHtml(b, ((i - 1 + n) % n), i === 0 || i === seq.length - 1)).join("");
  const dots = banners.map(() => '<span class="dot" style="width:6px;height:6px;border-radius:50%;background:#D2D8E3;transition:all .25s ease"></span>').join("");
  return `
    <div class="kc-carousel" id="bn-carousel" style="margin-bottom:14px;touch-action:pan-y">
      <div class="kc-viewport" style="overflow:hidden">
        <div class="kc-track" id="bn-track" style="display:flex;will-change:transform">${slides}</div>
      </div>
      <div class="dots" id="bn-dots" style="display:flex;justify-content:center;gap:6px;padding:8px 0 2px">${dots}</div>
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
  var data;
  try {
    data = await get("/api/home");
  } catch (e) {
    root.innerHTML = '<div class="card"><p style="color:var(--danger)">Ошибка загрузки</p></div>';
    return;
  }
  const user = data.user;
  const welcome = "Добро пожаловать!";


  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${welcome}<span class="beta-badge">Beta</span></h1>
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

    <div class="card quiz-card" id="quiz-card">
      <div class="quiz-card-head">
        <h3 class="card-title">Тестирования</h3>
      </div>
      <div id="quiz-list"><div class="empty">Загрузка…</div></div>
    </div>

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

  // Load Battle Pass mini card
  get("/api/battlepass").then(function(bp) {
    if (!bp || !bp.season) return;
    var el = document.getElementById("bp-mini-card");
    if (!el) return;
    var s = bp.season;
    var lvl = Math.min(bp.current_level || 0, (s.total_levels || 1) - 1) + 1;
    var pct = bp.xp_for_level > 0
      ? Math.min(100, Math.round(((bp.current_xp || 0) / bp.xp_for_level) * 100))
      : 0;
    el.innerHTML = '<div class="card bp-mini-card" onclick="window.kov.setTab(\'battlepass\')">' +
      '<div class="bp-mini-banner"></div>' +
      '<div class="bp-mini-body">' +
        '<div class="bp-mini-head-row"><span class="bp-mini-title">' + escapeHtml(s.name) + '</span></div>' +
        '<div class="bp-mini-level-row"><span class="bp-mini-lvl-label">Уровень</span><span class="bp-mini-lvl-num">' + lvl + '</span><span class="bp-mini-xp">' + bp.current_xp + ' / ' + bp.xp_for_level + ' XP</span></div>' +
        '<div class="bp-mini-bar-wrap"><div class="bp-mini-bar" style="width:' + pct + '%"></div></div>' +
      '</div>' +
    '</div>';
  }).catch(function() {});

  const carousel = root.querySelector("#bn-carousel");
  const bnTrack = carousel && carousel.querySelector("#bn-track");
  const bnDots = carousel ? Array.from(carousel.querySelectorAll("#bn-dots .dot")) : [];
  if (bnTrack && bnDots.length > 1) {
    const n = bnDots.length;            // logical banner count
    const slides = Array.from(bnTrack.children); // n + 2 (with clones at ends)
    let pos = 1;                        // index in `slides` (1 == first real banner)
    const EASE = "transform .5s cubic-bezier(.22,.61,.36,1)";

    const slideWidth = () => slides[0].getBoundingClientRect().width;
    // Center the active slide: viewport shows ~80% slide, so peek = (100-80)/2 on each side.
    const offsetFor = (i) => {
      const w = slideWidth();
      const vw = bnTrack.parentElement.getBoundingClientRect().width;
      return -(i * w) + (vw - w) / 2;
    };
    const applyTransform = (animate) => {
      bnTrack.style.transition = animate ? EASE : "none";
      bnTrack.style.transform = `translateX(${offsetFor(pos)}px)`;
    };
    const syncDots = () => {
      const real = ((pos - 1) % n + n) % n;
      bnDots.forEach((d, i) => {
        const on = i === real;
        d.classList.toggle("active", on);
        d.style.background = on ? "var(--primary,#4D96FF)" : "#D2D8E3";
        d.style.width = on ? "18px" : "6px";
        d.style.borderRadius = on ? "6px" : "50%";
      });
    };

    // After a transition into a clone, jump silently to the matching real slide.
    bnTrack.addEventListener("transitionend", () => {
      if (slides[pos].dataset.clone) {
        pos = pos === 0 ? n : 1;
        applyTransform(false);
      }
    });

    const go = (delta) => { pos += delta; applyTransform(true); syncDots(); };

    // --- autoplay (smooth, single timer, reuses cleanup pattern below) ---
    let bnTimer = null;
    const startAuto = () => { stopAuto(); bnTimer = setInterval(() => go(1), 4500); };
    function stopAuto() { if (bnTimer) { clearInterval(bnTimer); bnTimer = null; } }

    // --- drag / swipe ---
    let dragging = false, startX = 0, startTf = 0;
    const onDown = (x) => {
      dragging = true; startX = x;
      stopAuto();
      const m = /translateX\(([-0-9.]+)px\)/.exec(bnTrack.style.transform);
      startTf = m ? parseFloat(m[1]) : offsetFor(pos);
      bnTrack.style.transition = "none";
    };
    const onMove = (x) => {
      if (!dragging) return;
      bnTrack.style.transform = `translateX(${startTf + (x - startX)}px)`;
    };
    const onUp = (x) => {
      if (!dragging) return;
      dragging = false;
      const dx = x - startX;
      const threshold = slideWidth() * 0.18;
      if (dx <= -threshold) go(1);
      else if (dx >= threshold) go(-1);
      else applyTransform(true);
      startAuto();
    };
    bnTrack.addEventListener("touchstart", (e) => onDown(e.touches[0].clientX), { passive: true });
    bnTrack.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX), { passive: true });
    bnTrack.addEventListener("touchend", (e) => onUp((e.changedTouches[0] || {}).clientX || startX));
    bnTrack.addEventListener("mousedown", (e) => { e.preventDefault(); onDown(e.clientX); });
    window.addEventListener("mousemove", (e) => onMove(e.clientX));
    window.addEventListener("mouseup", (e) => onUp(e.clientX));

    // Keep centering correct on resize / orientation change.
    window.addEventListener("resize", () => applyTransform(false));

    requestAnimationFrame(() => { applyTransform(false); syncDots(); startAuto(); });

    if (window.kov && window.kov.onTabChange) {
      window.kov.onTabChange("home", () => stopAuto());
    }
  }

  const newsSlides = root.querySelectorAll("#news-visual .news-slide");
  const newsTitleEl = root.querySelector("#news-card .big-square-title");
  if (newsSlides.length > 1) {
    let currentSlide = 0;
    const newsTimer = setInterval(() => {
      newsSlides[currentSlide].classList.remove("active");
      currentSlide = (currentSlide + 1) % newsSlides.length;
      newsSlides[currentSlide].classList.add("active");
      const idx = Number(newsSlides[currentSlide].dataset.newsIdx);
      if (newsTitleEl && data.news && data.news[idx]) {
        newsTitleEl.textContent = data.news[idx].title;
      }
    }, 5000);
    if (window.kov && window.kov.onTabChange) {
      window.kov.onTabChange("home", function() { clearInterval(newsTimer); });
    }
  }

  const ac = root.querySelector("#assistant-card");
  if (ac) ac.addEventListener("click", () => { playUISound("click"); openAssistantChat(); });
  const wheelCard = root.querySelector("#wheel-card");
  if (wheelCard) wheelCard.addEventListener("click", () => { playUISound("click"); openWheel(); });
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
      ev.preventDefault();
      const id = btn.dataset.taskId;
      const t = allTasksList.find((t) => String(t.id) === String(id));
      if (t) await startTask(t);
    });
  });
  root.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", () => {
      if (row.dataset.inProgress === "true") return;
      const id = row.dataset.taskId;
      openTaskDetails(allTasksList.find((t) => String(t.id) === String(id)));
    });
  });

  const allTasksBtn = root.querySelector('[data-action="all-tasks"]');
  if (allTasksBtn) allTasksBtn.addEventListener("click", () =>
    openAllTasks(allTasksList, data.user_tasks),
  );

  root.querySelectorAll('[data-action="legal"]').forEach((btn) =>
    btn.addEventListener("click", () => openLegal(btn.dataset.slug)),
  );
  const settingsBtn = root.querySelector('[data-action="settings"]');
  if (settingsBtn) settingsBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    import("/static/pages/settings.js?v=213").then((m) => m.openSettings()).catch(function() {});
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

async function startTask(t) {
  try {
    await post(`/api/tasks/${t.id}/start`);
    _updateTaskRowInPlace(t.id);
    window.kov.toast("Задание начато — выполняй и жди подтверждения админа");
  } catch (e) {
    window.kov.toast(e.message);
  }
}

function _updateTaskRowInPlace(taskId) {
  var row = document.querySelector('.task-row[data-task-id="' + taskId + '"]');
  if (!row) return;
  row.dataset.inProgress = "true";
  var btn = row.querySelector('[data-action="start"]');
  if (!btn) return;
  var span = document.createElement("span");
  span.className = "task-status task-status-in_progress";
  span.textContent = "В процессе";
  btn.replaceWith(span);
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
      ev.preventDefault();
      const id = btn.dataset.taskId;
      const t = tasks.find((t) => String(t.id) === String(id));
      if (t) await startTask(t);
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
    await startTask(t);
    window.closeModal();
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

function _fmtCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `Доступно через ${h}ч ${m}м`;
  if (m > 0) return `Доступно через ${m}м`;
  return `Доступно через ${s}с`;
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
  return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

async function openWheel() {
  try {
    const status = await get("/api/wheel/status");
    const sectors = status.sectors;
    const N = sectors.length;
    if (!N) { window.kov.toast("Призы колеса не настроены"); return; }
    const seg = 360 / N;

    // Square viewBox; everything is laid out around an exact centre so the
    // wheel stays perfectly round and never clips inside the modal.
    const VB = 360, C = VB / 2;        // centre 180,180
    const rimR = 176;                  // outer golden rim
    const innerR = 160;                // coloured slices
    const contentR = N <= 3 ? 88 : 100; // radius where labels sit
    const labelChars = N >= 8 ? 7 : N >= 6 ? 9 : 12;

    const palette = [
      "#FF6B6B", "#FF8E53", "#FFD93D", "#6BCB77",
      "#4D96FF", "#9B59B6", "#FF6B9D", "#00D2D3",
      "#F368E0", "#54A0FF", "#5F27CD", "#01A3A4",
      "#EE5A24", "#F9CA24", "#6AB04C", "#4834D4",
    ];

    const sectorLabel = (s) => {
      if (s.label && String(s.label).trim()) return String(s.label);
      if (s.kind === "coins") return `${s.value} K`;
      return "Приз";
    };
    const clip = (txt) => (txt.length > labelChars ? txt.slice(0, labelChars - 1) + "…" : txt);

    const arcPath = (start, end, r) => {
      const s = ((start - 90) * Math.PI) / 180;
      const e = ((end - 90) * Math.PI) / 180;
      const large = end - start > 180 ? 1 : 0;
      return `M${C},${C} L${C + r * Math.cos(s)},${C + r * Math.sin(s)} A${r},${r} 0 ${large} 1 ${C + r * Math.cos(e)},${C + r * Math.sin(e)} Z`;
    };

    const slices = sectors.map((s, i) => {
      const start = i * seg, end = (i + 1) * seg, mid = start + seg / 2;
      const rad = ((mid - 90) * Math.PI) / 180;
      const base = palette[i % palette.length];
      const cx2 = C + contentR * Math.cos(rad);
      const cy2 = C + contentR * Math.sin(rad);

      // Только иконка приза и количество — без названий.
      const amount = (s.value && Number(s.value) > 0) ? String(s.value) : "";
      const content = `
        <g transform="rotate(${mid},${cx2},${cy2})">
          ${s.icon ? `<image href="${s.icon}" x="${cx2 - 16}" y="${cy2 - 28}" width="32" height="32"/>` : ""}
          ${amount ? `<text x="${cx2}" y="${cy2 + (s.icon ? 16 : 5)}" text-anchor="middle"
                font-size="15" font-weight="800" fill="#fff"
                style="text-shadow:0 1px 3px rgba(0,0,0,.55)">${escapeHtml(amount)}</text>` : ""}
        </g>`;

      return `
        <defs>
          <linearGradient id="sg${i}" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="${shadeColor(base, 15)}"/><stop offset="50%" stop-color="${base}"/><stop offset="100%" stop-color="${shadeColor(base, -20)}"/></linearGradient>
          <linearGradient id="sg${i}hl" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.25)"/><stop offset="50%" stop-color="rgba(255,255,255,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.15)"/></linearGradient>
        </defs>
        <path d="${arcPath(start, end, innerR)}" fill="url(#sg${i})" stroke="#fff" stroke-width="1.5" stroke-opacity="0.35"/>
        <path d="${arcPath(start, end, innerR)}" fill="url(#sg${i}hl)"/>
        ${content}`;
    }).join("");

    const rimDots = Array.from({ length: N * 2 }, (_, i) => {
      const a = ((i * seg / 2 - 90) * Math.PI) / 180;
      const r = 170;
      return `<circle cx="${C + r * Math.cos(a)}" cy="${C + r * Math.sin(a)}" r="2.5" fill="#FFD700" opacity="0.85"/>`;
    }).join("");

    const btnLabel = status.can_spin ? "Крутить!" : _fmtCountdown(status.next_spin_seconds || 0);

    const modal = window.kov.showModal(`
      <button class="close" onclick="closeModal()">×</button>
      <h2 style="text-align:center;margin-top:0;margin-bottom:4px">Колесо фортуны</h2>
      <p style="text-align:center;color:var(--text-soft);margin:0 0 10px;font-size:13px">Крути и выигрывай K и призы!</p>
      <div class="wheel-stage" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding-top:6px">
        <div class="wheel-wrap" style="position:relative;width:min(82vw,320px);aspect-ratio:1;margin:0 auto">
          <div class="wheel-pointer" style="position:absolute;top:-4px;left:50%;transform:translateX(-50%);z-index:10;width:0;height:0;border-left:13px solid transparent;border-right:13px solid transparent;border-top:22px solid #FFD700;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35))"></div>
          <svg class="wheel-svg" id="wheel-svg" viewBox="0 0 ${VB} ${VB}" style="width:100%;height:100%;display:block;transform:rotate(0deg);transition:transform 4.5s cubic-bezier(.16,.84,.36,1);filter:drop-shadow(0 4px 20px rgba(0,0,0,.22))">
            <defs>
              <radialGradient id="rimGrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFF8DC"/><stop offset="30%" stop-color="#FFD700"/><stop offset="70%" stop-color="#DAA520"/><stop offset="100%" stop-color="#8B6914"/></radialGradient>
              <radialGradient id="hubGrad" cx="40%" cy="35%" r="60%"><stop offset="0%" stop-color="#FFF8DC"/><stop offset="50%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/></radialGradient>
              <radialGradient id="hubInner" cx="40%" cy="35%" r="60%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#FFE4B5"/></radialGradient>
              <filter id="dropGlow"><feDropShadow dx="0" dy="3" stdDeviation="6" flood-opacity=".3"/></filter>
            </defs>
            <circle cx="${C}" cy="${C}" r="${rimR}" fill="url(#rimGrad)" stroke="#8B6914" stroke-width="1.5"/>
            <circle cx="${C}" cy="${C}" r="${rimR - 6}" fill="none" stroke="rgba(139,105,20,.3)" stroke-width="1.5"/>
            ${rimDots}
            <g filter="url(#dropGlow)">${slices}</g>
            <circle cx="${C}" cy="${C}" r="30" fill="url(#hubGrad)" stroke="#8B6914" stroke-width="1.5"/>
            <circle cx="${C}" cy="${C}" r="24" fill="url(#hubInner)" stroke="#DAA520" stroke-width="1"/>
            <circle cx="${C}" cy="${C}" r="18" fill="#FFD700" stroke="#B8860B" stroke-width="1.5"/>
          </svg>
        </div>
        <button class="btn" id="spin-btn" ${status.can_spin ? "" : "disabled"}>${escapeHtml(btnLabel)}</button>
        <div class="wheel-prize" id="prize" style="text-align:center;background:var(--surface-2,#f2f4f8);border-radius:14px;padding:14px;display:none;width:100%">
          <div class="ic" id="prize-ic" style="font-size:38px">${iconHtml("/static/img/ui/coin.svg", "lg", "")}</div>
          <div class="lbl" id="prize-lbl" style="font-weight:700;margin-top:4px"></div>
        </div>
      </div>
    `);

    // Live countdown that ticks down while the modal is open.
    const spinBtn = modal.querySelector("#spin-btn");
    let cdTimer = null;
    if (!status.can_spin) {
      let remaining = status.next_spin_seconds || 0;
      cdTimer = setInterval(() => {
        if (!document.body.contains(modal)) { clearInterval(cdTimer); return; }
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(cdTimer);
          spinBtn.disabled = false;
          spinBtn.textContent = "Крутить!";
        } else {
          spinBtn.textContent = _fmtCountdown(remaining);
        }
      }, 1000);
    }

    const svg = modal.querySelector("#wheel-svg");
    let currentRot = 0;
    let spinSoundInterval = null;

    spinBtn.addEventListener("click", async () => {
      if (spinBtn.disabled) return;
      spinBtn.disabled = true;
      if (cdTimer) clearInterval(cdTimer);
      try {
        const result = await post("/api/wheel/spin");
        const idx = result.sector_index;
        // Pointer is at top (angle 0). Sector i spans [i*seg,(i+1)*seg] measured
        // clockwise from top, so its centre must rotate to 0 → negative offset.
        const targetAngle = -(idx * seg + seg / 2);
        const fullSpins = 5 + Math.floor(Math.random() * 2);
        const finalRot = currentRot + fullSpins * 360 + (targetAngle - (currentRot % 360));

        playUISound("spin");
        spinSoundInterval = setInterval(() => {
          if (!document.body.contains(modal)) { clearInterval(spinSoundInterval); return; }
          playUISound("spin");
        }, 300);

        svg.style.transform = `rotate(${finalRot}deg)`;
        currentRot = finalRot;

        setTimeout(() => {
          if (!document.body.contains(modal)) { clearInterval(spinSoundInterval); return; }
          clearInterval(spinSoundInterval);
          playUISound("win");
          const prize = modal.querySelector("#prize");
          modal.querySelector("#prize-ic").innerHTML = iconHtml(result.result.icon, "lg", "");
          modal.querySelector("#prize-lbl").textContent = result.result.prize_label;
          prize.style.display = "block";
          prize.classList.add("show");
          prize.style.animation = "popIn 400ms ease-out forwards";
        }, 4600);
      } catch (e) {
        clearInterval(spinSoundInterval);
        window.kov.toast(e.message);
        spinBtn.disabled = false;
        spinBtn.textContent = "Крутить!";
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
