import { get, post } from "/static/api.js?v=40";

var _bpRoot = null;
var _bpData = null;

function _rewardIcon(r) {
  if (r.icon) return r.icon;
  if (r.kind === "xp") return "/static/img/item_icons/xp.svg";
  if (r.kind === "none") return "";
  if (r.kind && r.kind.indexOf("coins") !== -1) return "/static/img/ui/coin.svg";
  return r.icon || "/static/img/ui/box.svg";
}

function _rewardQty(r) {
  if (!r || !r.value || r.kind === "none") return "";
  return "x" + r.value;
}

function _rewardLabel(r) {
  if (r.label) return r.label;
  if (r.kind === "coins") return r.value + " монет";
  if (r.kind === "xp") return r.value + " XP";
  return r.kind || "";
}

function _isMilestone(lvl) {
  return lvl % 10 === 0 || lvl === 1 || lvl === 100;
}

export async function renderBattlePass(root) {
  _bpRoot = root;
  root.classList.add("bp-page");
  root.innerHTML = '<div class="bp-glass"><div class="bp-loading">Загрузка…</div></div>';

  try {
    _bpData = await get("/api/battlepass");
    if (!_bpData || !_bpData.season) {
      root.innerHTML = '<div class="bp-glass"><div class="bp-loading">Боевой пропуск пока не активен</div></div>';
      return;
    }
  } catch (e) {
    root.innerHTML = '<div class="bp-glass"><div class="bp-loading">Ошибка загрузки: ' + e.message + "</div></div>";
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

  var html = "";

  // Header
  html += '<div class="bp-head">';
  html += '<h2 class="bp-head-title">' + s.name + "</h2>";
  html += '<div class="bp-head-xp">';
  html += '<div class="bp-head-bar"><div class="bp-head-fill" style="width:' + xpPct + '%"></div></div>';
  html += '<div class="bp-head-stats"><span>Ур. ' + (currentLevel + 1) + "</span><span>" + data.current_xp + " / " + data.xp_for_level + " XP</span></div>";
  html += "</div>";
  html += "</div>";

  // Level list
  html += '<div class="bp-list" id="bp-list">';
  for (var lvl = 1; lvl <= s.total_levels; lvl++) {
    var isDone = lvl <= currentLevel;
    var isCurrent = lvl === currentLevel + 1;
    var isClaimed = claimed[lvl];
    var isMilestone = _isMilestone(lvl);

    var r = null;
    for (var i = 0; i < s.rewards.length; i++) {
      if (s.rewards[i].level === lvl) { r = s.rewards[i]; break; }
    }

    var stateClass = isClaimed ? "bp-node-done" : isDone ? "bp-node-ready" : isCurrent ? "bp-node-current" : "bp-node-locked";

    html += '<div class="bp-node ' + stateClass + (isMilestone ? ' bp-node-milestone' : '') + '" data-lvl="' + lvl + '" id="bp-lvl-' + lvl + '">';

    // Level badge
    html += '<div class="bp-node-badge">' + lvl + "</div>";

    // Reward info
    html += '<div class="bp-node-info">';
    if (r) {
      var icon = _rewardIcon(r);
      if (icon) html += '<img class="bp-node-icon" src="' + icon + '" alt=""/>';
      html += '<span class="bp-node-label">' + _rewardLabel(r) + "</span>";
      var qty = _rewardQty(r);
      if (qty) html += '<span class="bp-node-qty">' + qty + "</span>";
    } else {
      html += '<span class="bp-node-label bp-node-empty">—</span>';
    }
    html += "</div>";

    // Action
    if (isClaimed) {
      html += '<div class="bp-node-action"><span class="bp-node-check">✓</span></div>';
    } else if (isDone || isCurrent) {
      html += '<button class="bp-node-claim">Забрать</button>';
    }

    html += "</div>";
  }
  html += "</div>";

  _bpRoot.innerHTML = '<div class="bp-glass">' + html + "</div>";

  // Auto-scroll to current level
  requestAnimationFrame(function() {
    var el = document.getElementById("bp-lvl-" + (currentLevel + 1));
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  // Bind claims
  _bpRoot.querySelectorAll(".bp-node-claim").forEach(function(btn) {
    btn.addEventListener("click", async function(e) {
      e.stopPropagation();
      var node = btn.closest("[data-lvl]");
      if (!node) return;
      var lvl = Number(node.dataset.lvl);
      try {
        var result = await post("/api/battlepass/claim", { level: lvl });
        _bpData.claimed_rewards.push(lvl);
        if (result.balance != null && window.kov && window.kov.me) {
          window.kov.me.balance = result.balance;
          if (window.kov.emit) window.kov.emit("balance:update", { balance: result.balance });
        }
        _renderBP(_bpData);
        window.kov && window.kov.toast && window.kov.toast("Награда получена!");
      } catch (e) { window.kov && window.kov.toast && window.kov.toast(e.message); }
    });
  });
}
