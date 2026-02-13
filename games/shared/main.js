/**
 * Main — Conecta Engine, Bot y Control Server (WebSocket).
 * Core multijuego: detecta Snake o Tetris y usa el engine/bot correspondiente.
 *
 * Features:
 *   1. Tensión dramática  — peligro visual/sonoro
 *   2. Donor War           — Help vs Destroy con consecuencias
 *   3. Combos              — multiplicador por donaciones consecutivas
 *   4. Gift Animations     — emoji grande volando + nombre donante + partículas
 *   5. Goal System         — metas colectivas que incentivan donaciones
 *   6. Milestone Celebrations — celebración en score milestones
 *   7. Tiered gifts        — tamaño de animación proporcional al precio
 *
 * Contrato del engine: applyEffect(type, value), getState(), onEffect(fn), resetGame()
 */
(function (global) {
  'use strict';

  /* ═══════════════════════════════════
     WS URL: autodetect hostname para deploy
     ═══════════════════════════════════ */
  const WS_HOST = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'ws://localhost:8765'
    : 'ws://' + location.hostname + ':8765';
  const WS_URL = WS_HOST;

  const DONORS_STORAGE_KEY = 'arcade_donors_alltime';
  const GIFTS_LOG_KEY = 'arcade_gifts_log';
  const MAX_LOG_ENTRIES = 5000;
  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let donorsSession = {};
  let donorsAllTime = {};
  let giftsConfig = [];
  let goalsConfig = [];

  /* ═══════════════════════════════════
     CORE MULTIJUEGO — Detección de juego activo
     ═══════════════════════════════════ */
  function getEngine() {
    return global.DodgeEngine || global.FlappyEngine || global.PongEngine ||
           global.BreakoutEngine || global.TetrisEngine || global.SnakeEngine || null;
  }

  function getBot() {
    return global.DodgeBot || global.FlappyBot || global.PongBot ||
           global.BreakoutBot || global.TetrisBot || global.SnakeBot || null;
  }

  const SNAKE_CMD_MAP = {
    SPEED_UP: ['speed', 2],
    NUKE: ['nuke'],
    CHAOS: ['chaos'],
    SHIELD: ['shield', 3000],
    MEGA_SHIELD: ['shield', 10000],
    SPAWN_FRUITS: ['spawnFruits', null],
    BONUS_POINTS: ['bonus', null],
    MEGA_BONUS: ['bonus', 2000],
    RAIN_FRUITS: ['spawnFruits', 100],
    INVINCIBLE: ['shield', 15000],
    DOUBLE_SCORE: ['doubleScore', 30000],
    SUPER_EVENT: ['superEvent', null]
  };

  const TETRIS_CMD_MAP = {
    SPEED_UP: ['speed', 2],
    NUKE: ['garbage', 3],
    CHAOS: ['chaos'],
    SHIELD: ['shield', 5000],
    SPAWN_FRUITS: ['clearLine', 1],
    BONUS_POINTS: ['bonus', null]
  };

  const BREAKOUT_CMD_MAP = {
    SPEED_UP: ['speed', 1],
    NUKE: ['nuke'],
    CHAOS: ['chaos'],
    SHIELD: ['shield', 5000],
    SPAWN_FRUITS: ['bonus', 50],
    BONUS_POINTS: ['bonus', null]
  };

  const PONG_CMD_MAP = {
    SPEED_UP: ['speed', 1],
    NUKE: ['kill'],
    CHAOS: ['chaos'],
    SHIELD: ['shield', 5000],
    SPAWN_FRUITS: ['bonus', 10],
    BONUS_POINTS: ['bonus', null]
  };

  const FLAPPY_CMD_MAP = {
    SPEED_UP: ['speed', 1],
    NUKE: ['kill'],
    CHAOS: ['chaos'],
    SHIELD: ['shield', 5000],
    SPAWN_FRUITS: ['bonus', 10],
    BONUS_POINTS: ['bonus', null]
  };

  const DODGE_CMD_MAP = {
    SPEED_UP: ['speed', 1],
    NUKE: ['nuke'],
    CHAOS: ['chaos'],
    SHIELD: ['shield', 5000],
    SPAWN_FRUITS: ['bonus', 10],
    BONUS_POINTS: ['bonus', null]
  };

  function getCommandMap() {
    if (global.DodgeEngine) return DODGE_CMD_MAP;
    if (global.FlappyEngine) return FLAPPY_CMD_MAP;
    if (global.PongEngine) return PONG_CMD_MAP;
    if (global.BreakoutEngine) return BREAKOUT_CMD_MAP;
    if (global.TetrisEngine) return TETRIS_CMD_MAP;
    return SNAKE_CMD_MAP;
  }

  /* ═══════════════════════════════════
     FEATURE: GIFT ANIMATIONS (emoji + donor name flying)
     ═══════════════════════════════════ */
  function spawnGiftAnimation(emoji, username, tier) {
    const container = document.getElementById('gift-anim-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'gift-anim gift-tier-' + (tier || 1);
    el.style.left = (15 + Math.random() * 70) + '%';
    el.innerHTML = '<span class="gift-anim-emoji">' + (emoji || '🎁') + '</span>' +
                   '<span class="gift-anim-name">@' + escapeHtml(username || '???') + '</span>';

    container.appendChild(el);

    // Partículas para tier 3
    if (tier >= 3) {
      for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'gift-particle';
        const angle = (Math.PI * 2 * i) / 12;
        const dist = 60 + Math.random() * 80;
        p.style.setProperty('--px', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--py', Math.sin(angle) * dist + 'px');
        p.style.left = '50%';
        p.style.top = '40%';
        p.style.background = ['#ffd700', '#ff2d92', '#00ffb4', '#b24bf3', '#00e5ff'][i % 5];
        el.appendChild(p);
      }
    }

    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }

  /* ═══════════════════════════════════
     FEATURE: DONOR WAR — Help vs Destroy con consecuencias
     ═══════════════════════════════════ */
  let HELP_COMMANDS = new Set();
  let DESTROY_COMMANDS = new Set();
  let warHelp = 0;
  let warDestroy = 0;
  let warCheckInterval = null;
  const WAR_CHECK_MS = 30000; // Evaluar guerra cada 30 segundos
  let lastWarResult = '';

  function applyGiftsConfig(gifts) {
    if (!Array.isArray(gifts) || gifts.length === 0) return;
    giftsConfig = gifts;
    HELP_COMMANDS = new Set(gifts.filter(g => g.team === 'help').map(g => g.command));
    DESTROY_COMMANDS = new Set(gifts.filter(g => g.team === 'destroy').map(g => g.command));
    initCTA(gifts);
  }

  function registerWarVote(cmd, count) {
    const n = count || 1;
    if (HELP_COMMANDS.has(cmd)) warHelp += n;
    else if (DESTROY_COMMANDS.has(cmd)) warDestroy += n;
    renderWarBar();
  }

  function renderWarBar() {
    const total = warHelp + warDestroy;
    if (total === 0) return;
    const helpPct = Math.round((warHelp / total) * 100);
    const destroyPct = 100 - helpPct;
    const helpBar = document.getElementById('war-bar-help');
    const destroyBar = document.getElementById('war-bar-destroy');
    const helpCount = document.getElementById('war-help-count');
    const destroyCount = document.getElementById('war-destroy-count');
    if (helpBar) helpBar.style.width = helpPct + '%';
    if (destroyBar) destroyBar.style.width = destroyPct + '%';
    if (helpCount) helpCount.textContent = warHelp;
    if (destroyCount) destroyCount.textContent = warDestroy;
  }

  /** Consecuencias de la guerra: el equipo que lidera recibe un efecto */
  function checkWarConsequences() {
    const total = warHelp + warDestroy;
    if (total < 5) return; // Necesita al menos 5 donaciones para activar
    const engine = getEngine();
    if (!engine) return;

    const diff = Math.abs(warHelp - warDestroy);
    if (diff < 3) return; // Empate técnico, sin consecuencias

    const overlay = document.getElementById('war-result-overlay');
    let result = '';

    if (warHelp > warDestroy) {
      result = 'help';
      if (result !== lastWarResult) {
        // Help gana: bonus positivo
        engine.applyEffect('shield', 5000);
        engine.applyEffect('spawnFruits', 15);
        if (overlay) {
          overlay.textContent = '🛡 HELP DOMINA — ¡Shield + Frutas!';
          overlay.className = 'war-result-overlay show war-help-wins';
          clearTimeout(overlay._t);
          overlay._t = setTimeout(() => { overlay.className = 'war-result-overlay'; }, 3500);
        }
      }
    } else {
      result = 'destroy';
      if (result !== lastWarResult) {
        // Destroy gana: castigo
        engine.applyEffect('speed', 2);
        if (overlay) {
          overlay.textContent = '💀 DESTROY DOMINA — ¡Velocidad Extrema!';
          overlay.className = 'war-result-overlay show war-destroy-wins';
          clearTimeout(overlay._t);
          overlay._t = setTimeout(() => { overlay.className = 'war-result-overlay'; }, 3500);
        }
      }
    }
    lastWarResult = result;
  }

  /* ═══════════════════════════════════
     FEATURE: COMBOS Y MULTIPLICADORES
     ═══════════════════════════════════ */
  const COMBO_WINDOW_MS = 4000;
  const COMBO_TIERS = [
    { min: 2, label: 'x2 COMBO!', cls: 'combo-2' },
    { min: 3, label: 'x3 TRIPLE!', cls: 'combo-3' },
    { min: 5, label: 'x5 FRENZY!', cls: 'combo-5' },
    { min: 8, label: '🔥 MEGA x8!', cls: 'combo-mega' },
    { min: 12, label: '💎 ULTRA x12!', cls: 'combo-mega' },
    { min: 20, label: '⚡ GOD MODE x20!', cls: 'combo-mega' }
  ];
  let comboCount = 0;
  let lastGiftTime = 0;
  let comboDecayTimer = null;

  function registerCombo() {
    const now = Date.now();
    if (now - lastGiftTime < COMBO_WINDOW_MS) {
      comboCount++;
    } else {
      comboCount = 1;
    }
    lastGiftTime = now;

    clearTimeout(comboDecayTimer);
    comboDecayTimer = setTimeout(() => {
      comboCount = 0;
      updateComboUI(0);
    }, COMBO_WINDOW_MS);

    updateComboUI(comboCount);

    const engine = getEngine();
    if (comboCount >= 2 && engine) {
      const bonusPoints = comboCount * 5;
      engine.applyEffect('bonus', bonusPoints);
    }

    if (comboCount >= 2 && typeof global.ArcadeAudio !== 'undefined') {
      global.ArcadeAudio.playComboSound(comboCount);
    }
  }

  function updateComboUI(count) {
    const panel = document.getElementById('combo-panel');
    const valueEl = document.getElementById('combo-value');
    const popup = document.getElementById('combo-popup');

    if (count < 2) {
      if (panel) panel.style.display = 'none';
      return;
    }

    if (panel) {
      panel.style.display = '';
      panel.classList.remove('active');
      void panel.offsetWidth;
      panel.classList.add('active');
    }
    if (valueEl) valueEl.textContent = 'x' + count;

    let tier = null;
    for (let i = COMBO_TIERS.length - 1; i >= 0; i--) {
      if (count >= COMBO_TIERS[i].min) { tier = COMBO_TIERS[i]; break; }
    }

    if (popup && tier) {
      popup.textContent = tier.label;
      popup.className = 'combo-popup show ' + tier.cls;
      clearTimeout(popup._t);
      popup._t = setTimeout(() => { popup.className = 'combo-popup'; }, 1200);
    }
  }

  /* ═══════════════════════════════════
     FEATURE: GOAL SYSTEM — Metas colectivas
     ═══════════════════════════════════ */
  let totalGiftsForGoals = 0;
  let currentGoalIndex = 0;

  function loadGoals(goals) {
    if (!Array.isArray(goals) || goals.length === 0) return;
    goalsConfig = goals.sort((a, b) => a.target - b.target);
    currentGoalIndex = 0;
    totalGiftsForGoals = 0;
    showCurrentGoal();
  }

  function showCurrentGoal() {
    const panel = document.getElementById('goal-panel');
    const textEl = document.getElementById('goal-text');
    const barFill = document.getElementById('goal-bar-fill');
    const progressEl = document.getElementById('goal-progress');

    if (currentGoalIndex >= goalsConfig.length) {
      // Todas las metas completadas
      if (panel) panel.style.display = 'none';
      return;
    }

    const goal = goalsConfig[currentGoalIndex];
    if (panel) panel.style.display = '';
    if (textEl) textEl.textContent = goal.label;
    updateGoalBar();
  }

  function updateGoalBar() {
    if (currentGoalIndex >= goalsConfig.length) return;
    const goal = goalsConfig[currentGoalIndex];
    const barFill = document.getElementById('goal-bar-fill');
    const progressEl = document.getElementById('goal-progress');
    const pct = Math.min(100, Math.round((totalGiftsForGoals / goal.target) * 100));
    if (barFill) barFill.style.width = pct + '%';
    if (progressEl) progressEl.textContent = totalGiftsForGoals + ' / ' + goal.target;
  }

  function registerGiftForGoal(count) {
    totalGiftsForGoals += (count || 1);
    updateGoalBar();

    if (currentGoalIndex >= goalsConfig.length) return;
    const goal = goalsConfig[currentGoalIndex];

    if (totalGiftsForGoals >= goal.target) {
      // Meta alcanzada
      const panel = document.getElementById('goal-panel');
      if (panel) {
        panel.classList.add('goal-complete');
        setTimeout(() => panel.classList.remove('goal-complete'), 600);
      }

      // Ejecutar reward
      executeGoalReward(goal);

      // Show milestone popup
      showMilestone('🎯 ¡META ALCANZADA! ' + goal.label);

      // Siguiente meta
      currentGoalIndex++;
      setTimeout(showCurrentGoal, 2000);
    }
  }

  function executeGoalReward(goal) {
    const engine = getEngine();
    if (!engine) return;
    const map = getCommandMap();
    const arr = map[goal.reward];
    if (arr) {
      const effectValue = (arr.length === 2 && arr[1] === null) ? 100 : arr[1];
      if (arr.length === 1) engine.applyEffect(arr[0]);
      else engine.applyEffect(arr[0], effectValue);
    }
    // Fallback para super event
    if (goal.reward === 'SUPER_EVENT') {
      engine.applyEffect('spawnFruits', 200);
      engine.applyEffect('shield', 15000);
      engine.applyEffect('bonus', 5000);
    }
  }

  /* ═══════════════════════════════════
     FEATURE: MILESTONE CELEBRATIONS (score milestones)
     ═══════════════════════════════════ */
  const SCORE_MILESTONES = [100, 250, 500, 1000, 2000, 5000, 10000];
  let lastMilestone = 0;

  function checkScoreMilestone(score) {
    for (let i = SCORE_MILESTONES.length - 1; i >= 0; i--) {
      if (score >= SCORE_MILESTONES[i] && SCORE_MILESTONES[i] > lastMilestone) {
        lastMilestone = SCORE_MILESTONES[i];
        showMilestone('🏆 ' + SCORE_MILESTONES[i] + ' PUNTOS!');
        break;
      }
    }
  }

  function showMilestone(text) {
    const el = document.getElementById('milestone-popup');
    if (!el) return;
    el.textContent = text;
    el.className = 'milestone-popup show';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'milestone-popup'; }, 2500);
  }

  /* ═══════════════════════════════════
     EFECTO ROJO — Solo al aumentar velocidad con regalos
     ═══════════════════════════════════ */
  const SPEED_BOOST_DURATION_MS = 2500;

  function showSpeedBoost() {
    const overlay = document.getElementById('speed-overlay');
    const text = document.getElementById('speed-text');
    const canvas = document.getElementById('game-canvas');
    if (overlay) overlay.classList.add('show');
    if (text) text.classList.add('show');
    if (canvas) canvas.classList.add('speed-glow');
    clearTimeout(showSpeedBoost._t);
    showSpeedBoost._t = setTimeout(() => {
      if (overlay) overlay.classList.remove('show');
      if (text) text.classList.remove('show');
      if (canvas) canvas.classList.remove('speed-glow');
    }, SPEED_BOOST_DURATION_MS);
  }

  /* ═══════════════════════════════════
     DONORS & GIFTS LOG
     ═══════════════════════════════════ */
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

  function loadDonorsAllTime() {
    try {
      var raw = localStorage.getItem(DONORS_STORAGE_KEY);
      donorsAllTime = raw ? JSON.parse(raw) : {};
    } catch (e) {
      donorsAllTime = {};
    }
  }

  function saveDonorsAllTime() {
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
    saveDonorsAllTime();
    renderDonors();
  }

  function renderDonors() {
    var list = document.getElementById('ingame-top5');
    var kingName = document.getElementById('ingame-king-name');
    var kingCount = document.getElementById('ingame-king-count');
    var top5Sorted = Object.entries(donorsSession)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 5);
    var kingSorted = Object.entries(donorsAllTime)
      .sort(function (a, b) { return b[1] - a[1]; });
    var king = kingSorted[0];
    if (list) {
      list.innerHTML = '';
      top5Sorted.forEach(function (entry, i) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="ingame-rank">' + (i + 1) + '.</span><span>' + escapeHtml(entry[0]) + '</span><span>' + entry[1] + '</span>';
        list.appendChild(li);
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

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /* ═══════════════════════════════════
     TIERED GIFT HANDLING — efecto proporcional al precio
     ═══════════════════════════════════ */
  function getGiftInfo(eventId, eventName) {
    const key = (eventName || eventId || '').trim();
    return giftsConfig.find(g => g.id === key || g.id === eventId) || null;
  }

  function getScaledValue(cmd, giftInfo) {
    // Escalar el valor del efecto según el tier/coins del regalo
    if (!giftInfo) return null;
    const tier = giftInfo.tier || 1;
    const coins = giftInfo.coins || 1;

    switch (cmd) {
      case 'SPAWN_FRUITS':
        return Math.max(5, Math.floor(coins * 0.5 + tier * 5));
      case 'BONUS_POINTS':
        return Math.max(50, coins * 5);
      case 'SHIELD':
        return 1000 + tier * 2000; // 3s, 5s, 7s
      default:
        return null;
    }
  }

  /* ═══════════════════════════════════
     COMMAND → EFFECT MAPPING (por juego)
     ═══════════════════════════════════ */
  function commandToEffect(cmd, value, giftInfo) {
    const engine = getEngine();
    if (!engine) return;
    const map = getCommandMap();
    const arr = map[cmd];
    if (!arr) return;

    registerWarVote(cmd, 1);

    // Escalar valor basado en regalo (si no es un goal reward)
    let effectValue;
    const scaled = giftInfo ? getScaledValue(cmd, giftInfo) : null;
    if (scaled !== null) {
      effectValue = scaled;
    } else if (arr.length === 2 && arr[1] === null) {
      effectValue = (value != null ? value : 100);
    } else {
      effectValue = arr[1];
    }

    if (arr.length === 1) {
      engine.applyEffect(arr[0]);
    } else {
      engine.applyEffect(arr[0], effectValue);
    }
  }

  /* ═══════════════════════════════════
     WEBSOCKET CONNECTION (con backoff)
     ═══════════════════════════════════ */
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        console.log('[Arcade] WebSocket conectado al Control Server');
        reconnectDelay = 1000; // Reset backoff on success
      };
      ws.onmessage = (msgEv) => {
        try {
          const msg = JSON.parse(msgEv.data);
          if (msg.type === 'giftsConfig' && msg.gifts) {
            applyGiftsConfig(msg.gifts);
            if (msg.goals) loadGoals(msg.goals);
          }
          if (msg.type === 'config' && msg.config) applyConfig(msg.config);
          if (msg.cmd) {
            const gi = msg.giftInfo || null;
            commandToEffect(msg.cmd, msg.value, gi);
            if (msg.cmd === 'SPEED_UP') showSpeedBoost();
          }
          if (msg.effect) {
            const engine = getEngine();
            if (engine) engine.applyEffect(msg.effect, msg.value);
          }
          if (msg.type === 'event' && msg.event) {
            var ev = msg.event;
            appendGiftLog(ev);
            var el = document.getElementById('ingame-donor');
            if (el) el.textContent = ev.user || '—';
            addDonation(ev.user, typeof ev.count === 'number' ? ev.count : 1);

            // Combo system
            registerCombo();

            // Goal system
            registerGiftForGoal(typeof ev.count === 'number' ? ev.count : 1);

            // Gift animation
            const giftInfo = getGiftInfo(ev.id, ev.name);
            const emoji = giftInfo ? giftInfo.emoji : (ev.emoji || '🎁');
            const tier = giftInfo ? (giftInfo.tier || 1) : 1;
            spawnGiftAnimation(emoji, ev.user, tier);

            // Alert bar
            var alertEl = document.getElementById('ingame-alert');
            if (alertEl) {
              var comboTag = comboCount >= 2 ? ' 🔥x' + comboCount : '';
              alertEl.textContent = (emoji || '') + ' ' + (ev.name || ev.id) + (ev.user ? ' — @' + ev.user : '') + comboTag;
              alertEl.classList.add('show');
              clearTimeout(alertEl._t);
              alertEl._t = setTimeout(function () { alertEl.classList.remove('show'); }, 2500);
            }
          }
        } catch (e) {
          console.warn('[Arcade] Mensaje no JSON:', msgEv.data);
        }
      };
      ws.onclose = () => {
        ws = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15000); // Backoff up to 15s
        reconnectTimer = setTimeout(connect, reconnectDelay);
      };
      ws.onerror = () => {};
    } catch (e) {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
      reconnectTimer = setTimeout(connect, reconnectDelay);
    }
  }

  function applyConfig(cfg) {
    try {
      if (!cfg || typeof cfg !== 'object') return;
      if (typeof global.ArcadeAudio === 'undefined') return;
      if (cfg.sfxPreset) global.ArcadeAudio.setSfxPreset(cfg.sfxPreset);
      if (typeof cfg.sfxVolume === 'number') global.ArcadeAudio.setSfxVolume(cfg.sfxVolume);
      if (typeof cfg.bgMusicVolume === 'number') global.ArcadeAudio.setBgMusicVolume(cfg.bgMusicVolume);
      if (cfg.startBgMusic) global.ArcadeAudio.startBgMusic();
      console.log('[Arcade] Config aplicada:', cfg);
    } catch (e) {}
  }

  /* ═══════════════════════════════════
     CALL-TO-ACTION FIJO (desde giftsConfig)
     ═══════════════════════════════════ */
  function initCTA(gifts) {
    if (!Array.isArray(gifts) || gifts.length === 0) return;
    const el = document.getElementById('cta-content');
    if (!el) return;
    const destroy = gifts.filter(g => g.team === 'destroy');
    const help = gifts.filter(g => g.team === 'help');
    let html = '';
    if (destroy.length) {
      html += '<div class="cta-row">';
      destroy.forEach(g => {
        const tierTag = g.tier >= 3 ? '⭐' : '';
        html += '<span class="cta-item cta-destroy">' + (g.emoji || '') + ' ' + (g.id || '') + ' = ' + (g.label || g.command) + tierTag + '</span>';
      });
      html += '</div>';
    }
    if (help.length) {
      html += '<div class="cta-row">';
      help.forEach(g => {
        const tierTag = g.tier >= 3 ? '⭐' : '';
        html += '<span class="cta-item cta-help">' + (g.emoji || '') + ' ' + (g.id || '') + ' = ' + (g.label || g.command) + tierTag + '</span>';
      });
      html += '</div>';
    }
    el.innerHTML = html || '';
  }

  /* ═══════════════════════════════════
     INIT — Soporta Snake y Tetris
     ═══════════════════════════════════ */
  function init() {
    if (typeof global.ArcadeAudio !== 'undefined') {
      global.ArcadeAudio.resume();
      global.ArcadeAudio.startBgMusic();
    }
    document.addEventListener('click', function startMusicOnce() {
      if (typeof global.ArcadeAudio !== 'undefined') global.ArcadeAudio.startBgMusic();
      document.removeEventListener('click', startMusicOnce);
    }, { once: true });

    const engine = getEngine();
    const bot = getBot();
    if (!engine || !bot) {
      setTimeout(init, 100);
      return;
    }

    bot.setEngine(engine);
    bot.start(100);

    // Effect listener — SFX + visuals
    engine.onEffect((type, value) => {
      if (typeof global.ArcadeAudio !== 'undefined') global.ArcadeAudio.play(type);
      if (type === 'eat' || type === 'clearLine') {
        const container = document.getElementById('shake-container');
        if (container) {
          container.classList.remove('shake-eat');
          void container.offsetWidth;
          container.classList.add('shake-eat');
          setTimeout(() => container.classList.remove('shake-eat'), 150);
        }
      }
      if (type === 'newRecord') {
        const overlay = document.getElementById('newrecord-overlay');
        const scoreEl = document.getElementById('newrecord-score');
        if (overlay && scoreEl) {
          scoreEl.textContent = value != null ? value : '';
          overlay.classList.add('show');
          setTimeout(() => overlay.classList.remove('show'), 2000);
        }
      }
      if (type === 'death' && document.getElementById('death-flash')) {
        const el = document.getElementById('death-flash');
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 400);
        // Reset milestones on death
        lastMilestone = 0;
      }
      if (type === 'invert' || type === 'nuke' || type === 'garbage') {
        const container = document.getElementById('shake-container');
        if (container) {
          container.classList.add('shake');
          setTimeout(() => container.classList.remove('shake'), 400);
        }
      }
    });

    global.onGameDeath = () => {
      const countdownEl = document.getElementById('countdown-overlay');
      const countdownNum = document.getElementById('countdown-number');
      const currentEngine = getEngine();
      if (countdownEl && countdownNum && currentEngine) {
        countdownEl.classList.add('show');
        const show = (n) => {
          countdownNum.textContent = n;
          countdownNum.style.animation = 'none';
          void countdownNum.offsetWidth;
          countdownNum.style.animation = 'countdownPop 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
        };
        show(3);
        setTimeout(() => show(2), 1000);
        setTimeout(() => show(1), 2000);
        setTimeout(() => {
          countdownEl.classList.remove('show');
          currentEngine.resetGame();
        }, 3200);
      } else if (currentEngine) {
        setTimeout(() => currentEngine.resetGame(), 1500);
      }
    };
    global.onSnakeDeath = global.onGameDeath;
    global.onTetrisDeath = global.onGameDeath;
    global.onBreakoutDeath = global.onGameDeath;
    global.onPongDeath = global.onGameDeath;
    global.onFlappyDeath = global.onGameDeath;
    global.onDodgeDeath = global.onGameDeath;

    // Overlay update loop (score / highScore + milestones + Snake bot stats)
    function updateOverlay() {
      const state = engine.getState();
      if (!state) return;
      const se = document.getElementById('ingame-score');
      const re = document.getElementById('ingame-record');
      if (se) se.textContent = state.score;
      if (re) re.textContent = state.highScore;
      // Check score milestones
      checkScoreMilestone(state.score);
      // Snake Hamilton bot: longitud, % tablero, movimientos, modo
      if (global.SnakeEngine && engine === global.SnakeEngine && bot.getStats) {
        const stats = bot.getStats();
        const bl = document.getElementById('bot-length');
        const bf = document.getElementById('bot-fill');
        const bm = document.getElementById('bot-moves');
        const bml = document.getElementById('bot-mode-label');
        if (bl) bl.textContent = stats.length;
        if (bf) bf.textContent = stats.fillPercent.toFixed(1);
        if (bm) bm.textContent = stats.moveCount;
        if (bml) bml.textContent = bot.getShortcutsMode ? (bot.getShortcutsMode() ? 'Atajos' : 'Hamilton') : 'Atajos';
      }
    }
    setInterval(updateOverlay, 150);

    // Snake Hamilton bot: barra espaciadora = modo Atajos/Hamiltoniano; +/- = velocidad
    if (global.SnakeEngine && engine === global.SnakeEngine && bot.toggleShortcutsMode) {
      if (global.SHOW_HAMILTON_CYCLE == null) global.SHOW_HAMILTON_CYCLE = true;
      document.addEventListener('keydown', function snakeBotKeys(e) {
        if (e.key === ' ') {
          e.preventDefault();
          bot.toggleShortcutsMode();
        } else if (e.key === 'c' || e.key === 'C') {
          global.SHOW_HAMILTON_CYCLE = !global.SHOW_HAMILTON_CYCLE;
        } else if (e.key === '+' || e.key === '=') {
          if (engine.applyEffect) engine.applyEffect('speed', 1);
        } else if (e.key === '-') {
          if (engine.applyEffect) engine.applyEffect('slow', 1);
        }
      });
    }

    // War consequences check
    warCheckInterval = setInterval(checkWarConsequences, WAR_CHECK_MS);

    loadDonorsAllTime();
    renderDonors();
    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : global);
