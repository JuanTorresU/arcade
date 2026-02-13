/**
 * Flappy Engine — Arcade Bot Network
 */
(function (global) {
  'use strict';

  const WIDTH = 400;
  const HEIGHT = 600;
  const BIRD_SIZE = 30;
  const GRAVITY = 0.5;
  const JUMP_STRENGTH = -8;
  const PIPE_WIDTH = 60;
  const PIPE_GAP = 180;
  const PIPE_SPEED = 2;

  let canvas, ctx;
  let birdY = HEIGHT / 2;
  let birdVy = 0;
  let pipes = [];
  let score = 0;
  let highScore = 0;
  let gameOver = false;
  let invertGravity = false;
  let shieldUntil = 0;
  let hue = 165;
  let effectListeners = [];
  let justBrokeRecord = false;
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
    birdY = HEIGHT / 2;
    birdVy = 0;
    pipes = [];
    score = 0;
    gameOver = false;
    invertGravity = false;
    shieldUntil = 0;
    addPipe();
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
  }

  function addPipe() {
    const gapY = PIPE_GAP / 2 + Math.random() * (HEIGHT - PIPE_GAP);
    pipes.push({
      x: WIDTH,
      topHeight: gapY - PIPE_GAP / 2,
      bottomY: gapY + PIPE_GAP / 2,
      passed: false
    });
  }

  function jump() {
    if (gameOver) return;
    birdVy = invertGravity ? -JUMP_STRENGTH : JUMP_STRENGTH;
    notifyEffect('eat', { points: 1 });
  }

  function tick() {
    if (gameOver) return;
    metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;

    const gravity = invertGravity ? -GRAVITY : GRAVITY;
    birdVy += gravity;
    birdY += birdVy;

    if (birdY < BIRD_SIZE / 2 || birdY > HEIGHT - BIRD_SIZE / 2) {
      if (shieldUntil <= Date.now()) {
        gameOver = true;
        metrics.deaths++;
        notifyEffect('death', { score });
        if (typeof global.onFlappyDeath === 'function') global.onFlappyDeath();
      } else {
        birdY = Math.max(BIRD_SIZE / 2, Math.min(HEIGHT - BIRD_SIZE / 2, birdY));
        birdVy = 0;
      }
    }

    for (let pipe of pipes) {
      pipe.x -= PIPE_SPEED;

      if (!pipe.passed && pipe.x + PIPE_WIDTH < WIDTH / 2 - BIRD_SIZE / 2) {
        pipe.passed = true;
        score++;
        notifyEffect('eat', { points: 10 });
        hue = (hue + 20) % 360;
      }

      if (pipe.x + PIPE_WIDTH < 0) {
        pipes.shift();
        continue;
      }

      if (pipe.x < WIDTH / 2 + BIRD_SIZE / 2 && pipe.x + PIPE_WIDTH > WIDTH / 2 - BIRD_SIZE / 2) {
        if (birdY - BIRD_SIZE / 2 < pipe.topHeight || birdY + BIRD_SIZE / 2 > pipe.bottomY) {
          if (shieldUntil <= Date.now()) {
            gameOver = true;
            metrics.deaths++;
            notifyEffect('death', { score });
            if (typeof global.onFlappyDeath === 'function') global.onFlappyDeath();
          }
        }
      }
    }

    if (pipes.length === 0 || pipes[pipes.length - 1].x < WIDTH - 200) {
      addPipe();
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

    pipes.forEach(pipe => {
      const h = (hue + 120) % 360;
      ctx.fillStyle = `hsl(${h}, 100%, 55%)`;
      ctx.shadowColor = `hsl(${h}, 100%, 70%)`;
      ctx.shadowBlur = 8;
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
      ctx.fillRect(pipe.x, pipe.bottomY, PIPE_WIDTH, HEIGHT - pipe.bottomY);
    });
    ctx.shadowBlur = 0;

    const birdHue = shieldUntil > Date.now() ? 180 : (hue + 60) % 360;
    ctx.fillStyle = `hsl(${birdHue}, 100%, 55%)`;
    ctx.shadowColor = `hsl(${birdHue}, 100%, 70%)`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, birdY, BIRD_SIZE / 2, 0, Math.PI * 2);
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
        // Más rápido pero no afecta gravedad directamente
        notifyEffect('speed', null);
        break;
      case 'slow':
        notifyEffect('slow', null);
        break;
      case 'kill':
        if (shieldUntil <= Date.now()) {
          gameOver = true;
          metrics.deaths++;
          notifyEffect('death', { score });
          if (typeof global.onFlappyDeath === 'function') global.onFlappyDeath();
        }
        break;
      case 'invert':
        invertGravity = true;
        notifyEffect('invert', true);
        setTimeout(() => {
          invertGravity = false;
          notifyEffect('invert', false);
        }, typeof v === 'number' ? v : 5000);
        break;
      case 'chaos':
        applyEffect('invert', 6000);
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
      birdY,
      birdVy,
      nextPipe: pipes[0] || null,
      invertGravity,
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
    jump
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.FlappyEngine = api;
})(typeof window !== 'undefined' ? window : global);
