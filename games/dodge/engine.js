/**
 * Dodge Engine — Arcade Bot Network
 */
(function (global) {
  'use strict';

  const WIDTH = 400;
  const HEIGHT = 600;
  const PLAYER_SIZE = 30;
  const OBSTACLE_SIZE = 40;
  const OBSTACLE_SPEED = 2;
  const SPAWN_RATE = 60;

  let canvas, ctx;
  let playerX = WIDTH / 2;
  let obstacles = [];
  let score = 0;
  let highScore = 0;
  let gameOver = false;
  let invertControls = false;
  let shieldUntil = 0;
  let hue = 165;
  let effectListeners = [];
  let justBrokeRecord = false;
  let spawnTimer = 0;
  let metrics = { deaths: 0, timeAlive: 0, startTime: 0 };

  function init() {
    canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    resetGame();
    requestAnimationFrame(gameLoop);
  }

  function resetGame() {
    playerX = WIDTH / 2;
    obstacles = [];
    score = 0;
    gameOver = false;
    invertControls = false;
    shieldUntil = 0;
    spawnTimer = 0;
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
  }

  function movePlayer(dx) {
    if (gameOver) return;
    const dir = invertControls ? -dx : dx;
    playerX = Math.max(PLAYER_SIZE / 2, Math.min(WIDTH - PLAYER_SIZE / 2, playerX + dir * 4));
  }

  function spawnObstacle() {
    obstacles.push({
      x: Math.random() * (WIDTH - OBSTACLE_SIZE) + OBSTACLE_SIZE / 2,
      y: -OBSTACLE_SIZE,
      size: OBSTACLE_SIZE + Math.random() * 20
    });
  }

  function tick() {
    if (gameOver) return;
    metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;

    spawnTimer++;
    if (spawnTimer >= SPAWN_RATE) {
      spawnTimer = 0;
      spawnObstacle();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      obs.y += OBSTACLE_SPEED;

      const dx = playerX - obs.x;
      const dy = HEIGHT - 50 - obs.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = PLAYER_SIZE / 2 + obs.size / 2;

      if (dist < minDist) {
        if (shieldUntil <= Date.now()) {
          gameOver = true;
          metrics.deaths++;
          notifyEffect('death', { score });
          if (typeof global.onDodgeDeath === 'function') global.onDodgeDeath();
        } else {
          obstacles.splice(i, 1);
          continue;
        }
      }

      if (obs.y > HEIGHT) {
        obstacles.splice(i, 1);
        score++;
        notifyEffect('eat', { points: 1 });
        hue = (hue + 5) % 360;
      }
    }

    const prevHigh = highScore;
    if (score > highScore) {
      highScore = score;
      if (prevHigh > 0) {
        justBrokeRecord = true;
        notifyEffect('newRecord', score);
      }
    }
  }

  function draw() {
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = 'rgba(0, 255, 180, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WIDTH; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
    }

    obstacles.forEach(obs => {
      const h = (hue + 180) % 360;
      ctx.fillStyle = `hsl(${h}, 100%, 55%)`;
      ctx.shadowColor = `hsl(${h}, 100%, 70%)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.size / 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    const playerHue = shieldUntil > Date.now() ? 180 : (hue + 60) % 360;
    ctx.fillStyle = `hsl(${playerHue}, 100%, 55%)`;
    ctx.shadowColor = `hsl(${playerHue}, 100%, 70%)`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(playerX, HEIGHT - 50, PLAYER_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function gameLoop() {
    requestAnimationFrame(gameLoop);
    if (!canvas || !ctx) return;
    tick();
    draw();
  }

  function notifyEffect(type, value) {
    effectListeners.forEach(fn => {
      try { fn(type, value); } catch (e) { console.warn(e); }
    });
  }

  function applyEffect(type, value) {
    const v = value != null ? value : 1;
    switch (type) {
      case 'speed':
        // Más obstáculos
        spawnTimer = Math.max(0, spawnTimer - 20);
        notifyEffect('speed', null);
        break;
      case 'slow':
        spawnTimer += 20;
        notifyEffect('slow', null);
        break;
      case 'kill':
        if (shieldUntil <= Date.now()) {
          gameOver = true;
          metrics.deaths++;
          notifyEffect('death', { score });
          if (typeof global.onDodgeDeath === 'function') global.onDodgeDeath();
        }
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
        obstacles = [];
        score += 10;
        notifyEffect('nuke', null);
        break;
      case 'chaos':
        applyEffect('invert', 6000);
        applyEffect('speed', 1);
        notifyEffect('chaos', null);
        break;
      case 'shield':
        shieldUntil = Date.now() + (typeof v === 'number' ? v : 5000);
        notifyEffect('shield', shieldUntil);
        break;
      case 'bonus':
        score += (Number(v) || 10);
        notifyEffect('bonus', score);
        break;
      case 'reset':
        resetGame();
        notifyEffect('reset', null);
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
      score,
      highScore,
      gameOver,
      playerX,
      obstacles: obstacles.map(o => ({ ...o })),
      invertControls,
      shieldActive: shieldUntil > Date.now(),
      justBrokeRecord: broke,
      metrics: {
        deaths: metrics.deaths,
        timeAlive: metrics.timeAlive
      }
    };
  }

  const api = {
    applyEffect,
    getState,
    onEffect,
    resetGame: () => applyEffect('reset'),
    isGameOver: () => gameOver,
    moveLeft: () => movePlayer(-1),
    moveRight: () => movePlayer(1)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.DodgeEngine = api;
})(typeof window !== 'undefined' ? window : global);
