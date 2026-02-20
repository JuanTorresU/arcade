/**
 * Snake Game Engine — Arcade Bot Network
 * API pública: applyEffect(type, value)
 * Mejoras: cuerpo suave con degradado animado, ojos expresivos con parpadeo, lengua bífida,
 * escamas diamante, estela con glow, shield pulsante, respiración, partículas de movimiento,
 * fruta dorada, velocidad por score.
 */
(function (global) {
  'use strict';

  /* ---- Mode / Config ---- */
  let ENGINE_MODE = 'tiktok'; // 'tiktok' | 'ai'
  let CELL = 20;
  let COLS = 20;
  let ROWS = 20;
  const NORMAL_TICK_BASE = 110;
  let TICK_BASE = NORMAL_TICK_BASE;
  let TICK_MIN = 85;
  const TRAIL_LENGTH = 14;
  let GOLDEN_CHANCE = 0.08;
  const GOLDEN_POINTS = 50;
  let EFFECTS_ENABLED = true;

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
  let won = false;
  let invertControls = false;
  let shieldUntil = 0;
  let doubleScoreUntil = 0;
  let hue = 165;
  let metrics = { deaths: 0, timeAlive: 0, startTime: 0, gifts: 0, users: new Set() };
  let effectListeners = [];
  let beforeTickListeners = [];
  let trail = [];
  let particles = [];
  let floatingNumbers = [];
  let justBrokeRecord = false;
  let tickMsScale = 0;
  let speedMultiplier = 1;
  let blinkTimer = 0;
  let tongueTimer = 0;
  let initialFoodsRemaining = 0;

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
    won = false;
    invertControls = false;
    shieldUntil = 0;
    doubleScoreUntil = 0;
    trail = [];
    particles = [];
    floatingNumbers = [];
    blinkTimer = 0;
    tongueTimer = 0;
    justBrokeRecord = false;
    initialFoodsRemaining = spawnManyFruits(200);
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
    lastTick = performance.now();
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
      // En modo AI no hay golden food
      const type = (ENGINE_MODE === 'ai' || GOLDEN_CHANCE <= 0)
        ? 'normal'
        : (Math.random() < GOLDEN_CHANCE ? 'golden' : 'normal');
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
    return n;
  }

  function spawnEatParticles(cx, cy, hueF) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 1.5 + Math.random() * 2;
      particles.push({
        x: cx * CELL + CELL / 2,
        y: cy * CELL + CELL / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        hue: hueF,
        size: 2.5 + Math.random() * 1.5
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
    // Permite que el bot decida justo antes de avanzar un tick.
    for (let i = 0; i < beforeTickListeners.length; i++) {
      try { beforeTickListeners[i](); } catch (e) { console.warn(e); }
    }
    dir = { ...nextDir };
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const eatenIdx = foods.findIndex(f => f.x === head.x && f.y === head.y);
    const ateFood = eatenIdx >= 0;

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      if (shieldUntil > Date.now()) return;
      die();
      return;
    }
    const checkLen = (!ateFood) ? snake.length - 1 : snake.length;
    let hitBody = false;
    for (let i = 0; i < checkLen; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) {
        hitBody = true;
        break;
      }
    }
    if (hitBody) {
      if (shieldUntil > Date.now()) return;
      die();
      return;
    }

    trail.push({ x: snake[0].x, y: snake[0].y });
    if (trail.length > TRAIL_LENGTH) trail.shift();

    // Movement sparkles
    if (Math.random() < 0.4) {
      const tail = snake[snake.length - 1];
      particles.push({
        x: tail.x * CELL + CELL / 2 + (Math.random() - 0.5) * CELL,
        y: tail.y * CELL + CELL / 2 + (Math.random() - 0.5) * CELL,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        life: 0.5 + Math.random() * 0.3,
        hue: (hue + Math.random() * 60) % 360,
        size: 1.5
      });
    }

    snake.unshift(head);
    if (eatenIdx >= 0) {
      const eaten = foods[eatenIdx];
      const basePoints = ENGINE_MODE === 'ai' ? 1 : (eaten.type === 'golden' ? GOLDEN_POINTS : 10);
      const points = (ENGINE_MODE === 'ai' || doubleScoreUntil <= Date.now())
        ? basePoints
        : basePoints * 2;
      const hueF = eaten.type === 'golden' ? 45 : (hue + 60) % 360;
      spawnEatParticles(head.x, head.y, hueF);
      spawnFloatingNumber(head.x, head.y, points);
      foods.splice(eatenIdx, 1);
      score += points;
      hue = (hue + 25) % 360;
      notifyEffect('eat', { points });
      if (snake.length >= COLS * ROWS) {
        metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;
        won = true;
        gameOver = true;
        notifyEffect('win', { score, timeAlive: metrics.timeAlive });
        return;
      }
      if (initialFoodsRemaining > 0) {
        initialFoodsRemaining = Math.max(0, initialFoodsRemaining - 1);
      }
      if (initialFoodsRemaining <= 0) {
        spawnFood();
      }
      // Velocidad por score: cada 50 pts un poco más rápido
      if (EFFECTS_ENABLED) {
        const newScale = Math.floor(score / 50) * 3;
        if (newScale > tickMsScale) {
          tickMsScale = newScale;
          tickMs = Math.max(TICK_MIN, tickMs - 3);
        }
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
    won = false;
    gameOver = true;
    notifyEffect('death', { score, timeAlive: metrics.timeAlive });
    if (typeof global.onSnakeDeath === 'function') global.onSnakeDeath();
  }

  function drawWormholeBackground(now) {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.max(w, h) * 0.85;
    const phase = (now * 0.0004) % 1;

    const eyeRadius = 20;
    const dx = eyeRadius * Math.cos(now * 0.00032);
    const dy = eyeRadius * Math.sin(now * 0.00038);
    const centerX = cx + dx;
    const centerY = cy + dy;
    const pullK = 0.38;

    ctx.fillStyle = '#050308';
    ctx.fillRect(0, 0, w, h);

    const tunnelGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR);
    tunnelGrad.addColorStop(0, 'rgba(255, 252, 230, 0.09)');
    tunnelGrad.addColorStop(0.08, 'rgba(180, 220, 255, 0.065)');
    tunnelGrad.addColorStop(0.22, 'rgba(80, 140, 220, 0.048)');
    tunnelGrad.addColorStop(0.45, 'rgba(60, 50, 140, 0.032)');
    tunnelGrad.addColorStop(0.7, 'rgba(40, 20, 80, 0.02)');
    tunnelGrad.addColorStop(1, 'rgba(8, 5, 15, 0.35)');
    ctx.fillStyle = tunnelGrad;
    ctx.fillRect(0, 0, w, h);

    const numRings = 14;
    const radii = [];
    for (let i = 0; i < numRings; i++) {
      const depth = 1.2 + (i + phase) * 0.4;
      const r = maxR / depth;
      if (r < 6) continue;
      radii.push(r);
    }

    const waveAmp = 2.2 + 0.6 * Math.sin(now * 0.00012);
    const waveFreq = 5;
    const wavePhase = now * 0.00022;
    const pathSteps = 72;

    function wavyRingPath(rOuter, rInner) {
      ctx.beginPath();
      for (let s = 0; s <= pathSteps; s++) {
        const theta = (Math.PI * 2 * s) / pathSteps;
        const wave = waveAmp * Math.sin(waveFreq * theta + wavePhase);
        const pull = -pullK * (dx * Math.cos(theta) + dy * Math.sin(theta));
        const ro = rOuter + wave + pull;
        const x = centerX + ro * Math.cos(theta);
        const y = centerY + ro * Math.sin(theta);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      for (let s = pathSteps; s >= 0; s--) {
        const theta = (Math.PI * 2 * s) / pathSteps;
        const wave = waveAmp * Math.sin(waveFreq * theta + wavePhase);
        const pull = -pullK * (dx * Math.cos(theta) + dy * Math.sin(theta));
        const ri = Math.max(0, rInner + wave + pull);
        const x = centerX + ri * Math.cos(theta);
        const y = centerY + ri * Math.sin(theta);
        if (s === pathSteps) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    for (let i = 0; i < radii.length - 1; i++) {
      const rOuter = radii[i];
      const rInner = radii[i + 1];
      const t = 1 - (rOuter + rInner) / (2 * maxR);
      ctx.fillStyle = `rgba(160, 190, 230, ${0.006 + t * 0.015})`;
      wavyRingPath(rOuter, rInner);
      ctx.fill('evenodd');
    }

    const ringSoft = 2.5;
    radii.forEach((r, i) => {
      const t = 1 - r / maxR;
      const alpha = 0.025 + t * 0.045;
      ctx.fillStyle = `rgba(220, 235, 255, ${alpha * 0.85})`;
      wavyRingPath(r + ringSoft, Math.max(0, r - ringSoft));
      ctx.fill('evenodd');
    });

    const coreGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 70);
    coreGlow.addColorStop(0, 'rgba(255, 255, 240, 0.032)');
    coreGlow.addColorStop(0.3, 'rgba(255, 240, 200, 0.01)');
    coreGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGlow;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGrid(now) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 900);
    const alpha = 0.12 + pulse * 0.04;
    ctx.strokeStyle = `rgba(0, 255, 180, ${alpha})`;
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

  // Debug/Verificación: dibuja el ciclo Hamiltoniano (línea tenue entre celdas)
  function drawHamiltonianCycle() {
    if (!global.SHOW_HAMILTON_CYCLE) return;
    if (!global.SnakeBot || !global.SnakeBot.getCycleOrder) return;
    const order = global.SnakeBot.getCycleOrder();
    if (!order || order.length < 2) return;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      const x = p.x * CELL + CELL / 2;
      const y = p.y * CELL + CELL / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // Cerrar el ciclo (último → primero)
    const p0 = order[0];
    ctx.lineTo(p0.x * CELL + CELL / 2, p0.y * CELL + CELL / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrail(now) {
    const hueAnim = now / 18;
    for (let i = 0; i < trail.length; i++) {
      const t = i / Math.max(trail.length, 1);
      const alpha = t * 0.3;
      const r = (CELL / 2) * (0.15 + t * 0.55);
      const trailHue = (hueAnim + hue + (1 - t) * 80) % 360;
      const cx = trail[i].x * CELL + CELL / 2;
      const cy = trail[i].y * CELL + CELL / 2;
      // Outer glow layer
      ctx.fillStyle = `hsla(${trailHue}, 80%, 55%, ${alpha * 0.4})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      // Core layer
      ctx.fillStyle = `hsla(${trailHue}, 90%, 65%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSnake(now) {
    const shieldOn = shieldUntil > Date.now();
    const inv = invertControls ? 1 : 0;
    const breathe = 1 + Math.sin(now / 400) * 0.05;
    const hueAnim = now / 18;
    const len = snake.length;
    if (len === 0) return;

    const headR = (CELL / 2 - 1) * breathe;
    const tailR = Math.max(CELL / 5, 3);

    const pos = [];
    for (let i = 0; i < len; i++) {
      pos.push({
        x: snake[i].x * CELL + CELL / 2,
        y: snake[i].y * CELL + CELL / 2
      });
    }

    function segR(i) {
      return headR + (tailR - headR) * (i / Math.max(len - 1, 1));
    }
    function segH(i) {
      return (hueAnim + hue + (i / Math.max(len - 1, 1)) * 100 + inv * 180) % 360;
    }

    // ── Glow underlay ──
    for (let i = 0; i < len; i += 3) {
      ctx.fillStyle = `hsla(${segH(i)}, 100%, 60%, 0.12)`;
      ctx.beginPath();
      ctx.arc(pos[i].x, pos[i].y, segR(i) + 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Body connectors (tail → head, smooth rounded) ──
    ctx.lineCap = 'round';
    for (let i = len - 1; i >= 1; i--) {
      ctx.strokeStyle = `hsl(${segH(i)}, 90%, 55%)`;
      ctx.lineWidth = segR(i) + segR(i - 1);
      ctx.beginPath();
      ctx.moveTo(pos[i].x, pos[i].y);
      ctx.lineTo(pos[i - 1].x, pos[i - 1].y);
      ctx.stroke();
    }

    // ── Scale diamonds ──
    for (let i = 2; i < len; i += 2) {
      const r = segR(i);
      if (r < 4) continue;
      const sr = r * 0.3;
      ctx.fillStyle = `hsla(${(segH(i) + 40) % 360}, 100%, 80%, 0.18)`;
      ctx.beginPath();
      ctx.moveTo(pos[i].x, pos[i].y - sr);
      ctx.lineTo(pos[i].x + sr * 0.7, pos[i].y);
      ctx.lineTo(pos[i].x, pos[i].y + sr);
      ctx.lineTo(pos[i].x - sr * 0.7, pos[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // ── Head ──
    const hx = pos[0].x;
    const hy = pos[0].y;
    const headHue = segH(0);

    ctx.fillStyle = `hsl(${headHue}, 100%, 65%)`;
    ctx.shadowColor = `hsl(${headHue}, 100%, 75%)`;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(hx, hy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Head radial highlight
    const hGrad = ctx.createRadialGradient(hx - headR * 0.25, hy - headR * 0.25, 0, hx, hy, headR);
    hGrad.addColorStop(0, `hsla(${headHue}, 100%, 92%, 0.35)`);
    hGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.arc(hx, hy, headR, 0, Math.PI * 2);
    ctx.fill();

    // ── Tongue ──
    tongueTimer += 1 / 60;
    if (Math.sin(tongueTimer * 5) > 0.2) {
      const tLen = headR * 0.7 + Math.sin(tongueTimer * 14) * headR * 0.3;
      const tx = hx + dir.x * (headR + tLen);
      const ty = hy + dir.y * (headR + tLen);
      const fk = 2.5;
      const tpx = -dir.y;
      const tpy = dir.x;
      ctx.strokeStyle = '#ff3355';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx + dir.x * headR * 0.5, hy + dir.y * headR * 0.5);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + dir.x * fk + tpx * fk, ty + dir.y * fk + tpy * fk);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + dir.x * fk - tpx * fk, ty + dir.y * fk - tpy * fk);
      ctx.stroke();
    }

    // ── Eyes ──
    blinkTimer += 1 / 60;
    const isBlinking = (blinkTimer % 3.5) > 3.3;
    const eyeR = Math.max(headR * 0.32, 2.5);
    const epx = -dir.y;
    const epy = dir.x;
    const e1x = hx + dir.x * headR * 0.28 + epx * headR * 0.38;
    const e1y = hy + dir.y * headR * 0.28 + epy * headR * 0.38;
    const e2x = hx + dir.x * headR * 0.28 - epx * headR * 0.38;
    const e2y = hy + dir.y * headR * 0.28 - epy * headR * 0.38;

    if (!isBlinking) {
      // Sclera
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(255,255,255,0.3)';
      ctx.shadowBlur = 3;
      ctx.beginPath(); ctx.arc(e1x, e1y, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e2x, e2y, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Iris
      const iR = eyeR * 0.6;
      const iOx = dir.x * iR * 0.35;
      const iOy = dir.y * iR * 0.35;
      ctx.fillStyle = `hsl(${(headHue + 180) % 360}, 100%, 40%)`;
      ctx.beginPath(); ctx.arc(e1x + iOx, e1y + iOy, iR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e2x + iOx, e2y + iOy, iR, 0, Math.PI * 2); ctx.fill();
      // Pupil
      const pR = iR * 0.55;
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(e1x + iOx, e1y + iOy, pR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e2x + iOx, e2y + iOy, pR, 0, Math.PI * 2); ctx.fill();
      // Highlight sparkle
      const hlR = Math.max(pR * 0.45, 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(e1x + iOx - hlR, e1y + iOy - hlR, hlR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e2x + iOx - hlR, e2y + iOy - hlR, hlR, 0, Math.PI * 2); ctx.fill();
    } else {
      // Closed eyes (happy curves)
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(e1x, e1y, eyeR * 0.5, 0, Math.PI, false); ctx.stroke();
      ctx.beginPath(); ctx.arc(e2x, e2y, eyeR * 0.5, 0, Math.PI, false); ctx.stroke();
    }

    // ── Shield ──
    if (shieldOn) {
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 14;
      ctx.setLineDash([4, 3]);
      const sPulse = 1 + Math.sin(now / 150) * 0.08;
      for (let i = 0; i < len; i++) {
        ctx.beginPath();
        ctx.arc(pos[i].x, pos[i].y, (segR(i) + 3) * sPulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
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
        ctx.arc(p.x, p.y, p.size || 2, 0, Math.PI * 2);
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
    drawWormholeBackground(now);
    drawGrid(now);
    drawHamiltonianCycle();
    drawTrail(now);
    drawFood(now);
    drawSnake(now);
    updateAndDrawParticles(now, dt);
    updateAndDrawFloatingNumbers(now, dt);
  }

  function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    if (!canvas || !ctx) return;
    if (!gameOver) {
      const effectiveTickMs = Math.max(4, tickMs / speedMultiplier);
      let steps = Math.floor((now - lastTick) / effectiveTickMs);
      if (steps > 0) {
        // Evita espirales de CPU si la pestaña estuvo congelada.
        steps = Math.min(steps, 24);
        for (let i = 0; i < steps && !gameOver; i++) tick();
        lastTick += steps * effectiveTickMs;
        // Si hay mucho drift, resincroniza al frame actual.
        if (now - lastTick > effectiveTickMs * 2) lastTick = now;
      }
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
    // En modo AI, los efectos TikTok estan desactivados; speed/slow siempre permitidos (teclas +/-)
    if (!EFFECTS_ENABLED && type !== 'reset' && type !== 'speed' && type !== 'slow' && type !== 'speedMultiplier') return;
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
      case 'speedMultiplier': {
        const n = Number(v);
        speedMultiplier = Math.max(1, Math.min(20, isFinite(n) ? n : 1));
        notifyEffect('speedMultiplier', speedMultiplier);
        break;
      }
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
      case 'doubleScore':
        doubleScoreUntil = Date.now() + (typeof v === 'number' ? v : 30000);
        notifyEffect('doubleScore', doubleScoreUntil);
        break;
      default:
        break;
    }
  }

  function onEffect(fn) {
    effectListeners.push(fn);
    return () => { effectListeners = effectListeners.filter(f => f !== fn); };
  }

  function onBeforeTick(fn) {
    if (typeof fn !== 'function') return () => {};
    beforeTickListeners.push(fn);
    return () => { beforeTickListeners = beforeTickListeners.filter(f => f !== fn); };
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
      won,
      maxFoods: COLS * ROWS - 3,
      tickMs,
      speedMultiplier,
      invertControls,
      shieldActive: shieldUntil > Date.now(),
      doubleScoreActive: doubleScoreUntil > Date.now(),
      justBrokeRecord: broke,
      metrics: {
        deaths: metrics.deaths,
        timeAlive: metrics.timeAlive,
        gifts: metrics.gifts,
        users: metrics.users.size
      }
    };
  }

  /**
   * Cambiar modo del engine.
   * 'tiktok': 20x20, golden food, efectos ON
   * 'ai':     10x10, sin golden, efectos OFF, cell=40
   */
  function setMode(mode) {
    ENGINE_MODE = mode;
    if (mode === 'ai') {
      COLS = 10; ROWS = 10; CELL = 40;
      TICK_BASE = 120; TICK_MIN = 40;
      GOLDEN_CHANCE = 0;
      EFFECTS_ENABLED = false;
    } else if (mode === 'ai20') {
      COLS = 20; ROWS = 20; CELL = 20;
      TICK_BASE = 120; TICK_MIN = 40;
      GOLDEN_CHANCE = 0;
      EFFECTS_ENABLED = false;
    } else {
      COLS = 20; ROWS = 20; CELL = 20;
      TICK_BASE = NORMAL_TICK_BASE; TICK_MIN = 85;
      GOLDEN_CHANCE = 0.08;
      EFFECTS_ENABLED = true;
    }
    if (canvas) {
      canvas.width = COLS * CELL;
      canvas.height = ROWS * CELL;
    }
    resetGame();
  }

  /**
   * Estado del juego como tensor flat para la red neuronal.
   * Retorna Float32Array de tamaño 4 * ROWS * COLS (channels-first).
   * Canal 0: cuerpo, Canal 1: cabeza, Canal 2: comida, Canal 3: dirección.
   */
  function getAIState() {
    const size = ROWS * COLS;
    const state = new Float32Array(4 * size);

    // Canal 0: cuerpo (1 donde hay serpiente)
    for (let i = 0; i < snake.length; i++) {
      const s = snake[i];
      state[s.y * COLS + s.x] = 1.0;
    }

    // Canal 1: cabeza
    if (snake.length > 0) {
      const h = snake[0];
      state[size + h.y * COLS + h.x] = 1.0;
    }

    // Canal 2: comida
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      state[2 * size + f.y * COLS + f.x] = 1.0;
    }

    // Canal 3: dirección (valor constante normalizado)
    // UP=0.25, DOWN=0.5, LEFT=0.75, RIGHT=1.0
    let dirVal = 1.0; // default RIGHT
    if (dir.x === 0 && dir.y === -1) dirVal = 0.25;      // UP
    else if (dir.x === 0 && dir.y === 1) dirVal = 0.5;    // DOWN
    else if (dir.x === -1 && dir.y === 0) dirVal = 0.75;  // LEFT
    else if (dir.x === 1 && dir.y === 0) dirVal = 1.0;    // RIGHT
    for (let i = 0; i < size; i++) {
      state[3 * size + i] = dirVal;
    }

    return state;
  }

  function getPublicAPI() {
    return {
      applyEffect,
      setDirection,
      getState,
      getAIState,
      setMode,
      onEffect,
      onBeforeTick,
      resetGame: () => applyEffect('reset'),
      isGameOver: () => gameOver,
      getConfig: () => ({ mode: ENGINE_MODE, cols: COLS, rows: ROWS, cell: CELL })
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.SnakeEngine = getPublicAPI();
})(typeof window !== 'undefined' ? window : global);
