/**
 * Pong Engine — Arcade Bot Network
 */
(function (global) {
  'use strict';

  const WIDTH = 600;
  const HEIGHT = 400;
  const PADDLE_WIDTH = 15;
  const PADDLE_HEIGHT = 80;
  const BALL_RADIUS = 8;
  const PADDLE_SPEED = 4;

  let canvas, ctx;
  let paddle1Y = HEIGHT / 2 - PADDLE_HEIGHT / 2;
  let paddle2Y = HEIGHT / 2 - PADDLE_HEIGHT / 2;
  let ballX = WIDTH / 2;
  let ballY = HEIGHT / 2;
  let ballVx = 4;
  let ballVy = 3;
  let score1 = 0;
  let score2 = 0;
  let highScore = 0;
  let gameOver = false;
  let invertControls = false;
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
    paddle1Y = HEIGHT / 2 - PADDLE_HEIGHT / 2;
    paddle2Y = HEIGHT / 2 - PADDLE_HEIGHT / 2;
    ballX = WIDTH / 2;
    ballY = HEIGHT / 2;
    ballVx = (Math.random() > 0.5 ? 1 : -1) * 4;
    ballVy = (Math.random() * 2 - 1) * 3;
    gameOver = false;
    invertControls = false;
    shieldUntil = 0;
    score1 = 0;
    score2 = 0;
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
  }

  function movePaddle1(dy) {
    if (gameOver) return;
    const dir = invertControls ? -dy : dy;
    paddle1Y = Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, paddle1Y + dir * PADDLE_SPEED));
  }

  function movePaddle2(dy) {
    if (gameOver) return;
    paddle2Y = Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, paddle2Y + dy * PADDLE_SPEED));
  }

  function tick() {
    if (gameOver) return;
    metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;

    ballX += ballVx;
    ballY += ballVy;

    if (ballY <= BALL_RADIUS || ballY >= HEIGHT - BALL_RADIUS) {
      ballVy = -ballVy;
      ballY = Math.max(BALL_RADIUS, Math.min(HEIGHT - BALL_RADIUS, ballY));
    }

    if (ballX <= PADDLE_WIDTH + BALL_RADIUS && ballY >= paddle1Y && ballY <= paddle1Y + PADDLE_HEIGHT) {
      ballVx = Math.abs(ballVx);
      const hitPos = (ballY - paddle1Y) / PADDLE_HEIGHT;
      ballVy = (hitPos - 0.5) * 8;
      notifyEffect('eat', { points: 5 });
    }

    if (ballX >= WIDTH - PADDLE_WIDTH - BALL_RADIUS && ballY >= paddle2Y && ballY <= paddle2Y + PADDLE_HEIGHT) {
      ballVx = -Math.abs(ballVx);
      const hitPos = (ballY - paddle2Y) / PADDLE_HEIGHT;
      ballVy = (hitPos - 0.5) * 8;
      notifyEffect('eat', { points: 5 });
    }

    if (ballX < 0) {
      score2++;
      ballX = WIDTH / 2;
      ballY = HEIGHT / 2;
      ballVx = 4;
      ballVy = (Math.random() * 2 - 1) * 3;
      if (score2 >= 5) {
        gameOver = true;
        metrics.deaths++;
        notifyEffect('death', { score: score1 });
        if (typeof global.onPongDeath === 'function') global.onPongDeath();
      }
    }

    if (ballX > WIDTH) {
      score1++;
      ballX = WIDTH / 2;
      ballY = HEIGHT / 2;
      ballVx = -4;
      ballVy = (Math.random() * 2 - 1) * 3;
      const prevHigh = highScore;
      if (score1 > highScore) {
        highScore = score1;
        if (prevHigh > 0) {
          justBrokeRecord = true;
          notifyEffect('newRecord', score1);
        }
      }
    }
  }

  function draw() {
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = 'rgba(0, 255, 180, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 0);
    ctx.lineTo(WIDTH / 2, HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    const h1 = (hue + 60) % 360;
    const h2 = (hue + 180) % 360;
    ctx.fillStyle = `hsl(${h1}, 100%, 55%)`;
    ctx.shadowColor = `hsl(${h1}, 100%, 70%)`;
    ctx.shadowBlur = 12;
    ctx.fillRect(5, paddle1Y, PADDLE_WIDTH, PADDLE_HEIGHT);

    ctx.fillStyle = `hsl(${h2}, 100%, 55%)`;
    ctx.shadowColor = `hsl(${h2}, 100%, 70%)`;
    ctx.fillRect(WIDTH - PADDLE_WIDTH - 5, paddle2Y, PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.shadowBlur = 0;

    ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
    ctx.shadowColor = `hsl(${hue}, 100%, 80%)`;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ballX, ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = 'bold 32px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = `hsla(${h1}, 100%, 65%, 0.8)`;
    ctx.fillText(score1, WIDTH / 4, 50);
    ctx.fillStyle = `hsla(${h2}, 100%, 65%, 0.8)`;
    ctx.fillText(score2, WIDTH * 3 / 4, 50);
    ctx.textAlign = 'left';
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
        ballVx *= 1.3;
        ballVy *= 1.3;
        notifyEffect('speed', null);
        break;
      case 'slow':
        ballVx *= 0.7;
        ballVy *= 0.7;
        notifyEffect('slow', null);
        break;
      case 'kill':
        if (shieldUntil <= Date.now()) {
          gameOver = true;
          metrics.deaths++;
          notifyEffect('death', { score: score1 });
          if (typeof global.onPongDeath === 'function') global.onPongDeath();
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
        score1 += (Number(v) || 10);
        notifyEffect('bonus', score1);
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
      score: score1,
      highScore,
      gameOver,
      paddle1Y,
      paddle2Y,
      ballX,
      ballY,
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
    moveUp: () => movePaddle1(-1),
    moveDown: () => movePaddle1(1),
    movePaddle2: (dy) => movePaddle2(dy)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PongEngine = api;
})(typeof window !== 'undefined' ? window : global);
