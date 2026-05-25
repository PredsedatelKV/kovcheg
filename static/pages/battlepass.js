import { get, post } from "/static/api.js?v=40";

var _bpRoot = null;
var _bpData = null;

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
  return lvl % 10 === 0 || lvl === 1;
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
  var currentLevel = Math.min(data.current_level, s.total_levels - 1);
  var xpPct = Math.min(100, Math.round((data.current_xp / data.xp_for_level) * 100));
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
  html += '<div class="bp-cloud bp-cloud-1"></div>';
  html += '<div class="bp-cloud bp-cloud-2"></div>';
  html += '<div class="bp-cloud bp-cloud-3"></div>';
  html += '<div class="bp-sea"></div>';
  html += '<div class="bp-flowers"></div>';

  // Header
  html += '<div class="bp-head">';
  html += '<div class="bp-season-label">СЕЗОН 1</div>';
  html += '<h2 class="bp-head-title">' + s.name + '</h2>';
  html += '<div class="bp-head-icon-slot" title="Нажми чтобы добавить свою иконку (пока пусто)"></div>';
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
    } else if (isCurrent || isDone) {
      html += '<button class="bp-isle-claim">Забрать</button>';
    } else {
      html += '<div class="bp-isle-lock"></div>';
    }

    html += "</div>";
    if (isMilestone) html += '<div class="bp-isle-flag">🚩</div>';
    html += "</div>";
  }
  html += "</div>";

  _bpRoot.innerHTML = html;

  // Auto-scroll only on first render
  if (!_bpRoot._bpScrolled) {
    _bpRoot._bpScrolled = true;
    requestAnimationFrame(function() {
      var el = document.getElementById("bp-lvl-" + (currentLevel + 1));
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  // Bind claims
  _bpRoot.querySelectorAll(".bp-isle-claim").forEach(function(btn) {
    btn.addEventListener("click", async function(e) {
      e.stopPropagation();
      var node = btn.closest("[data-lvl]");
      if (!node) return;
      var lvl = Number(node.dataset.lvl);
      btn.disabled = true;
      try {
        var result = await post("/api/battlepass/claim", { level: lvl });
        _bpData.claimed_rewards.push(lvl);
        if (result && result.balance != null && window.kov && window.kov.me) {
          window.kov.me.balance = result.balance;
          if (window.kov.emit) window.kov.emit("balance:update", { balance: result.balance });
        }
        // Animate node before re-render
        node.classList.add("bp-isle-pop");
        var savedScroll = _bpRoot.closest('.tab-content') ? _bpRoot.closest('.tab-content').scrollTop : 0;
        setTimeout(function() { _renderBP(_bpData); _bpRoot.closest('.tab-content') && (_bpRoot.closest('.tab-content').scrollTop = savedScroll); }, 380);
        window.kov && window.kov.toast && window.kov.toast("Награда получена!");
      } catch (err) {
        btn.disabled = false;
        window.kov && window.kov.toast && window.kov.toast(err.message);
      }
    });
  });
}
