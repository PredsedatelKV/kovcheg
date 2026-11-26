import { wheelMarkup, rotateWheel } from "../winter-wheel.js";
import { carouselMarkup, mountCarousel } from "../carousel.js";
import { get, post, iconHtml } from "../api.js";

import { icon } from "../ui.js";

import { playUISound } from "./settings.js";


const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dailyLoadVersions = new WeakMap();

const winterBanners = [
  {
    art: "kovboxes",
    showTitle: false,
    title: "Новые ковбоксы",
    body: "Ледяной и новогодний ковбоксы можно покрутить в карточке и открыть в 3D.",
  },
  {
    art: "winter",
    title: "Зимнее обновление",
    body: "Полярный экспресс, Чудесник, Фрост-пост и Хрустопад уже ждут во вкладке «Игры».",
  },
  {
    art: "tree",
    title: "Укрась ёлочку",
    body: "Выбери игрушки, зажги гирлянду и собери свою ёлочку в профиле.",
  },
].map(({ art, ...banner }) => ({
  ...banner,
  featured: true,
  image_url: new URL(`../media/home/${art}.webp`, import.meta.url).pathname,
}));

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function openCarouselAction(item, news) {
  const target = item.action_target || "";
  if (item.action_type === "tab" && target && target !== "news" && !target.startsWith("news:")) {
    window.kov.setTab(target).catch(console.error);
    return;
  }

  const id = target.startsWith("news:") ? target.slice(5) : "";
  const article = item.body != null ? item : id
    ? news.find((entry) => String(entry.id) === id)
    : target === "news"
      ? news.find((entry) => entry.image_url === item.image_url || (item.title && entry.title === item.title))
      : undefined;
  const title = item.title?.trim() || article?.title || "Новость";
  const image = item.image_url || article?.image_url;
  window.kov.showModal(`
    <button class="close" type="button" aria-label="Закрыть новость" onclick="closeModal()">×</button>
    <article class="carousel-story">
      <h2>${escapeHtml(title)}</h2>
      ${image ? `<img class="carousel-story-image" src="${escapeHtml(image)}" alt="">` : ""}
      ${article?.body ? `<p>${escapeHtml(article.body)}</p>` : ""}
      ${article?.published_at ? `<small>${escapeHtml(fmtDate(article.published_at))}</small>` : ""}
    </article>
  `, { label: title });
}

function taskRewardsHtml(t) {
  const rewards = [];
  if (Number(t.reward) > 0) rewards.push(`<span class="task-reward-badge">${iconHtml("/static/releases/winter-2026-r3/media/coin.png", "sm", "")} ${t.reward} ковбаксов</span>`);
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
  root._winterCarousel?.dispose();
  root._winterCarousel = null;
  root.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
  const data = await get("/api/home", { force: true });
  window.kov.channelUrl = data.channel_url || "";
  const news = data.news || [];
  const wheelArt = new URL("../media/wheel-thumb.webp", import.meta.url).pathname;

  root.innerHTML = `
    <header class="station-page-heading">
      <h1>Цифровой Ковчег</h1>
      <p>Добро пожаловать, ${escapeHtml(String(data.user?.first_name || "гражданин"))}</p>
    </header>

    ${carouselMarkup(winterBanners)}

    <section class="card daily-reward-card" id="daily-reward-card" aria-busy="true">
      <div class="daily-reward-head">
        <div class="daily-streak-fire streak-normal" id="daily-streak-fire" role="img" aria-label="Ежедневная награда">${icon("gift")}</div>
        <div class="daily-reward-meta">
          <div class="daily-reward-title">Ежедневная награда</div>
          <div class="daily-reward-desc" id="daily-reward-desc">Проверяем серию…</div>
        </div>
        <button type="button" class="btn btn-sm" id="daily-reward-btn" disabled>Подождите</button>
      </div>
      <div class="daily-streak-dots" id="daily-streak-dots" aria-label="Дни серии"></div>
    </section>

    <button type="button" class="station-shortcut station-wheel-card" id="wheel-card">
      <img src="${wheelArt}" class="station-wheel-thumbnail" alt="" decoding="async">
      <strong>Колесо фортуны</strong>${icon("arrow")}
    </button>

    <div class="card quiz-card" id="quiz-card">
      <div class="quiz-card-head"><h3 class="card-title">Тестирования</h3></div>
      <div id="quiz-list"><div class="empty">Загрузка…</div></div>
    </div>

    <div class="card tasks-card">
      <div class="tasks-head"><h3 class="card-title">Задания</h3><button type="button" class="see-all" data-action="all-tasks">Смотреть все</button></div>
      ${tasksList(data.tasks.slice(0, 3), data.user_tasks)}
    </div>
  `;
  root.querySelector("#wheel-card").addEventListener("click", openWheel);

  const panel = root.querySelector(".winter-carousel");
  if (panel) {
    const carousel = mountCarousel(panel, winterBanners, (item) => openCarouselAction(item, news), { autoAdvance: false });
    const show = window.kov.onTabShow("home", carousel.show);
    const hide = window.kov.onTabChange("home", carousel.hide);
    root._winterCarousel = { dispose() { show(); hide(); carousel.dispose(); } };
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

  loadQuizzes(root);

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

function daysWord(n) {
  var abs = Math.abs(n) % 100;
  var last = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
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
    var fire = root.querySelector("#daily-streak-fire");
    const seriesLength = 7;
    var effectiveStreak = Math.max(1, Number(dr.effective_streak || dr.streak || 1));

    if (fire) {
      var tier = effectiveStreak >= 21 ? "blue"
        : effectiveStreak >= 16 ? "purple"
          : effectiveStreak >= 11 ? "red"
            : effectiveStreak >= 5 ? "orange"
              : "normal";
      fire.className = "daily-streak-fire streak-" + tier;
      fire.style.setProperty("--streak-scale", String(1 + Math.min(effectiveStreak - 1, 30) * 0.018));
      fire.style.setProperty("--streak-glow", String(Math.min(10 + effectiveStreak * 1.2, 42)) + "px");
      fire.setAttribute("aria-label", "Серия: " + effectiveStreak + " " + daysWord(effectiveStreak));
      fire.title = "Серия: " + effectiveStreak + " " + daysWord(effectiveStreak);
    }

    // Seven reward steps; the seventh value remains the maximum afterwards.
    var dotsHtml = "";
    for (var i = 1; i <= seriesLength; i++) {
      var filled = i <= Math.min(dr.claimed_today ? effectiveStreak : effectiveStreak - 1, seriesLength);
      var current = !dr.claimed_today && i === Math.min(effectiveStreak, seriesLength);
      dotsHtml += '<span class="daily-dot ' + (filled ? "filled" : current ? "current" : "") + '" aria-label="День ' + i + '"><b>' + i + '</b></span>';
    }
    dots.innerHTML = dotsHtml;

    // Клонируем кнопку, чтобы убрать возможные старые обработчики при повторной загрузке.
    var freshBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(freshBtn, btn);
    btn = freshBtn;

    if (dr.claimed_today) {
      btn.disabled = true;
      btn.textContent = "Получено";
      desc.textContent = "Серия: " + dr.streak + " " + daysWord(dr.streak);
    } else {
      btn.disabled = false;
      btn.textContent = "Забрать";
      var reward = dr.reward;
      desc.textContent = "День серии " + effectiveStreak + " · +" + reward + " " + kovbaksWord(reward);
      btn.addEventListener("click", async function() {
        btn.disabled = true;
        btn.textContent = "Получаем…";
        try {
          var res = await post("/api/home/daily-reward/claim");
          if (!document.documentElement.classList.contains("motion-lite") && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
            const medal = root.querySelector("#daily-streak-fire");
            medal?.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.14)", offset: .45 }, { transform: "scale(1)" }],
              { duration: 300, easing: "cubic-bezier(.2,.72,.2,1)" });
          }
          window.kov.toast("+" + res.reward + " " + kovbaksWord(res.reward) + "! Серия: " + res.streak + " " + daysWord(res.streak));
          if (window.kov.me) window.kov.me.balance = res.balance;
          if (window.kov.emit) window.kov.emit("balance:update", { balance: res.balance });
          loadDailyReward(root, true);
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
async function openWheel() {
  try {
    const status = await get("/api/wheel/status", { force: true });
    const count = status.sectors?.length || 0;
    if (!count) return window.kov.toast("Призы колеса не настроены");
    const modal = window.kov.showModal(`
      <button class="close" type="button" aria-label="Закрыть" onclick="closeModal()">×</button>
      ${wheelMarkup(count)}
      <button type="button" class="btn winter-spin" id="spin-btn" ${status.can_spin ? "" : "disabled"}>Крутить!</button>
    `, {label:"Колесо фортуны"});
    modal.classList.add("winter-wheel-modal");
    const button = modal.querySelector("#spin-btn");
    const rotor = modal.querySelector(".winter-wheel-rotor");
    const availableAt = Date.now() + 1000 * (status.next_spin_seconds || 0);
    if (!status.can_spin) {
      const timer = setInterval(() => {
        if (!modal.isConnected) return clearInterval(timer);
        const seconds = Math.ceil((availableAt - Date.now()) / 1000);
        if (seconds <= 0) {
          clearInterval(timer);
          button.disabled = false;
          button.removeAttribute("aria-label");
          button.removeAttribute("title");
        } else {
          button.title = _fmtCountdown(seconds);
          button.setAttribute("aria-label", button.title);
        }
      }, 1000);
      button.title = _fmtCountdown(status.next_spin_seconds || 0);
      button.setAttribute("aria-label", button.title);
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const spin = await post("/api/wheel/spin");
        if (!modal.isConnected) return;
        playUISound("spin");
        await rotateWheel(rotor, spin.sector_index, count);
        if (!modal.isConnected) return;
        button.title = "Снова доступно через сутки";
        playUISound("win");
        window.kov.toast(spin.result.prize_label + (spin.xp_to_coins > 0 ? " · +" + spin.xp_to_coins + " ковбаксов" : ""));
      } catch (error) {
        window.kov.toast(error.message);
        button.disabled = false;
      }
    });
  } catch (error) {
    window.kov.toast(error.message);
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
