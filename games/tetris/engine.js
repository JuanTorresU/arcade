/**
 * Tetris Game Engine — Arcade Bot Network
 * Misma API que Snake: applyEffect(type, value), getState(), onEffect(fn), resetGame()
 * Estilo: HSL dinámico, glow, grid neón (compatible con overlay y Control Server).
 */
(function (global) {
  'use strict';

  const COLS = 10;
  const ROWS = 22;
  const VISIBLE_ROWS = 20;
  const CELL = 24;
  const DROP_BASE_MS = 700;
  const DROP_MIN_MS = 120;
  const POINTS_LINE = 100;
  const POINTS_TETRIS = 800;
  const LEVEL_LINES = 10;

  const SHAPES = [
    [[1, 1, 1, 1]], // I
    [[1, 1], [1, 1]], // O
    [[0, 1, 0], [1, 1, 1]], // T
    [[0, 1, 1], [1, 1, 0]], // S
    [[1, 1, 0], [0, 1, 1]], // Z
    [[1, 0, 0], [1, 1, 1]], // J
    [[0, 0, 1], [1, 1, 1]]  // L
  ];

  const SHAPE_HUES = [180, 45, 280, 120, 0, 220, 30];

  let canvas, ctx;
  let matrix = [];
  let currentPiece = null;
  let currentX = 0;
  let currentY = 0;
  let currentRotation = 0;
  let nextPiece = null;
  let score = 0;
  let highScore = 0;
  let level = 1;
  let lines = 0;
  let dropInterval = DROP_BASE_MS;
  let lastDrop = 0;
  let gameOver = false;
  let invertControls = false;
  let shieldUntil = 0;
  let hue = 165;
  let effectListeners = [];
  let justBrokeRecord = false;
  let dropSpeedScale = 0;
  let metrics = { deaths: 0, timeAlive: 0, startTime: 0 };

  function createMatrix(w, h) {
    const m = [];
    for (let y = 0; y < h; y++) {
      m.push(Array(w).fill(0));
    }
    return m;
  }

  function getShape(typeIndex, rotation) {
    const raw = SHAPES[typeIndex];
    if (!raw) return [[1]];
    let s = raw.map(row => [...row]);
    for (let r = 0; r < (rotation % 4); r++) {
      const rows = s[0].length;
      const cols = s.length;
      const next = createMatrix(rows, cols);
      for (let y = 0; y < cols; y++) {
        for (let x = 0; x < rows; x++) next[x][cols - 1 - y] = s[y][x];
      }
      s = next;
    }
    return s;
  }

  function collide(piece, px, py) {
    const shape = getShape(piece.type, piece.rotation);
    for (let dy = 0; dy < shape.length; dy++) {
      for (let dx = 0; dx < shape[0].length; dx++) {
        if (!shape[dy][dx]) continue;
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && matrix[ny][nx]) return true;
      }
    }
    return false;
  }

  function mergePiece(piece, px, py) {
    const shape = getShape(piece.type, piece.rotation);
    const type = piece.type;
    for (let dy = 0; dy < shape.length; dy++) {
      for (let dx = 0; dx < shape[0].length; dx++) {
        if (!shape[dy][dx]) continue;
        const ny = py + dy;
        const nx = px + dx;
        if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
          matrix[ny][nx] = type + 1;
        }
      }
    }
  }

  function clearFullLines() {
    let cleared = 0;
    let row = ROWS - 1;
    while (row >= 0) {
      if (matrix[row].every(c => c > 0)) {
        matrix.splice(row, 1);
        matrix.unshift(Array(COLS).fill(0));
        cleared++;
      } else {
        row--;
      }
    }
    if (cleared > 0) {
      const points = cleared === 4 ? POINTS_TETRIS * level : cleared * POINTS_LINE * level;
      score += points;
      lines += cleared;
      level = Math.floor(lines / LEVEL_LINES) + 1;
      dropInterval = Math.max(DROP_MIN_MS, DROP_BASE_MS - (level - 1) * 45);
      notifyEffect(cleared === 4 ? 'eat' : 'clearLine', { lines: cleared, points });
    }
    return cleared;
  }

  function spawnPiece() {
    const type = nextPiece !== null ? nextPiece : Math.floor(Math.random() * SHAPES.length);
    nextPiece = Math.floor(Math.random() * SHAPES.length);
    const shape = getShape(type, 0);
    const px = Math.floor((COLS - shape[0].length) / 2);
    const py = 0;
    if (collide({ type, rotation: 0 }, px, py)) {
      if (shieldUntil <= Date.now()) {
        gameOver = true;
        metrics.deaths++;
        notifyEffect('death', { score, timeAlive: metrics.timeAlive });
        if (typeof global.onTetrisDeath === 'function') global.onTetrisDeath();
      } else {
        applyEffect('clearLine', 1);
        return spawnPiece();
      }
      return;
    }
    currentPiece = { type, rotation: 0 };
    currentX = px;
    currentY = py;
  }

  function lockPiece() {
    if (!currentPiece) return;
    mergePiece(currentPiece, currentX, currentY);
    clearFullLines();
    currentPiece = null;
    const prevHigh = highScore;
    if (score > highScore) {
      highScore = score;
      if (prevHigh > 0) {
        justBrokeRecord = true;
        notifyEffect('newRecord', score);
      }
    }
    spawnPiece();
  }

  function moveLeft() {
    if (!currentPiece || gameOver) return;
    const dx = invertControls ? 1 : -1;
    if (!collide(currentPiece, currentX + dx, currentY)) currentX += dx;
  }

  function moveRight() {
    if (!currentPiece || gameOver) return;
    const dx = invertControls ? -1 : 1;
    if (!collide(currentPiece, currentX + dx, currentY)) currentX += dx;
  }

  function rotate() {
    if (!currentPiece || gameOver) return;
    const r = invertControls ? (currentPiece.rotation + 3) % 4 : (currentPiece.rotation + 1) % 4;
    if (!collide({ type: currentPiece.type, rotation: r }, currentX, currentY)) {
      currentPiece.rotation = r;
    }
  }

  function softDrop() {
    if (!currentPiece || gameOver) return;
    if (!collide(currentPiece, currentX, currentY + 1)) {
      currentY++;
      score += 1;
    } else {
      lockPiece();
    }
  }

  function hardDrop() {
    if (!currentPiece || gameOver) return;
    while (!collide(currentPiece, currentX, currentY + 1)) {
      currentY++;
      score += 2;
    }
    lockPiece();
  }

  function addGarbageLines(count) {
    const n = Math.min(Math.max(1, count || 1), 5);
    for (let g = 0; g < n; g++) {
      const hole = Math.floor(Math.random() * COLS);
      const row = Array(COLS).fill(8);
      row[hole] = 0;
      matrix.shift();
      matrix.push(row);
    }
    notifyEffect('garbage', n);
  }

  function clearOneLine() {
    for (let row = ROWS - 1; row >= 0; row--) {
      if (matrix[row].every(c => c > 0)) {
        matrix.splice(row, 1);
        matrix.unshift(Array(COLS).fill(0));
        notifyEffect('clearLine', 1);
        score += POINTS_LINE * level;
        lines++;
        return;
      }
    }
  }

  function init() {
    canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    const w = COLS * CELL;
    const h = VISIBLE_ROWS * CELL;
    canvas.width = w;
    canvas.height = h;
    resetGame();
    requestAnimationFrame(gameLoop);
  }

  function resetGame() {
    matrix = createMatrix(COLS, ROWS);
    currentPiece = null;
    nextPiece = null;
    score = 0;
    level = 1;
    lines = 0;
    dropInterval = DROP_BASE_MS;
    dropSpeedScale = 0;
    gameOver = false;
    invertControls = false;
    shieldUntil = 0;
    metrics.startTime = Date.now();
    metrics.timeAlive = 0;
    nextPiece = Math.floor(Math.random() * SHAPES.length);
    spawnPiece();
    lastDrop = performance.now();
  }

  function tick(now) {
    if (gameOver || !currentPiece) return;
    metrics.timeAlive = (Date.now() - metrics.startTime) / 1000;
    if (now - lastDrop >= dropInterval) {
      lastDrop = now;
      if (!collide(currentPiece, currentX, currentY + 1)) {
        currentY++;
      } else {
        lockPiece();
      }
    }
  }

  function drawGrid() {
    ctx.strokeStyle = 'rgba(0, 255, 180, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, VISIBLE_ROWS * CELL);
      ctx.stroke();
    }
    for (let y = 0; y <= VISIBLE_ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(COLS * CELL, y * CELL);
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBlock(px, py, typeIndex, alpha, glow) {
    const idx = typeIndex >= 0 && typeIndex < SHAPE_HUES.length ? typeIndex : 0;
    const h = (SHAPE_HUES[idx] + hue) % 360;
    ctx.fillStyle = `hsla(${h}, 100%, 55%, ${alpha})`;
    if (glow) {
      ctx.shadowColor = `hsl(${h}, 100%, 70%)`;
      ctx.shadowBlur = 8;
    }
    roundRect(px * CELL + 1, py * CELL + 1, CELL - 2, CELL - 2, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function draw() {
    const now = performance.now();
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    const offsetY = ROWS - VISIBLE_ROWS;
    for (let y = 0; y < VISIBLE_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = matrix[y + offsetY] ? matrix[y + offsetY][x] : 0;
        if (cell > 0) drawBlock(x, y, (cell - 1) % SHAPE_HUES.length, 1, true);
      }
    }

    if (currentPiece) {
      const shape = getShape(currentPiece.type, currentPiece.rotation);
      let ghostY = currentY;
      while (!collide(currentPiece, currentX, ghostY + 1)) ghostY++;

      for (let dy = 0; dy < shape.length; dy++) {
        for (let dx = 0; dx < shape[0].length; dx++) {
          if (!shape[dy][dx]) continue;
          const gx = currentX + dx;
          const gy = ghostY + dy - offsetY;
          if (gy >= 0 && gy < VISIBLE_ROWS) {
            ctx.fillStyle = `hsla(${(SHAPE_HUES[currentPiece.type] + hue) % 360}, 80%, 50%, 0.25)`;
            ctx.strokeStyle = `hsla(${(SHAPE_HUES[currentPiece.type] + hue) % 360}, 100%, 70%, 0.5)`;
            ctx.lineWidth = 1;
            roundRect(gx * CELL + 2, gy * CELL + 2, CELL - 4, CELL - 4, 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      for (let dy = 0; dy < shape.length; dy++) {
        for (let dx = 0; dx < shape[0].length; dx++) {
          if (!shape[dy][dx]) continue;
          const px = currentX + dx;
          const py = currentY + dy - offsetY;
          if (py >= 0 && py < VISIBLE_ROWS) drawBlock(px, py, currentPiece.type, 1, true);
        }
      }
    }
  }

  function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    if (!canvas || !ctx) return;
    tick(now);
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
        dropSpeedScale += Number(v) || 1;
        dropInterval = Math.max(DROP_MIN_MS, dropInterval - 80);
        notifyEffect('speed', dropInterval);
        break;
      case 'slow':
        dropInterval = Math.min(DROP_BASE_MS, dropInterval + 100);
        notifyEffect('slow', dropInterval);
        break;
      case 'kill':
        if (shieldUntil <= Date.now()) {
          gameOver = true;
          metrics.deaths++;
          notifyEffect('death', { score });
          if (typeof global.onTetrisDeath === 'function') global.onTetrisDeath();
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
      case 'garbage':
        addGarbageLines(typeof v === 'number' ? v : 2);
        break;
      case 'chaos':
        applyEffect('invert', 6000);
        applyEffect('speed', 2);
        notifyEffect('chaos', null);
        break;
      case 'shield':
        shieldUntil = Date.now() + (typeof v === 'number' ? v : 5000);
        notifyEffect('shield', shieldUntil);
        break;
      case 'bonus':
        score += (Number(v) || 100);
        notifyEffect('bonus', score);
        break;
      case 'reset':
        resetGame();
        notifyEffect('reset', null);
        break;
      case 'clearLine':
        for (let i = 0; i < (Number(v) || 1); i++) clearOneLine();
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
      matrix: matrix.map(row => row.slice()),
      currentPiece: currentPiece ? { type: currentPiece.type, rotation: currentPiece.rotation } : null,
      currentX,
      currentY,
      nextPiece,
      score,
      highScore,
      gameOver,
      level,
      lines,
      dropInterval,
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
    moveLeft,
    moveRight,
    rotate,
    hardDrop,
    softDrop
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.TetrisEngine = api;
})(typeof window !== 'undefined' ? window : global);
