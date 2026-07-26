import { get, post, iconHtml } from "/static/api.js?v=266";

import { openAssistantChat } from "/static/pages/assistant.js?v=264";

import { playUISound } from "/static/pages/settings.js?v=267";

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Блоки Главной, временно снятые с показа. Разметка остаётся на месте: чтобы
// вернуть блок, достаточно убрать его ключ из набора.
const HIDDEN_HOME_BLOCKS = new Set(["assistant", "constitution", "legislation"]);

const isHiddenHomeBlock = (key) => HIDDEN_HOME_BLOCKS.has(key);

const dailyLoadVersions = new WeakMap();

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

  const slideHtml = (b, logicalIndex, copy) => `
    <div class="kc-slide" data-slide-index="${logicalIndex}" data-copy="${copy}"${copy === 1 ? "" : ' aria-hidden="true"'}>
      <div class="banner" style="background-image:url('${escapeHtml(b.image_url)}');width:100%;aspect-ratio:16/9;background-size:cover;background-position:center;border-radius:var(--radius,12px);box-shadow:0 6px 18px rgba(24,39,75,.10)"></div>
    </div>`;
  // Three identical runs provide a full native-scroll buffer in both
  // directions. Recentring happens only near the remote ends and lands on the
  // pixel-identical card, so the loop has no visible boundary teleport.
  const slides = [0, 1, 2].map((copy) =>
    banners.map((banner, index) => slideHtml(banner, index, copy)).join(""),
  ).join("");
  const dots = banners.map(() => '<span class="dot" style="width:6px;height:6px;border-radius:50%;background:#D2D8E3;transition:all .25s ease"></span>').join("");
  return `
    <div class="kc-carousel" id="bn-carousel" style="margin-bottom:14px">
      <div class="kc-viewport" id="bn-track">${slides}</div>
      <div class="dots" id="bn-dots" style="display:flex;justify-content:center;gap:6px;padding:8px 0 2px">${dots}</div>
    </div>`;
}

function assistantCard() {
  if (isHiddenHomeBlock("assistant")) return "";
  return `
    <div class="card assistant-card-wide is-coming-soon" id="assistant-card" data-locked="1" aria-disabled="true" title="Скоро">
      <div class="assistant-bust">
        <div class="assistant-bust-bg"></div>
        <div class="assistant-bust-img"></div>
      </div>
      <div class="assistant-text">
        <div class="assistant-label">ИИ-ассистент</div>
        <h3 class="assistant-name">Мошонка</h3>
        <p class="assistant-sub">Верный спутник граждан Ковчега</p>
      </div>
      <span class="coming-soon-badge" aria-hidden="true">Скоро</span>
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

function taskRewardsHtml(t) {
  const rewards = [];
  if (Number(t.reward) > 0) rewards.push(`<span class="task-reward-badge">${iconHtml("/static/img/ui/kovbaks.png", "sm", "")} ${t.reward} ковбаксов</span>`);
  if (Number(t.xp_reward) > 0) rewards.push(`<span class="task-reward-badge">${iconHtml("/static/img/ui/xp.png", "sm", "")} ${t.xp_reward} XP</span>`);
  if (t.reward_item_id && Number(t.reward_item_quantity) > 0) {
    rewards.push(`<span class="task-reward-badge">${iconHtml(t.reward_item_icon || "/static/img/ui/box.svg", "sm", "")} ×${t.reward_item_quantity} ${escapeHtml(t.reward_item_name || "предмет")}</span>`);
  }
  return rewards.length ? `<span class="task-rewards">${rewards.join("")}</span>` : `<span class="task-rewards">Без награды</span>`;
}

function taskRow(t, userTasks) {
  const startedIds = userTasks ? userTasks.map(ut => String(ut.task.id)) : [];
  const isStarted = startedIds.includes(String(t.id));
  return `
    <div class="task-row" data-task-id="${t.id}" ${isStarted ? 'data-in-progress="true"' : ''}>
      <div class="meta">
        <h4>${escapeHtml(t.name)}</h4>
        <p>Награда: ${taskRewardsHtml(t)}</p>
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
  if (typeof root._homeDispose === "function") root._homeDispose();
  const homeDisposers = [];
  const addHomeDisposer = (fn) => homeDisposers.push(fn);
  root._homeDispose = function() {
    while (homeDisposers.length) {
      try { homeDisposers.pop()(); } catch (_) {}
    }
    root._homeDispose = null;
  };
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  var data;
  try {
    // The page itself remains cached, but banners are admin-controlled and may
    // be deleted between visits.  Render only the confirmed server snapshot.
    data = await get("/api/home", { force: true });
  } catch (e) {
    root.innerHTML = '<div class="card"><p style="color:var(--danger)">Ошибка загрузки</p></div>';
    return;
  }
  const user = data.user;
  const welcome = "Добро пожаловать!";


  root.innerHTML = `
    <section class="page-header">
      <div>
        <h1>${welcome}</h1>
        <div class="subtitle" id="home-clock">${escapeHtml(data.server_time_msk)} мск</div>
      </div>
      <div class="hero-art" title="Ковчег"><img src="/static/img/ui/home_cube.png?v=266" alt="Ковчег" class="hero-img"/></div>
    </section>

${bannerCarousel(data.banners)}

    ${assistantCard()}

    <div class="square-row">
      ${bigSquareCard({ id: "wheel-card", type: "wheel", title: "Колесо фортуны", cssClass: "wheel-square" })}
      ${bigSquareCard({ id: "news-card", type: "news", title: "Новости", slides: data.news || [], cssClass: "news-square" })}
    </div>

    <div class="card daily-reward-card" id="daily-reward-card" aria-busy="true">
      <div class="daily-reward-head">
        <img src="/static/img/ui/kovbaks.png" alt="" class="daily-reward-icon"/>
        <div class="daily-reward-meta">
          <div class="daily-reward-title">Ежедневная награда</div>
          <div class="daily-reward-desc" id="daily-reward-desc">Загружаем статус…</div>
        </div>
        <button class="btn btn-sm" id="daily-reward-btn" disabled>Загрузка…</button>
      </div>
      <div class="daily-streak-dots" id="daily-streak-dots">
        ${[1, 2, 3, 4, 5, 6, 7].map((day) => `<span class="daily-dot"><b>${day}</b></span>`).join("")}
      </div>
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
      ${isHiddenHomeBlock("constitution") ? "" : `
      <button class="chip big-chip is-coming-soon" type="button" disabled aria-disabled="true" title="Скоро">
        ${iconHtml("/static/img/ui/constitution.svg", "md", "")}<span>Конституция</span><span class="coming-soon-badge" aria-hidden="true">Скоро</span>
      </button>`}
      ${isHiddenHomeBlock("legislation") ? "" : `
      <button class="chip big-chip is-coming-soon" type="button" disabled aria-disabled="true" title="Скоро">
        ${iconHtml("/static/img/ui/scales.svg", "md", "")}<span>Законодательство</span><span class="coming-soon-badge" aria-hidden="true">Скоро</span>
      </button>`}
      <button class="chip big-chip" data-action="channel">
        ${iconHtml("/static/img/ui/telegram.svg", "md", "")}<span>Телеграм канал</span>
      </button>
      <button class="chip big-chip" data-action="settings">
        ${iconHtml("/static/img/ui/settings.svg", "md", "")}<span>Настройки</span>
      </button>
    </div>
  `;

  // The compact pass card is optional. Do not issue a request when the active
  // home layout does not contain its mount (the old legacy layout did).
  // A pass card that only leads to the "under maintenance" screen is worse than
  // no card, so it is skipped for the accounts the pass is closed for.
  var me = window.kov && window.kov.me;
  var passClosed = ((me && me.maintenance_sections) || []).indexOf("battlepass") !== -1;
  const bpMiniMount = passClosed ? null : root.querySelector("#bp-mini-card");
  if (bpMiniMount) get("/api/battlepass").then(function(bp) {
    if (!bp || !bp.season) return;
    var el = root.querySelector("#bp-mini-card");
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

  // Секретный вход в админку: тройное нажатие по иконке справа сверху (только для админа).
  const heroArt = root.querySelector(".hero-art");
  if (heroArt) {
    let taps = 0, tapTimer = null;
    heroArt.addEventListener("click", () => {
      taps += 1;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { taps = 0; }, 600);
      if (taps >= 3) {
        taps = 0; clearTimeout(tapTimer);
        if (window.kov.me && window.kov.me.is_admin) window.kov.setTab("admin", true);
      }
    });
  }

  const carousel = root.querySelector("#bn-carousel");
  const bnTrack = carousel && carousel.querySelector("#bn-track");
  const bnDots = carousel ? Array.from(carousel.querySelectorAll("#bn-dots .dot")) : [];
  if (bnTrack && bnDots.length > 1) {
    const n = bnDots.length;
    const slides = Array.from(bnTrack.children);
    let pos = 0;
    let physicalPos = n;
    const targetLeft = (physicalIndex) => {
      const slide = slides[physicalIndex];
      if (!slide) return 0;
      return slide.offsetLeft - (bnTrack.clientWidth - slide.offsetWidth) / 2;
    };
    const scrollToPhysical = (index, behavior = "smooth") => {
      physicalPos = Math.max(0, Math.min(slides.length - 1, index));
      pos = Number(slides[physicalPos].dataset.slideIndex) || 0;
      bnTrack.scrollTo({ left: targetLeft(physicalPos), behavior });
      syncDots();
    };
    const goTo = (logicalIndex, behavior = "smooth") => {
      const normalized = ((logicalIndex % n) + n) % n;
      const candidates = [normalized, n + normalized, n * 2 + normalized];
      const nearest = candidates.reduce((best, value) =>
        Math.abs(value - physicalPos) < Math.abs(best - physicalPos) ? value : best,
      candidates[0]);
      scrollToPhysical(nearest, behavior);
    };
    const goForward = () => scrollToPhysical(physicalPos + 1, "smooth");
    const syncDots = () => {
      bnDots.forEach((d, i) => {
        const on = i === pos;
        d.classList.toggle("active", on);
        d.style.background = on ? "var(--primary,#4D96FF)" : "#D2D8E3";
        d.style.width = on ? "18px" : "6px";
        d.style.borderRadius = on ? "6px" : "50%";
      });
    };
    bnDots.forEach((dot, index) => {
      dot.addEventListener("click", () => goTo(index));
    });

    // Native overflow scrolling is deliberate: iOS/Telegram WebView provides
    // momentum and direction arbitration more reliably than touchmove hacks.
    let bnTimer = null;
    const startAuto = () => {
      stopAuto();
      if (window.kov && window.kov.getTab && window.kov.getTab() !== "home") return;
      bnTimer = setInterval(goForward, 4500);
    };
    function stopAuto() { if (bnTimer) { clearInterval(bnTimer); bnTimer = null; } }

    let scrollTimer = null;
    const onScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const center = bnTrack.scrollLeft + bnTrack.clientWidth / 2;
        let nearest = 0, distance = Infinity;
        slides.forEach((slide, i) => {
          const d = Math.abs(center - (slide.offsetLeft + slide.offsetWidth / 2));
          if (d < distance) { distance = d; nearest = i; }
        });
        physicalPos = nearest;
        pos = Number(slides[nearest].dataset.slideIndex) || 0;
        // Normalise only at the distant ends. The destination contains the
        // same image at the same centre coordinate, making this imperceptible.
        if (nearest <= 1 || nearest >= slides.length - 2) {
          const middle = n + pos;
          bnTrack.classList.add("kc-normalizing");
          physicalPos = middle;
          bnTrack.scrollLeft = targetLeft(middle);
          requestAnimationFrame(() => bnTrack.classList.remove("kc-normalizing"));
        }
        syncDots();
        startAuto();
      }, 180);
    };
    bnTrack.addEventListener("scroll", onScroll, { passive: true });
    const pauseForUser = () => stopAuto();
    bnTrack.addEventListener("pointerdown", pauseForUser, { passive: true });
    bnTrack.addEventListener("touchstart", pauseForUser, { passive: true });
    bnTrack.addEventListener("wheel", pauseForUser, { passive: true });

    // Keep centering correct on resize / orientation change.
    const handleResize = () => scrollToPhysical(n + pos, "auto");
    window.addEventListener("resize", handleResize);
    // Карусель пре-рендерится в скрытой вкладке (ширина 0). Пересчитываем центрирование,
    // как только вьюпорт получает реальные размеры (становится видимым).
    let ro = null;
    let observedWidth = 0;
    if (window.ResizeObserver) {
      ro = new ResizeObserver((entries) => {
        const width = entries[0] && entries[0].contentRect.width;
        if (!width || Math.abs(width - observedWidth) < 1) return;
        observedWidth = width;
        scrollToPhysical(n + pos, "auto");
      });
      ro.observe(bnTrack);
    }
    addHomeDisposer(() => {
      stopAuto();
      if (scrollTimer) clearTimeout(scrollTimer);
      bnTrack.removeEventListener("scroll", onScroll);
      bnTrack.removeEventListener("pointerdown", pauseForUser);
      bnTrack.removeEventListener("touchstart", pauseForUser);
      bnTrack.removeEventListener("wheel", pauseForUser);
      window.removeEventListener("resize", handleResize);
      if (ro) ro.disconnect();
    });

    requestAnimationFrame(() => { scrollToPhysical(n, "auto"); startAuto(); });

    if (window.kov && window.kov.onTabChange) {
      window.kov.onTabChange("home", () => stopAuto());
    }
    if (window.kov && window.kov.onTabShow) {
      window.kov.onTabShow("home", () => {
        requestAnimationFrame(() => {
          scrollToPhysical(n + pos, "auto");
          startAuto();
        });
      });
    }
  }

  const newsSlides = root.querySelectorAll("#news-visual .news-slide");
  const newsTitleEl = root.querySelector("#news-card .big-square-title");
  if (newsSlides.length > 1) {
    let currentSlide = 0;
    let newsTimer = null;
    const advanceNews = () => {
      newsSlides[currentSlide].classList.remove("active");
      currentSlide = (currentSlide + 1) % newsSlides.length;
      newsSlides[currentSlide].classList.add("active");
      const idx = Number(newsSlides[currentSlide].dataset.newsIdx);
      if (newsTitleEl && data.news && data.news[idx]) {
        newsTitleEl.textContent = data.news[idx].title;
      }
    };
    const stopNews = () => {
      if (newsTimer) clearInterval(newsTimer);
      newsTimer = null;
    };
    const startNews = () => {
      stopNews();
      if (window.kov && window.kov.getTab && window.kov.getTab() !== "home") return;
      newsTimer = setInterval(advanceNews, 5000);
    };
    startNews();
    addHomeDisposer(stopNews);
    if (window.kov && window.kov.onTabChange) {
      window.kov.onTabChange("home", stopNews);
    }
    if (window.kov && window.kov.onTabShow) {
      window.kov.onTabShow("home", startNews);
    }
  }

  const ac = root.querySelector("#assistant-card");
  if (ac && ac.dataset.locked !== "1") ac.addEventListener("click", () => { playUISound("click"); openAssistantChat(); });
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
    import("/static/pages/settings.js?v=255").then((m) => m.openSettings()).catch(function() {});
  });
  const channelBtn = root.querySelector('[data-action="channel"]');
  if (channelBtn) channelBtn.addEventListener("click", () => {
    window.open("https://t.me/+2fe2Nsj0J9FiYzky", "_blank");
  });

  loadQuizzes(root);

  // Часы реального времени по МСК — обновляется только текст, раз в секунду,
  // без перезагрузки страницы.
  var serverClockOffset = Number(data.server_epoch_ms || Date.now()) - Date.now();
  function mskClock() {
    var now = new Date(Date.now() + serverClockOffset);
    var date = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
    var time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Moscow" });
    return date + ", " + time + " мск";
  }
  var clockEl = root.querySelector("#home-clock");
  if (clockEl) {
    var clockTimer = null;
    function stopClock() {
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
    }
    function startClock() {
      stopClock();
      if (!document.body.contains(clockEl)) return;
      clockEl.textContent = mskClock();
      if (window.kov && window.kov.getTab && window.kov.getTab() !== "home") return;
      clockTimer = setInterval(function() {
        if (!document.body.contains(clockEl)) { stopClock(); return; }
        clockEl.textContent = mskClock();
      }, 1000);
    }
    startClock();
    addHomeDisposer(stopClock);
    if (window.kov && window.kov.onTabChange) {
      window.kov.onTabChange("home", stopClock);
    }
    if (window.kov && window.kov.onTabShow) {
      window.kov.onTabShow("home", startClock);
    }
  }

  // Daily reward card
  var dailyLoadedAt = Date.now();
  loadDailyReward(root);
  if (window.kov && window.kov.onTabShow) {
    window.kov.onTabShow("home", function() {
      if (Date.now() - dailyLoadedAt < 5000) return;
      dailyLoadedAt = Date.now();
      loadDailyReward(root, true);
    });
  }
}

function kovbaksWord(n) {
  var abs = Math.abs(n) % 100;
  var last = abs % 10;
  if (abs > 10 && abs < 20) return "ковбаксов";
  if (last === 1) return "ковбакс";
  if (last >= 2 && last <= 4) return "ковбакса";
  return "ковбаксов";
}

async function loadDailyReward(root, force) {
  var card = root.querySelector("#daily-reward-card");
  if (!card) return;
  var requestVersion = (dailyLoadVersions.get(root) || 0) + 1;
  dailyLoadVersions.set(root, requestVersion);
  try {
    var dr = await get("/api/home/daily-reward", force ? { force: true } : {});
    if (dailyLoadVersions.get(root) !== requestVersion || !document.body.contains(root)) return;
    card.style.display = "";
    card.removeAttribute("aria-busy");
    var desc = root.querySelector("#daily-reward-desc");
    var btn = root.querySelector("#daily-reward-btn");
    var dots = root.querySelector("#daily-streak-dots");

    // Полоски серии (7 дней). Награда за день N = N ковбаксов (макс 7).
    var dotsHtml = "";
    for (var i = 1; i <= 7; i++) {
      var filled = i <= dr.streak;
      dotsHtml += '<span class="daily-dot ' + (filled ? 'filled' : '') + '"><b>' + i + '</b></span>';
    }
    dots.innerHTML = dotsHtml;

    // Клонируем кнопку, чтобы убрать возможные старые обработчики при повторной загрузке.
    var freshBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(freshBtn, btn);
    btn = freshBtn;

    if (dr.claimed_today) {
      btn.disabled = true;
      btn.textContent = "Получено";
      var next = Math.min(dr.streak + 1, 7);
      desc.textContent = "Серия: " + dr.streak + " дн. · завтра " + next + " " + kovbaksWord(next);
    } else {
      btn.disabled = false;
      btn.textContent = "Забрать";
      var reward = dr.reward;
      desc.textContent = "День " + reward + " · +" + reward + " " + kovbaksWord(reward);
      btn.addEventListener("click", async function() {
        btn.disabled = true;
        btn.textContent = "Получаем…";
        try {
          var res = await post("/api/home/daily-reward/claim");
          window.kov.toast("+" + res.reward + " " + kovbaksWord(res.reward) + "! Серия: " + res.streak + " дн.");
          if (window.kov.me) window.kov.me.balance = res.balance;
          if (window.kov.emit) window.kov.emit("balance:update", { balance: res.balance });
          loadDailyReward(root);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Забрать";
          window.kov.toast(e.message);
        }
      });
    }
  } catch (e) {
    if (dailyLoadVersions.get(root) !== requestVersion || !document.body.contains(root)) return;
    card.style.display = "";
    card.removeAttribute("aria-busy");
    var desc = root.querySelector("#daily-reward-desc");
    var btn = root.querySelector("#daily-reward-btn");
    if (desc) desc.textContent = "Не удалось обновить статус";
    if (btn) {
      var retryBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(retryBtn, btn);
      retryBtn.disabled = false;
      retryBtn.textContent = "Повторить";
      retryBtn.addEventListener("click", function() {
        retryBtn.disabled = true;
        retryBtn.textContent = "Загрузка…";
        loadDailyReward(root, true);
      });
    }
  }
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
    <div class="task-card-reward">Награда: ${taskRewardsHtml(t)}</div>
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

// Цвет сектора колеса определяется тем, что в нём лежит, а не его номером.
const WHEEL_COINS_COLOR = "#f0b429";        // ковбаксы — золотой
const WHEEL_XP_COLOR = "#8e44ec";           // XP — фиолетовый
const WHEEL_ITEM_COLOR = "#2f7fe6";         // прочие предметы — синий
const WHEEL_EMPTY_COLOR = "#4b5361";        // пустой сектор — тёмно-серый

const WHEEL_ITEM_COLORS = {
  box_fragment: "#9aa3b2",                  // фрагмент ковбокса — серый
  failure_fragment: "#4b5361",              // фрагмент неудачи — тёмно-серый
};

// Ковбоксы красятся в собственный цвет пула: те же акценты, что --lb-accent
// у .lootbox-theme-* в style.css.
const WHEEL_LOOTBOX_COLORS = {
  common: "#c7d2e5",
  rare: "#6af079",
  epic: "#cc63ff",
  legendary: "#ffd54a",
  seasonal: "#45e6f1",
  consolation: "#8993a9",
  mega: "#ffd650",
};

function wheelSectorColor(sector) {
  if (sector.kind === "coins") return WHEEL_COINS_COLOR;
  if (sector.kind === "xp") return WHEEL_XP_COLOR;
  if (sector.kind !== "item") return WHEEL_EMPTY_COLOR;
  if (sector.lootbox_pool_code) return WHEEL_LOOTBOX_COLORS[sector.lootbox_pool_code] || WHEEL_ITEM_COLOR;
  return WHEEL_ITEM_COLORS[sector.item_code] || WHEEL_ITEM_COLOR;
}

// На светлых секторах (обычный ковбокс, золото) белая подпись не читается.
function inkOn(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const luma = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luma > 0.62
    ? { fill: "#1d2433", shadow: "0 1px 2px rgba(255,255,255,.65)" }
    : { fill: "#ffffff", shadow: "0 1px 3px rgba(0,0,0,.55)" };
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
      const base = wheelSectorColor(s);
      const ink = inkOn(base);
      const cx2 = C + contentR * Math.cos(rad);
      const cy2 = C + contentR * Math.sin(rad);

      // Только иконка приза и количество — без названий.
      const amount = (s.value && Number(s.value) > 0) ? String(s.value) : "";
      const content = `
        <g transform="rotate(${mid},${cx2},${cy2})">
          ${s.icon ? `<image href="${s.icon}" x="${cx2 - 16}" y="${cy2 - 28}" width="32" height="32"/>` : ""}
          ${amount ? `<text x="${cx2}" y="${cy2 + (s.icon ? 16 : 5)}" text-anchor="middle"
                font-size="15" font-weight="800" fill="${ink.fill}"
                style="text-shadow:${ink.shadow}">${escapeHtml(amount)}</text>` : ""}
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
          <div class="ic" id="prize-ic" style="font-size:38px">${iconHtml("/static/img/ui/kovbaks.png", "lg", "")}</div>
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
        if (result && result.xp_to_coins > 0) {
          window.kov.toast("Достигнут максимум XP — излишек перешёл в " + result.xp_to_coins + " ковбаксов");
        }
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

function quizRewardBadges(rewards) {
  if (!Array.isArray(rewards) || rewards.length === 0) return '<span class="quiz-reward-empty">без награды</span>';
  return rewards.map((reward) => `
    <span class="quiz-reward-badge">
      <img src="${escapeHtml(reward.icon || "/static/img/ui/box.svg")}" alt=""/>
      ${escapeHtml(reward.label || "")}
    </span>`).join("");
}

function quizRewardsTable(q) {
  return `<div class="quiz-reward-table">
    <div><strong>Плохо</strong>${quizRewardBadges(q.rewards_bad)}</div>
    <div><strong>Хорошо</strong>${quizRewardBadges(q.rewards_good)}</div>
    <div><strong>Отлично</strong>${quizRewardBadges(q.rewards_excellent)}</div>
  </div>`;
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
    container.innerHTML = quizzes.map((q) => `
      <div class="quiz-row${q.already_passed ? " quiz-row-passed" : ""}"
           data-quiz-id="${q.id}" data-passed="${q.already_passed ? "true" : "false"}"
           ${q.already_passed ? 'aria-disabled="true"' : 'role="button" tabindex="0"'}
           ${q.already_passed ? 'style="opacity:.68;cursor:default"' : ""}>
        <div class="quiz-row-info">
          <h4>${escapeHtml(q.title)}</h4>
          <p>${escapeHtml(q.description || "")} ${q.question_count} вопросов${q.time_limit_seconds ? ` · ${q.time_limit_seconds} сек.` : ""}${q.already_passed ? " · Пройдено" : ""}</p>
          ${q.already_passed ? "" : quizRewardsTable(q)}
        </div>
        <div class="quiz-row-badge" aria-hidden="true">${q.already_passed ? "✓" : "▶"}</div>
      </div>
    `).join("");

    container.querySelectorAll('.quiz-row[data-passed="false"]').forEach((row) => {
      const launch = () => openQuiz(Number(row.dataset.quizId), root);
      row.addEventListener("click", launch);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          launch();
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty">Ошибка загрузки</div>`;
  }
}

async function openQuiz(quizId, quizRoot = null) {
  let questions = [];
  let runToken = "";
  let timeLimit = 0;
  try {
    const started = await post(`/api/quiz/${quizId}/start`);
    questions = started.questions || [];
    runToken = started.run_token || "";
    timeLimit = Number(started.time_limit_seconds) || 0;
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
    ${timeLimit > 0 ? `<div class="quiz-timer" id="quiz-timer">Осталось: <strong>${timeLimit}</strong> сек.</div>` : ""}
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

  const submitButton = modal.querySelector("#quiz-submit");
  let submitting = false;
  let timerId = null;

  async function submitQuiz(timeExpired = false) {
    if (submitting) return;
    const answers = {};
    questions.forEach((q) => {
      const sel = modal.querySelector(`input[name="q-${q.id}"]:checked`);
      if (sel) answers[q.id] = sel.value;
    });
    if (!timeExpired && Object.keys(answers).length < questions.length) {
      window.kov.toast("Ответь на все вопросы");
      return;
    }
    submitting = true;
    if (timerId) clearInterval(timerId);
    submitButton.disabled = true;
    submitButton.textContent = timeExpired ? "Время вышло — проверяем…" : "Проверяем…";
    try {
      const result = await post("/api/quiz/submit", { quiz_id: quizId, run_token: runToken, answers });
      if (result && result.xp_to_coins > 0) {
        window.kov.toast("Достигнут максимум XP — излишек перешёл в " + result.xp_to_coins + " ковбаксов");
      }
      window.closeModal();
      if (quizRoot && quizRoot.isConnected) loadQuizzes(quizRoot);
      const gradeLabels = { bad: "Плохо", good: "Хорошо", excellent: "Отлично" };
      const rewardsHtml = (result.rewards || []).map((reward) =>
        `<span class="quiz-reward-badge"><img src="${escapeHtml(reward.icon || "/static/img/ui/box.svg")}" alt=""/>${escapeHtml(reward.label || "")}</span>`
      ).join("");
      window.kov.showModal(`
        <button class="close" onclick="closeModal()">×</button>
        <h2>Результат</h2>
        <div style="text-align:center; padding: 20px 0">
          <div style="font-size:48px; font-weight:800">${result.score}/${result.total}</div>
          <div style="font-size:18px; margin-top:8px; color:var(--primary)">${gradeLabels[result.grade] || result.grade}</div>
          ${result.prize_awarded
            ? `<div class="quiz-prize-awarded" style="margin-top:16px">Призы получены<div class="quiz-result-rewards">${rewardsHtml}</div></div>`
            : ""
          }
        </div>
        <button class="btn" style="margin-top:16px" onclick="closeModal()">Закрыть</button>
      `);
    } catch (err) {
      window.kov.toast(err.message);
      submitButton.disabled = false;
      submitButton.textContent = "Ответить";
      submitting = false;
    }
  }

  submitButton.addEventListener("click", () => submitQuiz(false));
  if (timeLimit > 0) {
    const timer = modal.querySelector("#quiz-timer strong");
    let left = timeLimit;
    timerId = setInterval(() => {
      if (!modal.isConnected) {
        clearInterval(timerId);
        return;
      }
      left -= 1;
      timer.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timerId);
        submitQuiz(true);
      }
    }, 1000);
  }
}
