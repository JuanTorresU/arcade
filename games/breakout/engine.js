/**
 * Breakout Engine — Arcade Bot Network
 * API: applyEffect(type, value), getState(), onEffect(fn), resetGame()
 */
(function (global) {
  'use strict';

  const WIDTH = 600;
  const HEIGHT = 400;
  const PADDLE_WIDTH = 100;
  const PADDLE_HEIGHT = 15;
  const BALL_RADIUS = 8;
  const BRICK_ROWS = 5;
  const BRICK_COLS = 10;
  const BRICK_WIDTH = 55;
  const BRICK_HEIGHT = 20;
  const BRICK_GAP = 5;

  let canvas, ctx;
  let paddleX = WIDTH / 2 - PADDLE_WIDTH / 2;
  let ballX = WIDTH / 2;
  let ballY = HEIGHT - 50;
  let ballVx = 3;
  let ballVy = -3;
  let bricks = [];
  let score = 0;
  let highScore = 0;
  let gameOver = false;
  let invertControls = false;
  let shieldUntil = 0;
  let paddleWidth = PADDLE_WIDTH;
  let hue = 165;
  let effectListeners = [];
  let justBrokeRecord = false;
  let metrics = { deaths: 0, timeAlive: 0, startTime: 0 };

  function initBricks() {
    bricks = [];
    const startX = (WIDTH - (BRICK_COLS * (BRICK_WIDTH + BRICK_GAP) - BRICK_GAP)) / 2;
    const startY = 50;
    for (let row = 0; row < BRICK_ROWS; row++) {
      for (let col = 0; col < BRICK_COLS; col++) {
        bricks.push({
          x: startX + col * (BRICK_WIDTH + BRICK_GAP),
          y: startY + row * (BRICK_HEIGHT + BRICK_GAP),
          broken: false,
          hue: (row * 60 + col * 10) % 360
        });
      }
    }
  }

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
    paddleX = WIDTH / 2 - PADDLE_WIDTH / 2;
    ballX = WIDTH / 2;
    ballY = HEIGHT - 50;
    ballVx = 3 + Math.random() * 2 - 1;
    ballVy = -3 - Math.random() * 2;
    paddleWidth = PADDLE_WIDTH;
    gameOver = false;
    invertControls = false;
    shieldUntil = 0;
    score = 0;
    initBricks();
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
  }

  function movePaddle(dx) {
    if (gameOver) return;
    const dir = invertControls ? -dx : dx;
    paddleX = Math.max(0, Math.min(WIDTH - paddleWidth, paddleX + dir * 5));
  }

  function tick() {
    if (gameOver) return;
    metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;

    ballX += ballVx;
    ballY += ballVy;

    if (ballX <= BALL_RADIUS || ballX >= WIDTH - BALL_RADIUS) {
      ballVx = -ballVx;
      ballX = Math.max(BALL_RADIUS, Math.min(WIDTH - BALL_RADIUS, ballX));
    }
    if (ballY <= BALL_RADIUS) {
      ballVy = -ballVy;
      ballY = BALL_RADIUS;
    }

    if (ballY >= HEIGHT - BALL_RADIUS - PADDLE_HEIGHT && ballY <= HEIGHT - BALL_RADIUS &&
        ballX >= paddleX - BALL_RADIUS && ballX <= paddleX + paddleWidth + BALL_RADIUS) {
      const hitPos = (ballX - paddleX) / paddleWidth;
      ballVy = -Math.abs(ballVy);
      ballVx = (hitPos - 0.5) * 8;
      notifyEffect('eat', { points: 10 });
    }

    if (ballY > HEIGHT) {
      if (shieldUntil <= Date.now()) {
        gameOver = true;
        metrics.deaths++;
        notifyEffect('death', { score });
        if (typeof global.onBreakoutDeath === 'function') global.onBreakoutDeath();
      } else {
        ballY = HEIGHT - 50;
        ballVy = -Math.abs(ballVy);
      }
    }

    for (let brick of bricks) {
      if (brick.broken) continue;
      if (ballX + BALL_RADIUS >= brick.x && ballX - BALL_RADIUS <= brick.x + BRICK_WIDTH &&
          ballY + BALL_RADIUS >= brick.y && ballY - BALL_RADIUS <= brick.y + BRICK_HEIGHT) {
        brick.broken = true;
        score += 10;
        ballVy = -ballVy;
        notifyEffect('eat', { points: 10 });
        hue = (hue + 15) % 360;
        if (bricks.every(b => b.broken)) {
          score += 500;
          initBricks();
          ballY = HEIGHT - 50;
          ballVy = -Math.abs(ballVy);
        }
        break;
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
    for (let y = 0; y <= HEIGHT; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }

    bricks.forEach(brick => {
      if (brick.broken) return;
      const h = (brick.hue + hue) % 360;
      ctx.fillStyle = `hsl(${h}, 100%, 55%)`;
      ctx.shadowColor = `hsl(${h}, 100%, 70%)`;
      ctx.shadowBlur = 8;
      ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
    });
    ctx.shadowBlur = 0;

    const paddleHue = shieldUntil > Date.now() ? 180 : (hue + 60) % 360;
    ctx.fillStyle = `hsl(${paddleHue}, 100%, 55%)`;
    ctx.shadowColor = `hsl(${paddleHue}, 100%, 70%)`;
    ctx.shadowBlur = 12;
    ctx.fillRect(paddleX, HEIGHT - PADDLE_HEIGHT - 5, paddleWidth, PADDLE_HEIGHT);
    ctx.shadowBlur = 0;

    ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
    ctx.shadowColor = `hsl(${hue}, 100%, 80%)`;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ballX, ballY, BALL_RADIUS, 0, Math.PI * 2);
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
        ballVx *= 1.2;
        ballVy *= 1.2;
        notifyEffect('speed', null);
        break;
      case 'slow':
        ballVx *= 0.8;
        ballVy *= 0.8;
        notifyEffect('slow', null);
        break;
      case 'kill':
        if (shieldUntil <= Date.now()) {
          gameOver = true;
          metrics.deaths++;
          notifyEffect('death', { score });
          if (typeof global.onBreakoutDeath === 'function') global.onBreakoutDeath();
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
        bricks.forEach(b => b.broken = true);
        score += bricks.length * 10;
        initBricks();
        notifyEffect('nuke', null);
        break;
      case 'chaos':
        applyEffect('invert', 6000);
        applyEffect('speed', 1);
        notifyEffect('chaos', null);
        break;
      case 'shield':
        shieldUntil = Date.now() + (typeof v === 'number' ? v : 5000);
        paddleWidth = PADDLE_WIDTH * 1.5;
        notifyEffect('shield', shieldUntil);
        setTimeout(() => {
          if (shieldUntil <= Date.now()) paddleWidth = PADDLE_WIDTH;
        }, typeof v === 'number' ? v : 5000);
        break;
      case 'bonus':
        score += (Number(v) || 100);
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
      paddleX,
      ballX,
      ballY,
      bricksLeft: bricks.filter(b => !b.broken).length,
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
    moveLeft: () => movePaddle(-1),
    moveRight: () => movePaddle(1)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.BreakoutEngine = api;
})(typeof window !== 'undefined' ? window : global);
