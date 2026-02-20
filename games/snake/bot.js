/**
 * Snake Bot: calcula cada movimiento para acercarse a la fruta mas cercana
 * sin perder. El ciclo Hamiltoniano queda como respaldo seguro.
 */
(function (global) {
  'use strict';

  const COLS = 20;
  const ROWS = 20;
  const N = COLS * ROWS;

  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIRS = ['up', 'down', 'left', 'right'];
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  // Debe reaccionar mas rapido que el tick minimo del engine (85ms en modo tiktok)
  // para no perder giros en bordes.
  const REACTION_BASE_MS = 62;
  const REACTION_VARIANCE_MS = 10;

  // 0 = comportamiento totalmente determinista.
  const PROB_FOLLOW_CYCLE = 0;
  const PROB_SECOND_BEST = 0;

  // En tablero muy lleno, prioriza seguridad estricta.
  const FILL_NO_SHORTCUTS = 0.80;
  const TAIL_COVERAGE_MIN_LENGTH = 80;
  const TAIL_NEAR_MANHATTAN = 3;
  const TAIL_NEAR_CYCLE_BASE = 10;
  const TAIL_NEAR_CYCLE_RATIO = 0.05;
  // En longitudes muy altas, no sacrificar fruta claramente alcanzable por seguir cola.
  const FRUIT_PRIORITY_LENGTH = 300;
  const FRUIT_PRIORITY_DISTANCE = 2;
  // Modo cobertura: rellenar mas, pero sin desviarse demasiado de la fruta.
  const COVERAGE_MAX_FOOD_DRIFT_BASE = 2;
  const COVERAGE_MAX_FOOD_DRIFT_RATIO = 0.015;
  // Anti-borde: preferir jugadas que dejan al menos dos salidas utiles.
  const MIN_FORWARD_OPTIONS = 2;
  const RELAX_FORWARD_OPTIONS_FILL = 0.45;
  // Anti-bucle: memoria corta de celdas y detector de estancamiento.
  const RECENT_HEAD_WINDOW = 48;
  const LOOP_VISIT_THRESHOLD = 3;
  const LOOP_STAGNATION_TICKS = 120;
  // Si se queda orbitando cerca de la cola sin puntuar, pausar cobertura para escapar.
  const TAIL_CHASE_MIN_LENGTH = 160;
  const TAIL_CHASE_STAGNATION_TICKS = 40;
  const COVERAGE_COOLDOWN_TICKS = 55;

  let engine = null;
  let timeoutId = null;
  let enabled = true;
  let running = false;
  let useShortcuts = true;
  let moveCount = 0;
  let reactionMultiplier = 1;
  let tickUnsubscribe = null;
  let lastScore = 0;
  let stagnationTicks = 0;
  let recentHeadQueue = [];
  let recentHeadCounts = new Map();
  let tailChaseTicks = 0;
  let coverageCooldownTicks = 0;

  let cycleOrder = null;
  let cycleIndex = null;

  function generateHamiltonianCycle() {
    const cycle = new Array(N);
    const idx = Array.from({ length: ROWS }, () => new Array(COLS));
    let step = 0;

    // Fila 0: izquierda -> derecha.
    for (let x = 0; x < COLS; x++) {
      cycle[step] = { x: x, y: 0 };
      idx[0][x] = step++;
    }

    // Filas intermedias en zigzag (sin usar col 0).
    for (let y = 1; y <= ROWS - 2; y++) {
      if (y % 2 === 1) {
        for (let x = COLS - 1; x >= 1; x--) {
          cycle[step] = { x: x, y: y };
          idx[y][x] = step++;
        }
      } else {
        for (let x = 1; x < COLS; x++) {
          cycle[step] = { x: x, y: y };
          idx[y][x] = step++;
        }
      }
    }

    // Ultima fila: derecha -> izquierda.
    for (let x = COLS - 1; x >= 0; x--) {
      cycle[step] = { x: x, y: ROWS - 1 };
      idx[ROWS - 1][x] = step++;
    }

    // Columna 0: de abajo hacia arriba para cerrar ciclo.
    for (let y = ROWS - 2; y >= 1; y--) {
      cycle[step] = { x: 0, y: y };
      idx[y][0] = step++;
    }

    if (step !== N) {
      console.error('[SnakeBot] Hamiltonian cycle invalid:', step, 'expected', N);
    }

    cycleOrder = cycle;
    cycleIndex = idx;
  }

  function dirFromTo(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1 && dy === 0) return 'right';
    if (dx === -1 && dy === 0) return 'left';
    if (dx === 0 && dy === 1) return 'down';
    if (dx === 0 && dy === -1) return 'up';
    return null;
  }

  function dirKeyFromVec(d) {
    if (d.x === 1 && d.y === 0) return 'right';
    if (d.x === -1 && d.y === 0) return 'left';
    if (d.x === 0 && d.y === -1) return 'up';
    if (d.x === 0 && d.y === 1) return 'down';
    return 'right';
  }

  function cycleDist(a, b) {
    return (b - a + N) % N;
  }

  function randomInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function keyOf(x, y) {
    return x + ',' + y;
  }

  function isInside(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  function reachableCount(sx, sy, obstacles) {
    const queue = [[sx, sy]];
    const visited = new Set([keyOf(sx, sy)]);
    let q = 0;

    while (q < queue.length) {
      const p = queue[q++];
      for (let i = 0; i < DIRS.length; i++) {
        const dxy = delta[DIRS[i]];
        const nx = p[0] + dxy[0];
        const ny = p[1] + dxy[1];
        const k = keyOf(nx, ny);
        if (!isInside(nx, ny) || obstacles.has(k) || visited.has(k)) continue;
        visited.add(k);
        queue.push([nx, ny]);
      }
    }

    return visited.size;
  }

  function canReach(sx, sy, tx, ty, obstacles) {
    if (sx === tx && sy === ty) return true;

    const queue = [[sx, sy]];
    const visited = new Set([keyOf(sx, sy)]);
    let q = 0;

    while (q < queue.length) {
      const p = queue[q++];
      for (let i = 0; i < DIRS.length; i++) {
        const dxy = delta[DIRS[i]];
        const nx = p[0] + dxy[0];
        const ny = p[1] + dxy[1];
        const k = keyOf(nx, ny);
        if (!isInside(nx, ny) || visited.has(k)) continue;
        if (nx === tx && ny === ty) return true;
        if (obstacles.has(k)) continue;
        visited.add(k);
        queue.push([nx, ny]);
      }
    }

    return false;
  }

  function distanceToNearestFood(sx, sy, foods, obstacles) {
    if (!foods || foods.length === 0) return Infinity;

    const targets = new Set();
    for (let i = 0; i < foods.length; i++) {
      targets.add(keyOf(foods[i].x, foods[i].y));
    }

    if (targets.has(keyOf(sx, sy))) return 0;

    const queue = [[sx, sy, 0]];
    const visited = new Set([keyOf(sx, sy)]);
    let q = 0;

    while (q < queue.length) {
      const p = queue[q++];
      for (let i = 0; i < DIRS.length; i++) {
        const dxy = delta[DIRS[i]];
        const nx = p[0] + dxy[0];
        const ny = p[1] + dxy[1];
        const k = keyOf(nx, ny);
        if (!isInside(nx, ny) || visited.has(k) || obstacles.has(k)) continue;
        if (targets.has(k)) return p[2] + 1;
        visited.add(k);
        queue.push([nx, ny, p[2] + 1]);
      }
    }

    return Infinity;
  }

  function simulateMove(snake, foods, dirKey) {
    const dxy = delta[dirKey];
    if (!dxy || !snake || snake.length === 0) return null;

    const nx = snake[0].x + dxy[0];
    const ny = snake[0].y + dxy[1];
    if (!isInside(nx, ny)) return null;

    let ateFood = false;
    if (foods && foods.length) {
      for (let i = 0; i < foods.length; i++) {
        if (foods[i].x === nx && foods[i].y === ny) {
          ateFood = true;
          break;
        }
      }
    }

    for (let i = 0; i < snake.length; i++) {
      if (snake[i].x !== nx || snake[i].y !== ny) continue;
      const isTail = i === snake.length - 1;
      if (!ateFood && isTail) break;
      return null;
    }

    const nextSnake = [{ x: nx, y: ny }];
    for (let i = 0; i < snake.length; i++) {
      nextSnake.push({ x: snake[i].x, y: snake[i].y });
    }
    if (!ateFood) nextSnake.pop();

    return {
      snake: nextSnake,
      head: nextSnake[0],
      tail: nextSnake[nextSnake.length - 1],
      ateFood: ateFood
    };
  }

  function buildSnakeSet(snake) {
    const set = new Set();
    for (let i = 0; i < snake.length; i++) {
      set.add(keyOf(snake[i].x, snake[i].y));
    }
    return set;
  }

  function resetLoopTracking(score) {
    lastScore = typeof score === 'number' ? score : 0;
    stagnationTicks = 0;
    recentHeadQueue = [];
    recentHeadCounts = new Map();
    tailChaseTicks = 0;
    coverageCooldownTicks = 0;
  }

  function trackHeadVisit(head) {
    const k = keyOf(head.x, head.y);
    recentHeadQueue.push(k);
    recentHeadCounts.set(k, (recentHeadCounts.get(k) || 0) + 1);

    if (recentHeadQueue.length > RECENT_HEAD_WINDOW) {
      const old = recentHeadQueue.shift();
      const n = (recentHeadCounts.get(old) || 0) - 1;
      if (n <= 0) recentHeadCounts.delete(old);
      else recentHeadCounts.set(old, n);
    }
  }

  function getRecentVisitCount(cell) {
    return recentHeadCounts.get(keyOf(cell.x, cell.y)) || 0;
  }

  function requiredForwardOptions(fillRatio) {
    // En longitudes altas, exigir 2 salidas genera orbita y poca captura de frutas.
    return fillRatio >= RELAX_FORWARD_OPTIONS_FILL ? 1 : MIN_FORWARD_OPTIONS;
  }

  function isTailNear(head, tail, headIdx, tailIdx, snakeLen) {
    const manhattan = Math.abs(head.x - tail.x) + Math.abs(head.y - tail.y);
    if (manhattan <= TAIL_NEAR_MANHATTAN) return true;

    const nearCycleGap = Math.max(TAIL_NEAR_CYCLE_BASE, Math.floor(snakeLen * TAIL_NEAR_CYCLE_RATIO));
    const headToTailCycle = cycleDist(headIdx, tailIdx);
    return headToTailCycle <= nearCycleGap;
  }

  function applyLoopPressureFilter(candidates, loopPressure) {
    if (!loopPressure || !candidates || candidates.length <= 1) return candidates;

    let minFoodDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].foodDist < minFoodDist) minFoodDist = candidates[i].foodDist;
    }

    const nearFood = [];
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].foodDist <= minFoodDist + 1) nearFood.push(candidates[i]);
    }
    if (nearFood.length === 0) return candidates;

    let minVisits = Infinity;
    for (let i = 0; i < nearFood.length; i++) {
      if (nearFood[i].recentVisits < minVisits) minVisits = nearFood[i].recentVisits;
    }

    const out = [];
    for (let i = 0; i < nearFood.length; i++) {
      if (nearFood[i].recentVisits === minVisits) out.push(nearFood[i]);
    }
    const base = out.length > 0 ? out : nearFood;
    if (base.length <= 1) return base;

    let farthestTail = -1;
    for (let i = 0; i < base.length; i++) {
      if (base[i].tailDistance > farthestTail) farthestTail = base[i].tailDistance;
    }

    const awayFromTail = [];
    for (let i = 0; i < base.length; i++) {
      if (base[i].tailDistance === farthestTail) awayFromTail.push(base[i]);
    }
    return awayFromTail.length > 0 ? awayFromTail : base;
  }

  function limitCoverageDetour(candidates, snakeLen) {
    if (!candidates || candidates.length <= 1) return candidates;

    let minFoodDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].foodDist < minFoodDist) minFoodDist = candidates[i].foodDist;
    }
    if (!isFinite(minFoodDist)) return candidates;

    const maxFoodDrift = Math.max(
      COVERAGE_MAX_FOOD_DRIFT_BASE,
      Math.floor(snakeLen * COVERAGE_MAX_FOOD_DRIFT_RATIO)
    );

    const nearFood = [];
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].ateFood || candidates[i].foodDist <= minFoodDist + maxFoodDrift) {
        nearFood.push(candidates[i]);
      }
    }
    return nearFood.length > 0 ? nearFood : candidates;
  }

  function wallTouchCount(cell) {
    let n = 0;
    if (cell.x === 0 || cell.x === COLS - 1) n++;
    if (cell.y === 0 || cell.y === ROWS - 1) n++;
    return n;
  }

  function countForwardOptions(nextSnake, dirAfterMove) {
    const head = nextSnake[0];
    const tail = nextSnake[nextSnake.length - 1];
    const occupied = buildSnakeSet(nextSnake);
    const blocked = OPP[dirAfterMove];
    let options = 0;

    for (let i = 0; i < DIRS.length; i++) {
      const d = DIRS[i];
      if (d === blocked) continue;
      const dxy = delta[d];
      const nx = head.x + dxy[0];
      const ny = head.y + dxy[1];
      if (!isInside(nx, ny)) continue;

      const sameAsTail = (nx === tail.x && ny === tail.y);
      const occupiedCell = occupied.has(keyOf(nx, ny));
      if (occupiedCell && !sameAsTail) continue;
      options++;
    }

    return options;
  }

  function rankCandidates(candidates, cycleDirKey, minForwardOptions) {
    const dirOrder = { up: 0, down: 1, left: 2, right: 3 };

    candidates.sort(function (a, b) {
      const aDeadEnd = a.forwardOptions < minForwardOptions;
      const bDeadEnd = b.forwardOptions < minForwardOptions;
      if (aDeadEnd !== bDeadEnd) return aDeadEnd ? 1 : -1;
      if (a.foodDist !== b.foodDist) return a.foodDist - b.foodDist;
      if (a.ateFood !== b.ateFood) return a.ateFood ? -1 : 1;
      if (a.forwardOptions !== b.forwardOptions) return b.forwardOptions - a.forwardOptions;
      if (a.wallTouches !== b.wallTouches) return a.wallTouches - b.wallTouches;
      if (a.recentVisits !== b.recentVisits) return a.recentVisits - b.recentVisits;
      if (a.space !== b.space) return b.space - a.space;
      if ((a.dir === cycleDirKey) !== (b.dir === cycleDirKey)) {
        return a.dir === cycleDirKey ? -1 : 1;
      }
      return dirOrder[a.dir] - dirOrder[b.dir];
    });

    if (PROB_SECOND_BEST > 0 && candidates.length > 1 && Math.random() < PROB_SECOND_BEST) {
      return candidates[1];
    }
    return candidates[0];
  }

  function rankCoverageCandidates(candidates, cycleDirKey, minForwardOptions) {
    const dirOrder = { up: 0, down: 1, left: 2, right: 3 };

    candidates.sort(function (a, b) {
      const aDeadEnd = a.forwardOptions < minForwardOptions;
      const bDeadEnd = b.forwardOptions < minForwardOptions;
      if (aDeadEnd !== bDeadEnd) return aDeadEnd ? 1 : -1;
      if (a.ateFood !== b.ateFood) return a.ateFood ? -1 : 1;
      if (a.recentVisits !== b.recentVisits) return a.recentVisits - b.recentVisits;
      if (a.wallTouches !== b.wallTouches) return a.wallTouches - b.wallTouches;
      if (a.space !== b.space) return b.space - a.space;
      if (a.forwardOptions !== b.forwardOptions) return b.forwardOptions - a.forwardOptions;
      if (a.foodDist !== b.foodDist) return a.foodDist - b.foodDist;
      if ((a.dir === cycleDirKey) !== (b.dir === cycleDirKey)) {
        return a.dir === cycleDirKey ? -1 : 1;
      }
      return dirOrder[a.dir] - dirOrder[b.dir];
    });

    return candidates[0];
  }

  function setDirectionIfValid(dirKey, snake, foods, blocked) {
    if (!dirKey || dirKey === blocked) return false;
    if (!simulateMove(snake, foods, dirKey)) return false;
    moveCount++;
    engine.setDirection(dirKey);
    return true;
  }

  function emergencyMove(head, snakeSet, blocked) {
    const obstacles = new Set(snakeSet);
    obstacles.add(keyOf(head.x, head.y));

    let bestSpace = -1;
    let bestDirs = [];

    for (let i = 0; i < DIRS.length; i++) {
      const d = DIRS[i];
      if (d === blocked) continue;

      const dxy = delta[d];
      const nx = head.x + dxy[0];
      const ny = head.y + dxy[1];
      if (!isInside(nx, ny)) continue;
      if (snakeSet.has(keyOf(nx, ny))) continue;

      const space = reachableCount(nx, ny, obstacles);
      if (space > bestSpace) {
        bestSpace = space;
        bestDirs = [d];
      } else if (space === bestSpace) {
        bestDirs.push(d);
      }
    }

    if (bestDirs.length > 0) {
      const pick = bestDirs[Math.floor(Math.random() * bestDirs.length)];
      moveCount++;
      engine.setDirection(pick);
    }
  }

  function setEngine(api) {
    if (tickUnsubscribe) {
      tickUnsubscribe();
      tickUnsubscribe = null;
    }
    engine = api;
    if (api && api.getConfig) {
      const cfg = api.getConfig();
      if (cfg && (cfg.cols !== 20 || cfg.rows !== 20)) {
        console.warn('[SnakeBot] Engine is not 20x20. Current config:', cfg.cols + 'x' + cfg.rows);
      }
    }
    if (api && typeof api.onBeforeTick === 'function') {
      tickUnsubscribe = api.onBeforeTick(function () {
        pickDirection();
      });
    }
    resetLoopTracking(0);
    generateHamiltonianCycle();
  }

  function setShortcutsMode(value) {
    useShortcuts = !!value;
  }

  function getShortcutsMode() {
    return useShortcuts;
  }

  function toggleShortcutsMode() {
    useShortcuts = !useShortcuts;
    return useShortcuts;
  }

  function getStats() {
    const state = getState();
    const len = state && state.snake ? state.snake.length : 0;
    return {
      length: len,
      fillPercent: state ? (len / N) * 100 : 0,
      moveCount: moveCount
    };
  }

  function getCycleOrder() {
    return cycleOrder ? cycleOrder.slice() : null;
  }

  function getState() {
    return engine ? engine.getState() : null;
  }

  function pickDirection() {
    const state = getState();
    if (!state || state.gameOver || !engine || !enabled || !running || !cycleOrder) return;
    if (!state.snake || state.snake.length === 0) return;

    const snake = state.snake;
    const head = snake[0];
    const tail = snake[snake.length - 1];
    const snakeSet = buildSnakeSet(snake);
    const fillRatio = snake.length / N;
    const minForwardOptions = requiredForwardOptions(fillRatio);

    const currentDir = dirKeyFromVec(state.dir);
    const blocked = OPP[currentDir];

    // Detecta estancamiento y repeticion de celdas para romper bucles.
    const score = typeof state.score === 'number' ? state.score : 0;
    if (score > lastScore) {
      resetLoopTracking(score);
    } else if (score < lastScore) {
      resetLoopTracking(score);
    } else {
      stagnationTicks++;
    }
    trackHeadVisit(head);
    const headVisits = getRecentVisitCount(head);
    const loopPressure =
      stagnationTicks >= LOOP_STAGNATION_TICKS ||
      headVisits >= LOOP_VISIT_THRESHOLD;

    const headIdx = cycleIndex[head.y][head.x];
    const tailIdx = cycleIndex[tail.y][tail.x];
    if (coverageCooldownTicks > 0) coverageCooldownTicks--;
    const rawCoverageMode =
      snake.length >= TAIL_COVERAGE_MIN_LENGTH &&
      isTailNear(head, tail, headIdx, tailIdx, snake.length);
    const tailChaseCandidate =
      rawCoverageMode &&
      snake.length >= TAIL_CHASE_MIN_LENGTH &&
      headVisits >= LOOP_VISIT_THRESHOLD &&
      stagnationTicks > 0;
    if (tailChaseCandidate) tailChaseTicks++;
    else tailChaseTicks = 0;
    if (loopPressure && tailChaseTicks >= TAIL_CHASE_STAGNATION_TICKS) {
      coverageCooldownTicks = COVERAGE_COOLDOWN_TICKS;
      tailChaseTicks = 0;
    }
    const coverageMode = rawCoverageMode && coverageCooldownTicks === 0;
    const nextCell = cycleOrder[(headIdx + 1) % N];
    const cycleDirKey = dirFromTo(head, nextCell);

    if (fillRatio >= FILL_NO_SHORTCUTS || !useShortcuts) {
      if (setDirectionIfValid(cycleDirKey, snake, state.foods, blocked)) return;
      emergencyMove(head, snakeSet, blocked);
      return;
    }

    if (Math.random() < PROB_FOLLOW_CYCLE) {
      if (setDirectionIfValid(cycleDirKey, snake, state.foods, blocked)) return;
    }

    const safeCandidates = [];
    const riskyCandidates = [];

    for (let i = 0; i < DIRS.length; i++) {
      const d = DIRS[i];
      if (d === blocked) continue;

      const sim = simulateMove(snake, state.foods, d);
      if (!sim) continue;

      const nextSnake = sim.snake;
      const nextHead = sim.head;
      const nextTail = sim.tail;

      // Obstaculos para planificar siguiente paso: cuerpo intermedio.
      const obstacles = new Set();
      for (let bi = 1; bi < nextSnake.length - 1; bi++) {
        obstacles.add(keyOf(nextSnake[bi].x, nextSnake[bi].y));
      }

      const safeToTail = canReach(nextHead.x, nextHead.y, nextTail.x, nextTail.y, obstacles);
      const foodDist = distanceToNearestFood(nextHead.x, nextHead.y, state.foods, obstacles);
      const space = reachableCount(nextHead.x, nextHead.y, obstacles);
      const forwardOptions = countForwardOptions(nextSnake, d);
      const wallTouches = wallTouchCount(nextHead);
      const recentVisits = getRecentVisitCount(nextHead);

      const candidate = {
        dir: d,
        foodDist: foodDist,
        space: space,
        forwardOptions: forwardOptions,
        wallTouches: wallTouches,
        recentVisits: recentVisits,
        tailDistance: Math.abs(nextHead.x - nextTail.x) + Math.abs(nextHead.y - nextTail.y),
        safeToTail: safeToTail,
        ateFood: sim.ateFood
      };

      if (safeToTail) safeCandidates.push(candidate);
      else riskyCandidates.push(candidate);
    }

    const useCoverageHeuristics = coverageMode && !loopPressure;

    if (safeCandidates.length > 0) {
      const safer = safeCandidates.filter(function (c) {
        return c.forwardOptions >= minForwardOptions;
      });
      const basePool = safer.length > 0 ? safer : safeCandidates;
      const normalPool = applyLoopPressureFilter(basePool, loopPressure);
      const pool = useCoverageHeuristics ? limitCoverageDetour(basePool, snake.length) : normalPool;
      const hasVeryCloseFood = basePool.some(function (c) {
        return c.ateFood || c.foodDist <= FRUIT_PRIORITY_DISTANCE;
      });
      const preferFoodNow = snake.length >= FRUIT_PRIORITY_LENGTH && hasVeryCloseFood;
      const useCoverageRanking = useCoverageHeuristics && !preferFoodNow;
      const bestSafe = useCoverageRanking
        ? rankCoverageCandidates(pool, cycleDirKey, minForwardOptions)
        : rankCandidates(pool, cycleDirKey, minForwardOptions);
      if (setDirectionIfValid(bestSafe.dir, snake, state.foods, blocked)) return;
    }

    // Si no hay jugada "fruta + segura", vuelve al ciclo.
    if (setDirectionIfValid(cycleDirKey, snake, state.foods, blocked)) return;

    // Ultimo recurso antes de emergencia: maximizar espacio.
    if (riskyCandidates.length > 0) {
      const riskyBase = useCoverageHeuristics
        ? limitCoverageDetour(riskyCandidates, snake.length)
        : applyLoopPressureFilter(riskyCandidates, loopPressure);
      const riskyPool = riskyBase.slice();
      riskyPool.sort(function (a, b) {
        const aDeadEnd = a.forwardOptions < minForwardOptions;
        const bDeadEnd = b.forwardOptions < minForwardOptions;
        if (aDeadEnd !== bDeadEnd) return aDeadEnd ? 1 : -1;
        if (useCoverageHeuristics && a.recentVisits !== b.recentVisits) return a.recentVisits - b.recentVisits;
        if (a.foodDist !== b.foodDist) return a.foodDist - b.foodDist;
        if (a.forwardOptions !== b.forwardOptions) return b.forwardOptions - a.forwardOptions;
        if (a.wallTouches !== b.wallTouches) return a.wallTouches - b.wallTouches;
        if (a.recentVisits !== b.recentVisits) return a.recentVisits - b.recentVisits;
        if (a.space !== b.space) return b.space - a.space;
        return 0;
      });
      if (setDirectionIfValid(riskyPool[0].dir, snake, state.foods, blocked)) return;
    }

    emergencyMove(head, snakeSet, blocked);
  }

  function scheduleNext() {
    if (!enabled || !engine || !running) return;
    let ms = REACTION_BASE_MS + randomInt(-REACTION_VARIANCE_MS, REACTION_VARIANCE_MS);
    ms = ms / reactionMultiplier;
    // Mantener un limite bajo para modo turbo y tope alto para modo normal.
    ms = clamp(ms, 8, 80);
    timeoutId = setTimeout(function () {
      pickDirection();
      scheduleNext();
    }, ms);
  }

  function start(ms) {
    stop();
    moveCount = 0;
    running = true;
    resetLoopTracking(0);
    // Modo sincronizado por tick: la decision ocurre dentro de onBeforeTick.
    if (tickUnsubscribe) return;
    const base = (ms != null && ms > 0) ? ms : REACTION_BASE_MS;
    let firstMs = base + randomInt(-REACTION_VARIANCE_MS, REACTION_VARIANCE_MS);
    firstMs = firstMs / reactionMultiplier;
    firstMs = clamp(firstMs, 8, 80);
    timeoutId = setTimeout(function () {
      pickDirection();
      scheduleNext();
    }, firstMs);
  }

  function stop() {
    running = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function setEnabled(value) {
    enabled = !!value;
  }

  function setReactionMultiplier(value) {
    const n = Number(value);
    reactionMultiplier = clamp(isFinite(n) ? n : 1, 1, 20);
  }

  function getReactionMultiplier() {
    return reactionMultiplier;
  }

  global.SnakeBot = {
    setEngine: setEngine,
    start: start,
    stop: stop,
    setEnabled: setEnabled,
    setReactionMultiplier: setReactionMultiplier,
    getReactionMultiplier: getReactionMultiplier,
    getState: getState,
    setShortcutsMode: setShortcutsMode,
    getShortcutsMode: getShortcutsMode,
    toggleShortcutsMode: toggleShortcutsMode,
    getStats: getStats,
    getCycleOrder: getCycleOrder
  };
})(typeof window !== 'undefined' ? window : global);
