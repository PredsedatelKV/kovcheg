import { get, post } from "/static/api.js?v=215";

var _bpRoot = null;
var _bpData = null;

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function _rewardIcon(r) {
  if (!r) return "/static/img/ui/box.svg";
  if (r.icon) return r.icon;
  if (r.kind === "xp") return "/static/img/item_icons/xp.svg";
  if (r.kind === "none") return "";
  if (r.kind && r.kind.indexOf("coins") !== -1) return "/static/img/ui/coin.svg";
  return "/static/img/ui/box.svg";
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

export async function renderBattlePass(root) {
  _bpRoot = root;
  root.classList.add("bp-page");
  root.innerHTML = '<div class="bp-loading">Загрузка…</div>';

  try {
    _bpData = await get("/api/battlepass");
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
  // Защита от NaN: xp_for_level может быть 0/undefined.
  var xpPct = data.xp_for_level > 0 ? Math.min(100, Math.round((data.current_xp / data.xp_for_level) * 100)) : 0;
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
  html += '<div class="bp-head-stats"><span>Уровень ' + (currentLevel + 1) + " / " + s.total_levels + "</span><span>" + data.current_xp + " / " + data.xp_for_level + " XP</span></div>";
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
    } else if (!isCurrent && !isDone) {
      html += '<div class="bp-isle-lock"></div>';
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
    for (var ci = 0; ci < Math.ceil(s.total_levels / 2); ci++) {
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

  // Island themes: cloudy 1-9, grass 10-19, stone 20-30; gold 1/10/20/30
  for (var ci = 1; ci <= s.total_levels; ci++) {
    var el = document.getElementById("bp-lvl-" + ci);
    if (!el) continue;
    if (ci <= 10) el.classList.add("bp-isle-cloudy");
    else if (ci <= 20) el.classList.add("bp-isle-grass");
    else el.classList.add("bp-isle-stone");
    if (ci === 10 || ci === 20 || ci === 30) el.classList.add("bp-isle-gold");
  }

  // Cap XP display at level 30 (max 100%)
  (function() {
    var maxXp = s.xp_per_level;
    var curXp = Math.min(data.current_xp, maxXp);
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

  // Auto-scroll only on first render
  if (!_bpRoot._bpScrolled) {
    _bpRoot._bpScrolled = true;
    requestAnimationFrame(function() {
      var el = document.getElementById("bp-lvl-" + (currentLevel + 1));
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
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
          var fresh = await get("/api/battlepass");
          if (fresh && fresh.season) _bpData = fresh;
        } catch (_) {}
        // Update header XP display \u0438\u0437 \u0441\u0432\u0435\u0436\u0438\u0445 _bpData
        var headFill = _bpRoot.querySelector(".bp-head-fill");
        var headStats = _bpRoot.querySelectorAll(".bp-head-stats span");
        if (headFill) {
          var pct = _bpData.xp_for_level > 0
            ? Math.min(100, Math.round((_bpData.current_xp || 0) / _bpData.xp_for_level * 100))
            : 0;
          headFill.style.width = pct + "%";
        }
        if (headStats.length > 1) {
          headStats[1].textContent = (_bpData.current_xp || 0) + " / " + (_bpData.xp_for_level || 0) + " XP";
        }
        if (headStats.length > 0 && _bpData.season) {
          var lvlDisp = Math.min((_bpData.current_level || 0) + 1, _bpData.season.total_levels);
          headStats[0].textContent = "\u0423\u0440\u043e\u0432\u0435\u043d\u044c " + lvlDisp + " / " + _bpData.season.total_levels;
        }
        // Unlock next island if it was locked
        var nextLvl = lvl + 1;
        var nextNode = _bpRoot.querySelector('[data-lvl="' + nextLvl + '"]');
        if (nextNode && nextNode.classList.contains("is-locked")) {
          nextNode.classList.remove("is-locked");
          nextNode.classList.add("is-current");
          var claimBtn = document.createElement("button");
          claimBtn.className = "bp-isle-claim";
          claimBtn.textContent = "\u0417\u0430\u0431\u0440\u0430\u0442\u044c";
          nextNode.querySelector(".bp-isle-body").appendChild(claimBtn);
          claimBtn.addEventListener("click", function(ev) {
            ev.stopPropagation();
            _handleClaim(claimBtn, nextNode, nextLvl);
          });
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
