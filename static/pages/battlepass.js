import { get, post } from "/static/api.js?v=279";

var _bpRoot = null;
var _bpData = null;

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function _rewardIcon(r) {
  if (!r) return "/static/img/ui/box.svg";
  if (r.kind === "xp") return "/static/img/ui/xp.png";
  if (r.kind === "none") return "";
  if (r.kind && r.kind.indexOf("coins") !== -1) return "/static/img/ui/kovbaks.png";
  return r.icon || "/static/img/ui/box.svg";
}

function _rewardQty(r) {
  if (!r || !r.value || r.kind === "none") return "";
  return "×" + r.value;
}

function _rewardLabel(r) {
  if (!r) return "";
  if (r.label) return r.label;
  if (r.kind === "coins") return r.value + " монет";
  if (r.kind === "xp") return r.value + " XP";
  return r.kind || "";
}

function _isMilestone(lvl) {
  return lvl % 10 === 0;
}

// Visual band of an island: clouds up to 30, green isles to 60, stone to the
// level before last, and a diamond crown on the final level.
function _isleTheme(lvl, totalLevels) {
  if (lvl >= totalLevels) return "bp-isle-diamond";
  if (lvl <= 30) return "bp-isle-cloudy";
  if (lvl <= 60) return "bp-isle-grass";
  return "bp-isle-stone";
}

// With 100 levels the player's island is far below the fold, so the ladder is
// positioned on it instead of at the top every time the tab is shown.
function _scrollToCurrentIsland() {
  if (!_bpRoot || !_bpData || !_bpData.season) return;
  var total = Math.max(1, Number(_bpData.season.total_levels) || 1);
  var level = Math.min(Math.max(Number(_bpData.current_level) || 0, 0), total - 1) + 1;
  var island = document.getElementById("bp-lvl-" + level);
  var view = document.getElementById("view");
  if (!island || !view) return;
  // Rect math instead of offsetTop: the island's offsetParent depends on which
  // ancestors happen to be positioned.
  var delta = island.getBoundingClientRect().top - view.getBoundingClientRect().top;
  var target = view.scrollTop + delta - (view.clientHeight - island.offsetHeight) / 2;
  var maxScroll = Math.max(0, view.scrollHeight - view.clientHeight);
  view.scrollTop = Math.min(Math.max(0, target), maxScroll);
}

export async function renderBattlePass(root) {
  _bpRoot = root;
  root.classList.add("bp-page");
  root.innerHTML = '<div class="bp-loading">Загрузка…</div>';

  try {
    _bpData = await get("/api/battlepass", { force: true });
    if (!_bpData || !_bpData.season) {
      root.innerHTML = '<div class="bp-loading">Боевой пропуск пока не активен</div>';
      return;
    }
  } catch (e) {
    root.innerHTML = '<div class="bp-loading">Ошибка загрузки: ' + e.message + "</div>";
    return;
  }

  _renderBP(_bpData);
}

function _renderBP(data) {
  var s = data.season;
  var currentLevel = Math.min(data.current_level || 0, s.total_levels - 1);
  var isMaxLevel = currentLevel >= s.total_levels - 1;
  // Защита от NaN: xp_for_level может быть 0/undefined.
  var xpPct = isMaxLevel ? 100 : data.xp_for_level > 0 ? Math.min(100, Math.round((data.current_xp / data.xp_for_level) * 100)) : 0;
  var displayedXp = isMaxLevel ? data.xp_for_level : data.current_xp;
  var claimed = {};
  (data.claimed_rewards || []).forEach(function(c) { claimed[typeof c === "number" ? c : c[0]] = true; });

  // Rewards by level
  var byLvl = {};
  for (var i = 0; i < s.rewards.length; i++) {
    byLvl[s.rewards[i].level] = s.rewards[i];
  }

  var html = "";

  // Decorative sky/sea layers
  html += '<div class="bp-sky"></div>';
  html += '<div class="bp-sun"></div>';
  html += '<div class="bp-cloud-static bp-cloud-left1"></div>';
  html += '<div class="bp-cloud-static bp-cloud-left2"></div>';
  html += '<div class="bp-sea"></div>';
  html += '<div class="bp-flowers"></div>';

  // Header
  html += '<div class="bp-head">';
  html += '<div class="bp-season-label">' + escapeHtml(s.name || "Сезон") + '</div>';
  html += '<img class="bp-head-icon-slot" src="/static/img/season_icon.png" alt="' + escapeHtml(s.name || "Сезон") + '"/>';
  html += '<div class="bp-head-xp">';
  html += '<div class="bp-head-bar"><div class="bp-head-fill" style="width:' + xpPct + '%"></div></div>';
  html += '<div class="bp-head-stats"><span>Уровень ' + (currentLevel + 1) + " / " + s.total_levels + "</span><span>" + displayedXp + " / " + data.xp_for_level + " XP</span></div>";
  html += "</div></div>";

  // Island path
  html += '<div class="bp-path">';
  for (var lvl = 1; lvl <= s.total_levels; lvl++) {
    var r = byLvl[lvl] || null;
    var isDone = lvl <= currentLevel;
    var isCurrent = lvl === currentLevel + 1;
    var isClaimed = !!claimed[lvl];
    var isMilestone = _isMilestone(lvl);
    var side = lvl % 2 === 1 ? "left" : "right";

    var stateClass = isClaimed ? "is-claimed" : isCurrent ? "is-current" : isDone ? "is-ready" : "is-locked";

    html += '<div class="bp-isle bp-isle-' + side + " " + stateClass + (isMilestone ? " is-milestone" : "") + '" id="bp-lvl-' + lvl + '" data-lvl="' + lvl + '">';
    html += '<div class="bp-isle-shadow"></div>';
    html += '<div class="bp-isle-body">';
    html += '<div class="bp-isle-lvl">' + lvl + "</div>";

    if (r) {
      var icon = _rewardIcon(r);
      if (icon) html += '<img class="bp-isle-icon" src="' + icon + '" alt="" onerror="this.style.display=\'none\'"/>';
      var qty = _rewardQty(r);
      if (qty) html += '<div class="bp-isle-qty">' + qty + "</div>";
    } else {
      html += '<div class="bp-isle-icon bp-isle-empty">?</div>';
    }

    if (isClaimed) {
      html += '<div class="bp-isle-check">✓</div>';
    } else if ((isCurrent || isDone) && r) {
      // Кнопку «Забрать» показываем только если на уровне есть награда.
      html += '<button class="bp-isle-claim">Забрать</button>';
    }

    html += "</div>";
    html += "</div>";
  }
  html += "</div>";

  _bpRoot.innerHTML = html;

  // Dynamic clouds: float at first 10 islands level
  (function() {
    var sky = _bpRoot.querySelector(".bp-sky");
    if (!sky) return;
    var cloudCount = Math.min(18, Math.ceil(s.total_levels / 2));
    for (var ci = 0; ci < cloudCount; ci++) {
      var c = document.createElement("div");
      c.className = "bp-cloud";
      var size = 30 + Math.random() * 50;
      c.style.width = size + "px";
      c.style.height = (size * 0.3) + "px";
      c.style.left = (Math.random() * 70 + 5) + "%";
      c.style.top = (2 + Math.random() * 30) + "%";
      c.style.animationDuration = (25 + Math.random() * 30) + "s";
      c.style.animationDelay = (-Math.random() * 40) + "s";
      c.style.opacity = "0";
      sky.appendChild(c);
    }
  })();

  // Island themes: clouds 1-30, green isles 31-60, stone 61-99, diamond at 100.
  // Every tenth level is golden; the final level keeps its diamond look instead.
  for (var ci = 1; ci <= s.total_levels; ci++) {
    var el = document.getElementById("bp-lvl-" + ci);
    if (!el) continue;
    el.classList.add(_isleTheme(ci, s.total_levels));
    if (_isMilestone(ci) && ci !== s.total_levels) el.classList.add("bp-isle-gold");
  }

  // Cap XP display at level 30 (max 100%)
  (function() {
    var maxXp = s.xp_per_level;
    var maxed = data.current_level >= s.total_levels - 1;
    var curXp = maxed ? maxXp : Math.min(data.current_xp, maxXp);
    var pct = Math.min(100, Math.round((curXp / maxXp) * 100));
    var fillEl = _bpRoot.querySelector(".bp-head-fill");
    if (fillEl) fillEl.style.width = pct + "%";
    var stats = _bpRoot.querySelectorAll(".bp-head-stats span");
    if (stats.length >= 2) {
      var lvl = Math.min(data.current_level + 1, s.total_levels);
      stats[0].textContent = "\u0423\u0440\u043e\u0432\u0435\u043d\u044c " + lvl + " / " + s.total_levels;
      stats[1].textContent = curXp + " / " + maxXp + " XP";
    }
  })();

  // Land on the current island — on first render and on every later switch to
  // this tab. The shell restores its own remembered scroll inside a rAF right
  // before notifying listeners, so this runs one frame later and wins.
  requestAnimationFrame(_scrollToCurrentIsland);
  if (window.kov && window.kov.onTabShow) {
    window.kov.onTabShow("battlepass", function() {
      requestAnimationFrame(_scrollToCurrentIsland);
    });
  }

  // Reconcile claim controls from the authoritative pass snapshot without
  // replacing the whole illustrated path (and without moving the scroll).
  function syncIslandStates(data) {
    if (!data || !data.season) return;
    var totalLevels = Math.max(1, Number(data.season.total_levels) || 1);
    var currentIndex = Math.min(Math.max(Number(data.current_level) || 0, 0), totalLevels - 1);
    var claimedLevels = new Set((data.claimed_rewards || []).map(function(value) {
      return typeof value === "number" ? value : value[0];
    }));
    var rewardLevels = new Set((data.season.rewards || []).map(function(reward) { return reward.level; }));

    _bpRoot.querySelectorAll(".bp-isle[data-lvl]").forEach(function(island) {
      var level = Number(island.dataset.lvl);
      var body = island.querySelector(".bp-isle-body");
      if (!body) return;
      var isClaimed = claimedLevels.has(level);
      var isCurrent = level === currentIndex + 1;
      var isDone = level <= currentIndex;
      island.classList.remove("is-claimed", "is-current", "is-ready", "is-locked");
      island.classList.add(isClaimed ? "is-claimed" : isCurrent ? "is-current" : isDone ? "is-ready" : "is-locked");
      body.querySelectorAll(".bp-isle-check, .bp-isle-claim").forEach(function(control) { control.remove(); });

      if (isClaimed) {
        var check = document.createElement("div");
        check.className = "bp-isle-check";
        check.textContent = "\u2713";
        body.appendChild(check);
      } else if ((isCurrent || isDone) && rewardLevels.has(level)) {
        var claimButton = document.createElement("button");
        claimButton.className = "bp-isle-claim";
        claimButton.textContent = "\u0417\u0430\u0431\u0440\u0430\u0442\u044c";
        claimButton.addEventListener("click", function(event) {
          event.stopPropagation();
          _handleClaim(claimButton, island, level);
        });
        body.appendChild(claimButton);
      }
    });
  }

  // Bind claims
  async function _handleClaim(btn, node, lvl) {
    // \u0417\u0430\u0449\u0438\u0442\u0430 \u043e\u0442 \u0434\u0432\u043e\u0439\u043d\u043e\u0433\u043e \u043a\u043b\u0438\u043a\u0430: \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u043d\u043e \u0434\u0438\u0437\u0435\u0439\u0431\u043b\u0438\u043c \u0432 \u043d\u0430\u0447\u0430\u043b\u0435; \u043f\u0440\u0438 \u0443\u0441\u043f\u0435\u0445\u0435 \u041d\u0415 \u0440\u0430\u0437\u0431\u043b\u043e\u043a\u0438\u0440\u0443\u0435\u043c.
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      var result = await post("/api/battlepass/claim", { level: lvl });
      _bpData.claimed_rewards.push(lvl);
      if (result && result.xp_to_coins > 0 && window.kov && window.kov.toast) {
        window.kov.toast("Достигнут максимум XP — излишек перешёл в " + result.xp_to_coins + " ковбаксов");
      }
      if (result && result.balance != null && window.kov && window.kov.me) {
        window.kov.me.balance = result.balance;
        if (window.kov.emit) window.kov.emit("balance:update", { balance: result.balance });
      }
        // Smooth update: only change this island, no full re-render
        node.classList.remove("is-ready", "is-current");
        node.classList.add("is-claimed", "bp-isle-pop");
        btn.remove();
        var check = document.createElement("div");
        check.className = "bp-isle-check";
        check.textContent = "\u2713";
        node.querySelector(".bp-isle-body").appendChild(check);
        // \u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u043c \u0441\u0432\u0435\u0436\u0438\u0435 \u0434\u0430\u043d\u043d\u044b\u0435, \u0447\u0442\u043e\u0431\u044b \u0445\u0435\u0434\u0435\u0440/\u0431\u0430\u0440 \u043e\u0442\u0440\u0430\u0436\u0430\u043b\u0438 \u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u044b\u0435 XP/\u0443\u0440\u043e\u0432\u0435\u043d\u044c \u043f\u043e\u0441\u043b\u0435 claim.
        try {
          var fresh = await get("/api/battlepass", { force: true });
          if (fresh && fresh.season) _bpData = fresh;
        } catch (_) {}
        syncIslandStates(_bpData);
        // Update header XP display \u0438\u0437 \u0441\u0432\u0435\u0436\u0438\u0445 _bpData
        var headFill = _bpRoot.querySelector(".bp-head-fill");
        var headStats = _bpRoot.querySelectorAll(".bp-head-stats span");
        if (headFill) {
          var maxed = _bpData.season && _bpData.current_level >= _bpData.season.total_levels - 1;
          var pct = maxed ? 100 : _bpData.xp_for_level > 0
            ? Math.min(100, Math.round((_bpData.current_xp || 0) / _bpData.xp_for_level * 100))
            : 0;
          headFill.style.width = pct + "%";
        }
        if (headStats.length > 1) {
          var displayedXp = maxed ? (_bpData.xp_for_level || 0) : (_bpData.current_xp || 0);
          headStats[1].textContent = displayedXp + " / " + (_bpData.xp_for_level || 0) + " XP";
        }
        if (headStats.length > 0 && _bpData.season) {
          var lvlDisp = Math.min((_bpData.current_level || 0) + 1, _bpData.season.total_levels);
          headStats[0].textContent = "\u0423\u0440\u043e\u0432\u0435\u043d\u044c " + lvlDisp + " / " + _bpData.season.total_levels;
        }
        window.kov && window.kov.toast && window.kov.toast("\u041d\u0430\u0433\u0440\u0430\u0434\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0430!");
    } catch (err) {
      btn.disabled = false;
      window.kov && window.kov.toast && window.kov.toast(err.message);
    }
  }
  _bpRoot.querySelectorAll(".bp-isle-claim").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var node = btn.closest("[data-lvl]");
      if (!node) return;
      _handleClaim(btn, node, Number(node.dataset.lvl));
    });
  });
}
