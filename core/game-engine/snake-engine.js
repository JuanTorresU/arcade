/**
 * Snake Game Engine — Arcade Bot Network
 * API pública: applyEffect(type, value)
 * Mejoras: ojos, escamas, estela, shield visible, fruta dorada, partículas, toroide, velocidad por score.
 */
(function (global) {
  'use strict';

  const CELL = 20;
  const COLS = 28;
  const ROWS = 20;
  const TICK_BASE = 120;
  const TICK_MIN = 85;
  const TRAIL_LENGTH = 10;
  const GOLDEN_CHANCE = 0.08;
  const GOLDEN_POINTS = 50;

  let canvas, ctx;
  let snake = [];
  let foods = [];
  let dir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let score = 0;
  let highScore = 0;
  let tickMs = TICK_BASE;
  let lastTick = 0;
  let gameOver = false;
  let invertControls = false;
  let shieldUntil = 0;
  let hue = 165;
  let metrics = { deaths: 0, timeAlive: 0, startTime: 0, gifts: 0, users: new Set() };
  let effectListeners = [];
  let trail = [];
  let particles = [];
  let floatingNumbers = [];
  let justBrokeRecord = false;
  let tickMsScale = 0;

  const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  function init() {
    canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    const w = COLS * CELL;
    const h = ROWS * CELL;
    canvas.width = w;
    canvas.height = h;
    resetGame();
    requestAnimationFrame(gameLoop);
  }

  function resetGame() {
    const midX = Math.floor(COLS / 2);
    const midY = Math.floor(ROWS / 2);
    snake = [
      { x: midX, y: midY },
      { x: midX - 1, y: midY },
      { x: midX - 2, y: midY }
    ];
    foods = [];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    tickMs = TICK_BASE;
    tickMsScale = 0;
    gameOver = false;
    invertControls = false;
    shieldUntil = 0;
    trail = [];
    particles = [];
    floatingNumbers = [];
    justBrokeRecord = false;
    spawnFood();
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
  }

  function getFreeCells() {
    const free = [];
    const occupied = new Set(snake.map(s => s.x + ',' + s.y));
    foods.forEach(f => occupied.add(f.x + ',' + f.y));
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!occupied.has(x + ',' + y)) free.push({ x, y });
      }
    }
    return free;
  }

  function spawnFood() {
    const free = getFreeCells();
    if (free.length) {
      const idx = Math.floor(Math.random() * free.length);
      const f = free[idx];
      const type = Math.random() < GOLDEN_CHANCE ? 'golden' : 'normal';
      foods.push({ x: f.x, y: f.y, type: type });
    }
  }

  function spawnManyFruits(count) {
    const free = getFreeCells();
    const n = Math.min(count, free.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * free.length);
      const f = free[idx];
      foods.push({ x: f.x, y: f.y, type: 'normal' });
      free.splice(idx, 1);
    }
    notifyEffect('spawnFruits', n);
  }

  function spawnEatParticles(cx, cy, hueF) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 1.5 + Math.random() * 1.5;
      particles.push({
        x: cx * CELL + CELL / 2,
        y: cy * CELL + CELL / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        hue: hueF
      });
    }
  }

  function spawnFloatingNumber(cx, cy, text) {
    floatingNumbers.push({
      x: cx * CELL + CELL / 2,
      y: cy * CELL + CELL / 2,
      text: '+' + text,
      life: 1
    });
  }

  function setDirection(d) {
    const dKey = typeof d === 'string' ? d : null;
    if (dKey && DIRECTIONS[dKey]) nextDir = { ...DIRECTIONS[dKey] };
    else if (d && typeof d.x === 'number' && typeof d.y === 'number') nextDir = { ...d };
  }

  function tick() {
    if (gameOver) return;
    dir = { ...nextDir };
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      if (shieldUntil > Date.now()) return;
      die();
      return;
    }
    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      if (shieldUntil > Date.now()) return;
      die();
      return;
    }

    trail.push({ x: snake[0].x, y: snake[0].y });
    if (trail.length > TRAIL_LENGTH) trail.shift();

    snake.unshift(head);
    const eatenIdx = foods.findIndex(f => f.x === head.x && f.y === head.y);
    if (eatenIdx >= 0) {
      const eaten = foods[eatenIdx];
      const points = eaten.type === 'golden' ? GOLDEN_POINTS : 10;
      const hueF = eaten.type === 'golden' ? 45 : (hue + 60) % 360;
      spawnEatParticles(head.x, head.y, hueF);
      spawnFloatingNumber(head.x, head.y, points);
      foods.splice(eatenIdx, 1);
      score += points;
      hue = (hue + 25) % 360;
      notifyEffect('eat', { points });
      spawnFood();
      // Velocidad por score: cada 50 pts un poco más rápido
      const newScale = Math.floor(score / 50) * 3;
      if (newScale > tickMsScale) {
        tickMsScale = newScale;
        tickMs = Math.max(TICK_MIN, tickMs - 3);
      }
    } else {
      snake.pop();
    }

    metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;
    const prevHigh = highScore;
    if (score > highScore) highScore = score;
    if (score > prevHigh && prevHigh > 0) {
      justBrokeRecord = true;
      notifyEffect('newRecord', score);
    }
  }

  function die() {
    metrics.deaths++;
    gameOver = true;
    notifyEffect('death', { score, timeAlive: metrics.timeAlive });
    if (typeof global.onSnakeDeath === 'function') global.onSnakeDeath();
  }

  function drawGrid() {
    ctx.strokeStyle = 'rgba(0, 255, 180, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(COLS * CELL, y * CELL);
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTrail(now) {
    trail.forEach((p, i) => {
      const t = i / Math.max(trail.length, 1);
      const alpha = t * 0.25;
      const r = (CELL / 2) * (0.3 + t * 0.5);
      ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawSnake(now) {
    const inv = invertControls ? 1 : 0;
    const shieldOn = shieldUntil > Date.now();
    const radius = 4;

    snake.forEach((seg, i) => {
      const t = i / Math.max(snake.length, 1);
      const segHue = (hue + t * 60 + inv * 180) % 360;
      const x = seg.x * CELL + 1;
      const y = seg.y * CELL + 1;
      const sz = CELL - 2;
      ctx.fillStyle = `hsl(${segHue}, 100%, 55%)`;
      ctx.shadowColor = `hsl(${segHue}, 100%, 70%)`;
      ctx.shadowBlur = 8;
      roundRect(x, y, sz, sz, radius);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (i > 0) {
        ctx.strokeStyle = `hsla(0,0%,100%,0.25)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x + sz / 2, y + sz / 2, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    const h = snake[0];
    const hx = h.x * CELL + 2;
    const hy = h.y * CELL + 2;
    const hsz = CELL - 4;
    ctx.fillStyle = `hsl(${hue}, 100%, 75%)`;
    ctx.shadowColor = `hsl(${hue}, 100%, 80%)`;
    ctx.shadowBlur = 12;
    roundRect(hx, hy, hsz, hsz, radius);
    ctx.fill();
    ctx.shadowBlur = 0;

    const eyeR = 3;
    const cx = h.x * CELL + CELL / 2;
    const cy = h.y * CELL + CELL / 2;
    const dx = dir.x;
    const dy = dir.y;
    let ex1, ey1, ex2, ey2, px1, py1, px2, py2;
    if (dx !== 0) {
      ex1 = cx + dx * 5;
      ey1 = cy - 3;
      ex2 = cx + dx * 5;
      ey2 = cy + 3;
      px1 = ex1 + dx * 1.5;
      py1 = ey1;
      px2 = ex2 + dx * 1.5;
      py2 = ey2;
    } else {
      ex1 = cx - 3;
      ey1 = cy + dy * 5;
      ex2 = cx + 3;
      ey2 = cy + dy * 5;
      px1 = ex1;
      py1 = ey1 + dy * 1.5;
      px2 = ex2;
      py2 = ey2 + dy * 1.5;
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2);
    ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(px1, py1, 1.5, 0, Math.PI * 2);
    ctx.arc(px2, py2, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (shieldOn) {
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 12;
      snake.forEach(seg => {
        const sx = seg.x * CELL + CELL / 2;
        const sy = seg.y * CELL + CELL / 2;
        ctx.beginPath();
        ctx.arc(sx, sy, CELL / 2 - 1, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    }
  }

  function drawFood(now) {
    const pulse = 1 + Math.sin(now / 180) * 0.08;
    foods.forEach((f, i) => {
      const isGolden = f.type === 'golden';
      const hueF = isGolden ? 45 : (45 + i * 30) % 360;
      const sat = isGolden ? 100 : 100;
      const light = isGolden ? 55 : 55;
      const cx = f.x * CELL + CELL / 2;
      const cy = f.y * CELL + CELL / 2;
      const r = (CELL / 2 - 2) * pulse;
      ctx.fillStyle = 'hsl(' + hueF + ',' + sat + '%,' + light + '%)';
      ctx.shadowColor = isGolden ? '#ffd700' : 'hsl(' + hueF + ', 100%, 70%)';
      ctx.shadowBlur = isGolden ? 14 : 8;
      if (isGolden) {
        ctx.beginPath();
        for (let s = 0; s < 5; s++) {
          const a = (s / 5) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.shadowBlur = 0;
  }

  function updateAndDrawParticles(now, dt) {
    const toRemove = [];
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt * 3;
      if (p.life <= 0) toRemove.push(i);
      else {
        ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.life})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    toRemove.reverse().forEach(i => particles.splice(i, 1));
  }

  function updateAndDrawFloatingNumbers(now, dt) {
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const toRemove = [];
    floatingNumbers.forEach((n, i) => {
      n.y -= 25 * dt;
      n.life -= dt * 2;
      if (n.life <= 0) toRemove.push(i);
      else {
        ctx.fillStyle = `rgba(255,255,255,${n.life})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeText(n.text, n.x, n.y);
        ctx.fillText(n.text, n.x, n.y);
      }
    });
    ctx.textAlign = 'left';
    toRemove.reverse().forEach(i => floatingNumbers.splice(i, 1));
  }

  function draw() {
    const now = performance.now();
    const dt = 1 / 60;
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawTrail(now);
    drawFood(now);
    drawSnake(now);
    updateAndDrawParticles(now, dt);
    updateAndDrawFloatingNumbers(now, dt);
  }

  function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    if (!canvas || !ctx) return;
    if (!gameOver && now - lastTick >= tickMs) {
      lastTick = now;
      tick();
    }
    draw();
  }

  function notifyEffect(type, value) {
    effectListeners.forEach(fn => {
      try { fn(type, value); } catch (e) { console.warn(e); }
    });
  }

  /**
   * API pública: aplicar efecto desde Control Server / overlay.
   * @param {string} type - speed | kill | invert | nuke | chaos | shield | bonus
   * @param {number|object} value - valor numérico o payload
   */
  function applyEffect(type, value) {
    const v = value != null ? value : 1;
    switch (type) {
      case 'speed':
        tickMs = Math.max(TICK_MIN, Math.min(200, tickMs - (Number(v) || 0) * 15));
        notifyEffect('speed', tickMs);
        break;
      case 'slow':
        tickMs = Math.max(TICK_MIN, Math.min(200, tickMs + (Number(v) || 0) * 20));
        notifyEffect('slow', tickMs);
        break;
      case 'kill':
        if (shieldUntil <= Date.now()) die();
        break;
      case 'invert':
        invertControls = true;
        notifyEffect('invert', true);
        setTimeout(() => {
          invertControls = false;
          notifyEffect('invert', false);
        }, typeof v === 'number' ? v : 5000);
        break;
      case 'nuke':
        if (snake.length > 3) {
          snake = snake.slice(0, 3);
          notifyEffect('nuke', null);
        }
        break;
      case 'chaos':
        applyEffect('invert', 4000);
        applyEffect('speed', 2);
        setTimeout(() => applyEffect('slow', 1), 3000);
        notifyEffect('chaos', null);
        break;
      case 'shield':
        shieldUntil = Date.now() + (typeof v === 'number' ? v : 3000);
        notifyEffect('shield', shieldUntil);
        break;
      case 'bonus':
        score += (Number(v) || 50);
        notifyEffect('bonus', score);
        break;
      case 'reset':
        resetGame();
        notifyEffect('reset', null);
        break;
      case 'spawnFruits':
        spawnManyFruits(Math.min(Number(v) || 500, 500));
        break;
      default:
        break;
    }
  }

  function onEffect(fn) {
    effectListeners.push(fn);
    return () => { effectListeners = effectListeners.filter(f => f !== fn); };
  }

  function getState() {
    const broke = justBrokeRecord;
    if (justBrokeRecord) justBrokeRecord = false;
    return {
      snake: snake.map(s => ({ ...s })),
      foods: foods.map(f => ({ ...f })),
      dir: { ...dir },
      score,
      highScore,
      gameOver,
      tickMs,
      invertControls,
      shieldActive: shieldUntil > Date.now(),
      justBrokeRecord: broke,
      metrics: {
        deaths: metrics.deaths,
        timeAlive: metrics.timeAlive,
        gifts: metrics.gifts,
        users: metrics.users.size
      }
    };
  }

  function getPublicAPI() {
    return {
      applyEffect,
      setDirection,
      getState,
      onEffect,
      resetGame: () => applyEffect('reset'),
      isGameOver: () => gameOver
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.SnakeEngine = getPublicAPI();
})(typeof window !== 'undefined' ? window : global);
