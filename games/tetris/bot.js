/**
 * Tetris Bot — Autoplayer con heurística simple.
 * Elige mejor posición y rotación para cada pieza (altura, líneas, centro).
 * Misma interfaz que SnakeBot: setEngine(api), start(ms), stop().
 */
(function (global) {
  'use strict';

  const COLS = 10;
  const ROWS = 22;
  const SHAPES = [
    [[1, 1, 1, 1]],
    [[1, 1], [1, 1]],
    [[0, 1, 0], [1, 1, 1]],
    [[0, 1, 1], [1, 1, 0]],
    [[1, 1, 0], [0, 1, 1]],
    [[1, 0, 0], [1, 1, 1]],
    [[0, 0, 1], [1, 1, 1]]
  ];

  let engine = null;
  let timeoutId = null;
  let enabled = true;
  const TICK_MS = 90;

  function setEngine(api) {
    engine = api;
  }

  function getShape(typeIndex, rotation) {
    const raw = SHAPES[typeIndex];
    if (!raw) return [[1]];
    let s = raw.map(row => [...row]);
    for (let r = 0; r < (rotation % 4); r++) {
      const rows = s[0].length;
      const cols = s.length;
      const next = [];
      for (let x = 0; x < rows; x++) {
        next.push([]);
        for (let y = cols - 1; y >= 0; y--) next[x].push(s[y][x]);
      }
      s = next;
    }
    return s;
  }

  function cloneMatrix(m) {
    return m.map(row => row.slice());
  }

  function collide(matrix, shape, px, py) {
    for (let dy = 0; dy < shape.length; dy++) {
      for (let dx = 0; dx < shape[0].length; dx++) {
        if (!shape[dy][dx]) continue;
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= COLS || ny > ROWS) return true;
        if (ny >= 0 && ny < ROWS && matrix[ny][nx]) return true;
      }
    }
    return false;
  }

  function merge(matrix, shape, px, py) {
    const out = cloneMatrix(matrix);
    for (let dy = 0; dy < shape.length; dy++) {
      for (let dx = 0; dx < shape[0].length; dx++) {
        if (!shape[dy][dx]) continue;
        const ny = py + dy;
        const nx = px + dx;
        if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) out[ny][nx] = 1;
      }
    }
    return out;
  }

  function clearLines(matrix) {
    let m = cloneMatrix(matrix);
    let cleared = 0;
    let row = ROWS - 1;
    while (row >= 0) {
      if (m[row].every(c => c > 0)) {
        m.splice(row, 1);
        m.unshift(Array(COLS).fill(0));
        cleared++;
      } else {
        row--;
      }
    }
    return { matrix: m, cleared };
  }

  function dropHeight(matrix, shape, col) {
    const w = shape[0].length;
    const startX = Math.max(0, Math.min(col, COLS - w));
    let py = 0;
    while (!collide(matrix, shape, startX, py)) py++;
    return py - 1;
  }

  function scorePlacement(matrix, shape, col) {
    const w = shape[0].length;
    const startX = Math.max(0, Math.min(col, COLS - w));
    const py = dropHeight(matrix, shape, col);
    if (py < 0) return 1e9;
    const merged = merge(matrix, shape, startX, py);
    const { matrix: after, cleared } = clearLines(merged);
    let aggHeight = 0;
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        if (after[y][x]) {
          aggHeight += ROWS - y;
          break;
        }
      }
    }
    const center = COLS / 2;
    const centerPenalty = Math.abs((startX + w / 2) - center) * 2;
    return aggHeight - cleared * 200 - py * 3 + centerPenalty;
  }

  function pickMove() {
    const state = engine ? engine.getState() : null;
    if (!state || state.gameOver || !state.currentPiece) return;

    const matrix = state.matrix;
    const piece = state.currentPiece;
    const shape = getShape(piece.type, piece.rotation);
    const width = shape[0].length;
    let bestScore = 1e9;
    let bestCol = Math.floor((COLS - width) / 2);
    let bestRotation = piece.rotation;

    for (let rot = 0; rot < 4; rot++) {
      const s = getShape(piece.type, rot);
      const w = s[0].length;
      for (let col = 0; col <= COLS - w; col++) {
        const sc = scorePlacement(matrix, s, col);
        if (sc < bestScore) {
          bestScore = sc;
          bestCol = col;
          bestRotation = rot;
        }
      }
    }

    const currentX = state.currentX;
    const targetX = bestCol;
    const rotationsNeeded = (bestRotation - piece.rotation + 4) % 4;

    for (let r = 0; r < rotationsNeeded; r++) engine.rotate();
    const moves = targetX - currentX;
    for (let i = 0; i < Math.abs(moves); i++) {
      if (moves > 0) engine.moveRight();
      else engine.moveLeft();
    }
    engine.hardDrop();
  }

  function scheduleNext() {
    if (!enabled || !engine) return;
    timeoutId = setTimeout(() => {
      pickMove();
      scheduleNext();
    }, TICK_MS);
  }

  function start(ms) {
    stop();
    timeoutId = setTimeout(() => {
      pickMove();
      scheduleNext();
    }, ms != null && ms > 0 ? ms : 150);
  }

  function stop() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function setEnabled(value) {
    enabled = !!value;
  }

  global.TetrisBot = {
    setEngine,
    start,
    stop,
    setEnabled
  };
})(typeof window !== 'undefined' ? window : global);
