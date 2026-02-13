/**
 * Overlay — Actualiza score, récord, donadores, alertas, war bar, combo.
 */
(function () {
  'use strict';

  const WS_URL = 'ws://localhost:8765';
  const DONORS_STORAGE_KEY = 'arcade_donors_alltime';
  const GIFTS_LOG_KEY = 'arcade_gifts_log';
  const MAX_LOG_ENTRIES = 5000;
  let ws = null;
  let lastDonor = '—';
  let donorsSession = {};
  let donorsAllTime = {};

  /* ── War Bar (desde giftsConfig) ── */
  var HELP_CMDS = new Set();
  var DESTROY_CMDS = new Set();
  var warHelp = 0;
  var warDestroy = 0;

  function applyGiftsConfig(gifts) {
    if (!Array.isArray(gifts) || gifts.length === 0) return;
    HELP_CMDS = new Set(gifts.filter(function (g) { return g.team === 'help'; }).map(function (g) { return g.command; }));
    DESTROY_CMDS = new Set(gifts.filter(function (g) { return g.team === 'destroy'; }).map(function (g) { return g.command; }));
    renderCTA(gifts);
  }

  function renderCTA(gifts) {
    var el = document.getElementById('cta-content');
    if (!el) return;
    var destroy = gifts.filter(function (g) { return g.team === 'destroy'; });
    var help = gifts.filter(function (g) { return g.team === 'help'; });
    var html = '';
    if (destroy.length) {
      html += '<div class="cta-row">';
      destroy.forEach(function (g) { html += '<span class="cta-item cta-destroy">' + (g.emoji || '') + ' ' + (g.id || '') + ' = ' + (g.label || g.command) + '</span>'; });
      html += '</div>';
    }
    if (help.length) {
      html += '<div class="cta-row">';
      help.forEach(function (g) { html += '<span class="cta-item cta-help">' + (g.emoji || '') + ' ' + (g.id || '') + ' = ' + (g.label || g.command) + '</span>'; });
      html += '</div>';
    }
    el.innerHTML = html || '';
  }

  function registerWarVote(cmd) {
    if (HELP_CMDS.has(cmd)) warHelp++;
    else if (DESTROY_CMDS.has(cmd)) warDestroy++;
    renderWarBar();
  }

  function renderWarBar() {
    var total = warHelp + warDestroy;
    if (total === 0) return;
    var helpPct = Math.round((warHelp / total) * 100);
    var destroyPct = 100 - helpPct;
    var helpBar = document.getElementById('war-bar-help');
    var destroyBar = document.getElementById('war-bar-destroy');
    var helpCount = document.getElementById('war-help-count');
    var destroyCount = document.getElementById('war-destroy-count');
    if (helpBar) helpBar.style.width = helpPct + '%';
    if (destroyBar) destroyBar.style.width = destroyPct + '%';
    if (helpCount) helpCount.textContent = warHelp;
    if (destroyCount) destroyCount.textContent = warDestroy;
  }

  /* ── Combo ── */
  var COMBO_WINDOW_MS = 4000;
  var comboCount = 0;
  var lastGiftTime = 0;
  var comboDecayTimer = null;

  function registerCombo() {
    var now = Date.now();
    if (now - lastGiftTime < COMBO_WINDOW_MS) {
      comboCount++;
    } else {
      comboCount = 1;
    }
    lastGiftTime = now;

    clearTimeout(comboDecayTimer);
    comboDecayTimer = setTimeout(function () {
      comboCount = 0;
      updateComboUI(0);
    }, COMBO_WINDOW_MS);

    updateComboUI(comboCount);
  }

  function updateComboUI(count) {
    var panel = document.getElementById('combo-panel');
    var valueEl = document.getElementById('combo-value');
    if (count < 2) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (panel) panel.style.display = '';
    if (valueEl) valueEl.textContent = 'x' + count;
  }

  /* ── Gifts log ── */
  function loadGiftsLog() {
    try {
      var raw = localStorage.getItem(GIFTS_LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function appendGiftLog(ev) {
    var log = loadGiftsLog();
    var entry = {
      user: ev.user || '—',
      id: ev.id || ev.name || '—',
      name: ev.name || ev.id || '—',
      count: typeof ev.count === 'number' ? ev.count : 1,
      time: Date.now()
    };
    var last = log[log.length - 1];
    if (last && last.user === entry.user && last.id === entry.id && last.count === entry.count && entry.time - last.time < 1500) return;
    log.push(entry);
    if (log.length > MAX_LOG_ENTRIES) log = log.slice(-MAX_LOG_ENTRIES);
    try {
      localStorage.setItem(GIFTS_LOG_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  /* ── DOM refs ── */
  var scoreEl = document.getElementById('score');
  var recordEl = document.getElementById('record');
  var donorEl = document.getElementById('last-donor');
  var alertBox = document.getElementById('alert-box');
  var alertText = document.getElementById('alert-text');
  var top5List = document.getElementById('top5-list');
  var kingName = document.getElementById('king-name');
  var kingCount = document.getElementById('king-count');

  /* ── Donors ── */
  function loadDonors() {
    try {
      var raw = localStorage.getItem(DONORS_STORAGE_KEY);
      donorsAllTime = raw ? JSON.parse(raw) : {};
    } catch (e) {
      donorsAllTime = {};
    }
  }

  function saveDonors() {
    try {
      localStorage.setItem(DONORS_STORAGE_KEY, JSON.stringify(donorsAllTime));
    } catch (e) {}
  }

  function addDonation(user, count) {
    if (!user || typeof count !== 'number') return;
    var n = (user + '').trim();
    if (!n) return;
    donorsSession[n] = (donorsSession[n] || 0) + count;
    donorsAllTime[n] = (donorsAllTime[n] || 0) + count;
    saveDonors();
    renderDonors();
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderDonors() {
    var top5Sorted = Object.entries(donorsSession)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 5);
    var kingSorted = Object.entries(donorsAllTime)
      .sort(function (a, b) { return b[1] - a[1]; });
    var king = kingSorted[0];
    if (top5List) {
      top5List.innerHTML = '';
      top5Sorted.forEach(function (entry, i) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="rank">' + (i + 1) + '.</span><span>' + escapeHtml(entry[0]) + '</span><span>' + entry[1] + '</span>';
        top5List.appendChild(li);
      });
    }
    if (kingName && kingCount) {
      if (king) {
        kingName.textContent = king[0];
        kingCount.textContent = king[1] + ' regalos';
      } else {
        kingName.textContent = '—';
        kingCount.textContent = '';
      }
    }
  }

  /* ── WebSocket ── */
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = function () { console.log('[Overlay] Conectado'); };
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'giftsConfig' && msg.gifts) applyGiftsConfig(msg.gifts);
        if (msg.type === 'event' && msg.event) {
          var evt = msg.event;
          appendGiftLog(evt);
          lastDonor = evt.user || lastDonor;
          if (donorEl) donorEl.textContent = lastDonor;
          addDonation(evt.user, typeof evt.count === 'number' ? evt.count : 1);
          registerCombo();
          var comboTag = comboCount >= 2 ? ' 🔥x' + comboCount : '';
          showAlert((evt.name || evt.id || evt.type) + comboTag, evt.user);
        }
        if (msg.cmd) {
          registerWarVote(msg.cmd);
          showAlert('¡' + msg.cmd.replace(/_/g, ' ') + '!', null);
        }
      } catch (e) {}
    };
    ws.onclose = function () { setTimeout(connect, 3000); };
  }

  function showAlert(text, user) {
    if (!alertBox || !alertText) return;
    alertText.textContent = user ? text + ' — @' + user : text;
    alertBox.classList.add('show');
    clearTimeout(alertBox._t);
    alertBox._t = setTimeout(function () { alertBox.classList.remove('show'); }, 2500);
  }

  function updateFromGame(state) {
    if (!state) return;
    if (scoreEl) scoreEl.textContent = state.score ?? 0;
    if (recordEl) recordEl.textContent = state.highScore ?? 0;
  }

  loadDonors();
  renderDonors();
  connect();
  setInterval(function () {
    if (typeof window.SnakeEngine !== 'undefined' && window.SnakeEngine.getState) {
      updateFromGame(window.SnakeEngine.getState());
    }
  }, 200);
})();
