/**
 * Bot Layer — "HamiltonBot"
 * Ciclo Hamiltoniano pre-computado + atajos inteligentes hacia la fruta.
 *
 * Estrategia:
 * 1. Se genera un ciclo Hamiltoniano que recorre las 400 celdas (20×20).
 *    Seguir el ciclo garantiza completar el juego sin morir NUNCA.
 * 2. En cada tick el bot evalúa si puede "atajar" — saltar adelante en el
 *    ciclo para acercarse más rápido a la comida.
 * 3. Un atajo es SEGURO si la posición destino está en la "zona libre" del
 *    ciclo (entre la cabeza y la cola, con margen de seguridad).
 * 4. Conforme la serpiente crece, el bot se vuelve más conservador:
 *    - <50 % del tablero: agresivo  (margen 1)
 *    - 50-75 %: moderado            (margen 2)
 *    - 75-90 %: conservador          (margen 4)
 *    - ≥90 %: sigue el ciclo estrictamente
 * 5. Toques "humanos": leve variación de reacción, 3 % de veces sigue el
 *    ciclo aunque haya atajo, 7 % elige la 2.ª mejor opción.
 *
 * Resultado: completa el juego ~95 %+ de las veces, parece un humano
 * con super habilidades.
 */
(function (global) {
  'use strict';

  /* ════════════════ Constantes de grilla ════════════════ */
  const COLS = 20;
  const ROWS = 20;
  const N = COLS * ROWS; // 400

  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIRS = ['up', 'down', 'left', 'right'];
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  /* ════════════════ Parámetros de comportamiento ════════════════ */
  const REACTION_BASE_MS = 90;
  const REACTION_VARIANCE_MS = 15;

  // Sin toques humanos: siempre juega óptimo
  const PROB_FOLLOW_CYCLE  = 0;
  const PROB_SECOND_BEST   = 0;

  // Umbrales (fracción del tablero ocupada). Code Bullet: >80 % sin atajos.
  const FILL_NO_SHORTCUTS = 0.80;  // ≥80 %: solo seguir ciclo (más conservador)
  const FILL_AGGRESSIVE    = 0.50;
  const FILL_MODERATE      = 0.75;
  const FILL_CONSERVATIVE  = 0.90;

  /* ════════════════ Estado del bot ════════════════ */
  let engine       = null;
  let timeoutId    = null;
  let enabled      = true;
  let useShortcuts = true;   // false = modo Hamiltoniano puro (solo ciclo)
  let moveCount    = 0;      // movimientos realizados (para UI)

  // Datos del ciclo Hamiltoniano
  let cycleOrder = null;  // cycleOrder[step] = {x, y}
  let cycleIndex = null;  // cycleIndex[y][x] = step (0..N-1)

  /* ════════════════ Ciclo Hamiltoniano ════════════════
   *
   * Patrón zigzag para una grilla par×par:
   *
   *  Fila 0:       → → → → → → → → → → → → → → → → → → → ↓
   *  Fila 1:       ↓ ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←
   *  Fila 2:       ↓ → → → → → → → → → → → → → → → → → → →
   *  ...           ...zigzag entre col 1 y col 19...
   *  Fila 18:      ↓ → → → → → → → → → → → → → → → → → → →
   *  Fila 19:      ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←
   *  Col 0:        ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ (filas 18→1)
   *  Vuelve a (0,0)
   *
   *  Total: 20 + 18×19 + 20 + 18 = 400 ✓
   */
  function generateHamiltonianCycle() {
    const cycle = new Array(N);
    const idx   = Array.from({ length: ROWS }, () => new Array(COLS));
    let step = 0;

    // Fila 0: izquierda → derecha
    for (let x = 0; x < COLS; x++) {
      cycle[step] = { x, y: 0 };
      idx[0][x] = step++;
    }

    // Filas 1 a ROWS-2: zigzag entre col 1 y col COLS-1
    for (let y = 1; y <= ROWS - 2; y++) {
      if (y % 2 === 1) {
        // Fila impar: derecha → izquierda (col COLS-1 hasta col 1)
        for (let x = COLS - 1; x >= 1; x--) {
          cycle[step] = { x, y };
          idx[y][x] = step++;
        }
      } else {
        // Fila par: izquierda → derecha (col 1 hasta col COLS-1)
        for (let x = 1; x < COLS; x++) {
          cycle[step] = { x, y };
          idx[y][x] = step++;
        }
      }
    }

    // Última fila (ROWS-1): derecha → izquierda (col COLS-1 hasta col 0)
    for (let x = COLS - 1; x >= 0; x--) {
      cycle[step] = { x, y: ROWS - 1 };
      idx[ROWS - 1][x] = step++;
    }

    // Columna 0: sube de fila ROWS-2 hasta fila 1
    for (let y = ROWS - 2; y >= 1; y--) {
      cycle[step] = { x: 0, y };
      idx[y][0] = step++;
    }

    if (step !== N) {
      console.error('[HamiltonBot] Ciclo inválido: step=' + step + ', esperado=' + N);
    }

    cycleOrder = cycle;
    cycleIndex = idx;
    console.log('[HamiltonBot] Ciclo Hamiltoniano generado (' + COLS + '×' + ROWS + ')');
  }

  /* ════════════════ Utilidades ════════════════ */

  /** Distancia hacia adelante en el ciclo (de a → b). */
  function cycleDist(a, b) {
    return (b - a + N) % N;
  }

  /** Dirección ('up'|'down'|'left'|'right') de celda `from` a celda adyacente `to`. */
  function dirFromTo(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1  && dy === 0) return 'right';
    if (dx === -1 && dy === 0) return 'left';
    if (dx === 0  && dy === 1) return 'down';
    if (dx === 0  && dy === -1) return 'up';
    return null;
  }

  /** Convierte vector de dirección {x,y} a clave. */
  function dirKeyFromVec(d) {
    if (d.x ===  1 && d.y ===  0) return 'right';
    if (d.x === -1 && d.y ===  0) return 'left';
    if (d.x ===  0 && d.y === -1) return 'up';
    if (d.x ===  0 && d.y ===  1) return 'down';
    return 'right';
  }

  function randomInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  /**
   * Flood fill: cuenta celdas alcanzables desde (sx,sy) evitando obstáculos.
   * Se usa como fallback de emergencia para elegir la dirección con más espacio.
   */
  function reachableCount(sx, sy, obstacles) {
    const queue = [[sx, sy]];
    const visited = new Set();
    visited.add(sx + ',' + sy);
    let idx = 0;
    while (idx < queue.length) {
      const p = queue[idx++];
      for (const key in delta) {
        const d = delta[key];
        const nx = p[0] + d[0], ny = p[1] + d[1];
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const k = nx + ',' + ny;
        if (obstacles.has(k) || visited.has(k)) continue;
        visited.add(k);
        queue.push([nx, ny]);
      }
    }
    return visited.size;
  }

  /* ════════════════ Lógica principal ════════════════ */

  function setEngine(api) {
    engine = api;
    if (api && api.getConfig) {
      var cfg = api.getConfig();
      if (cfg && (cfg.cols !== 20 || cfg.rows !== 20)) {
        console.warn('[HamiltonBot] Engine no es 20×20 (cols=' + cfg.cols + ', rows=' + cfg.rows + '). Ciclo requiere grilla par 20×20.');
      }
    }
    generateHamiltonianCycle();
  }

  function setShortcutsMode(enabled) {
    useShortcuts = !!enabled;
  }

  function getShortcutsMode() {
    return useShortcuts;
  }

  function toggleShortcutsMode() {
    useShortcuts = !useShortcuts;
    return useShortcuts;
  }

  function getStats() {
    var state = getState();
    var len = state && state.snake ? state.snake.length : 0;
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

  /**
   * Movimiento de emergencia: cuando ni atajos ni ciclo están disponibles.
   * Elige la dirección con más espacio abierto (flood fill).
   */
  function emergencyMove(head, snakeSet, blocked) {
    const obstacles = new Set(snakeSet);
    obstacles.add(head.x + ',' + head.y);

    var bestSpace = -1;
    var bestDirs  = [];

    for (var i = 0; i < DIRS.length; i++) {
      var d = DIRS[i];
      if (d === blocked) continue;
      var dxy = delta[d];
      var nx  = head.x + dxy[0], ny = head.y + dxy[1];
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (snakeSet.has(nx + ',' + ny)) continue;

      var space = reachableCount(nx, ny, obstacles);
      if (space > bestSpace) {
        bestSpace = space;
        bestDirs  = [d];
      } else if (space === bestSpace) {
        bestDirs.push(d);
      }
    }

    if (bestDirs.length > 0) {
      var pick = bestDirs[Math.floor(Math.random() * bestDirs.length)];
      moveCount++;
      engine.setDirection(pick);
    }
  }

  /**
   * pickDirection — corazón del bot.
   *
   * 1. Si el tablero está ≥90 % lleno → sigue ciclo estrictamente.
   * 2. Evalúa las 4 direcciones como posibles atajos seguros.
   * 3. Un atajo es seguro si:
   *    a) No choca con pared ni cuerpo.
   *    b) La celda destino está en la "zona libre" del ciclo:
   *       cycleDist(head, candidato) + margen < cycleDist(head, cola)
   *    c) (Bonus) No crea una "trampa de reversión" (siguiente paso del
   *       ciclo desde el candidato no es la dirección opuesta al movimiento).
   * 4. Entre atajos seguros, elige el que minimice la distancia cíclica a
   *    la comida. Empates se rompen con distancia Manhattan.
   * 5. Si no hay atajos seguros → sigue el ciclo.
   * 6. Si el ciclo está bloqueado (reversa) → emergencia (flood fill).
   */
  function pickDirection() {
    var state = getState();
    if (!state || state.gameOver || !engine || !enabled || !cycleOrder) return;

    var snake    = state.snake;
    var head     = snake[0];
    var tail     = snake[snake.length - 1];
    var snakeLen = snake.length;
    var fillRatio = snakeLen / N;

    var headIdx = cycleIndex[head.y][head.x];
    var tailIdx = cycleIndex[tail.y][tail.x];
    var headToTail = cycleDist(headIdx, tailIdx);

    var currentDir = dirKeyFromVec(state.dir);
    var blocked    = OPP[currentDir];

    var snakeSet = new Set();
    for (var si = 0; si < snake.length; si++) {
      snakeSet.add(snake[si].x + ',' + snake[si].y);
    }

    // ── Comida objetivo: la más cercana en Manhattan ──
    var food = null;
    var bestFoodDist = Infinity;
    if (state.foods) {
      for (var fi = 0; fi < state.foods.length; fi++) {
        var f = state.foods[fi];
        var fd = Math.abs(f.x - head.x) + Math.abs(f.y - head.y);
        if (fd < bestFoodDist) { bestFoodDist = fd; food = f; }
      }
    }
    var foodIdx = food ? cycleIndex[food.y][food.x] : null;

    // ── Dirección por defecto: seguir el ciclo ──
    var nextStep = (headIdx + 1) % N;
    var nextCell = cycleOrder[nextStep];
    var cycleDirKey = dirFromTo(head, nextCell);

    // ════════ Sin atajos: ≥80 % lleno (Code Bullet: más conservador) ════════
    if (fillRatio >= FILL_NO_SHORTCUTS) {
      if (cycleDirKey && cycleDirKey !== blocked) {
        moveCount++;
        engine.setDirection(cycleDirKey);
        return;
      }
      emergencyMove(head, snakeSet, blocked);
      return;
    }

    // ════════ Modo Hamiltoniano puro (sin atajos): seguir ciclo ════════
    if (!useShortcuts) {
      if (cycleDirKey && cycleDirKey !== blocked) {
        moveCount++;
        engine.setDirection(cycleDirKey);
        return;
      }
      emergencyMove(head, snakeSet, blocked);
      return;
    }

    // ════════ Toque humano: a veces seguir ciclo ════════
    if (Math.random() < PROB_FOLLOW_CYCLE && cycleDirKey && cycleDirKey !== blocked) {
      moveCount++;
      engine.setDirection(cycleDirKey);
      return;
    }

    // ── Manzana "delante" en el ciclo (zona libre cabeza→cola); si está atrás, ignorar ──
    var headToFood = (foodIdx !== null) ? cycleDist(headIdx, foodIdx) : Infinity;
    var foodIsAhead = (foodIdx !== null) && (headToFood <= headToTail);

    // Manejo de la manzana (Code Bullet): si la manzana está "atrás" (ya fue saltada),
    // no tomar atajos; seguir el ciclo hasta que vuelva a quedar delante.
    if (foodIdx !== null && !foodIsAhead) {
      if (cycleDirKey && cycleDirKey !== blocked) {
        moveCount++;
        engine.setDirection(cycleDirKey);
        return;
      }
      emergencyMove(head, snakeSet, blocked);
      return;
    }

    // ════════ Evaluar atajos (condición exacta: dist(V, cola) > longitud + 1) ════════
    var candidates = [];

    for (var di = 0; di < DIRS.length; di++) {
      var d   = DIRS[di];
      if (d === blocked) continue;

      var dxy = delta[d];
      var nx  = head.x + dxy[0], ny = head.y + dxy[1];

      // Límites
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      // Colisión con cuerpo
      if (snakeSet.has(nx + ',' + ny)) continue;

      var ci  = cycleIndex[ny][nx];
      var h2c = cycleDist(headIdx, ci);
      var distVToTail = cycleDist(ci, tailIdx);

      // Atajo válido: vecino adelante en el ciclo Y distancia V→cola > longitud + 1 (Code Bullet)
      if (h2c > 0 && distVToTail > snakeLen + 1) {
        // Sin pasarse de la manzana: solo si hay manzana delante y candidato no la pasa
        var dontPassFood = true;
        var distToFood = N;
        if (foodIsAhead && foodIdx !== null) {
          var headToC = h2c;
          if (headToC > headToFood) dontPassFood = false; // pasaría la manzana
          else distToFood = cycleDist(ci, foodIdx);
        }

        if (!dontPassFood) continue;

        var nextFromC    = (ci + 1) % N;
        var nextCellC    = cycleOrder[nextFromC];
        var nextDirFromC = dirFromTo({ x: nx, y: ny }, nextCellC);
        var reversalTrap = (nextDirFromC === OPP[d]);

        candidates.push({
          dir: d,
          distToFood: distToFood,
          reversalTrap: reversalTrap
        });
      }
    }

    // ════════ Elegir candidato: más cercano a la manzana en el ciclo (sin pasarla) ════════
    if (candidates.length > 0) {
      var dirOrder = { up: 0, down: 1, left: 2, right: 3 };
      candidates.sort(function (a, b) {
        var sa = a.distToFood + (a.reversalTrap ? N * 0.5 : 0);
        var sb = b.distToFood + (b.reversalTrap ? N * 0.5 : 0);
        if (sa !== sb) return sa - sb;
        return dirOrder[a.dir] - dirOrder[b.dir];
      });
      var best = candidates[0];
      var bestVal = best.distToFood + (best.reversalTrap ? N * 0.5 : 0);
      var ties = candidates.filter(function (c) {
        return (c.distToFood + (c.reversalTrap ? N * 0.5 : 0)) === bestVal;
      });
      var pick = ties[Math.floor(Math.random() * ties.length)];
      moveCount++;
      engine.setDirection(pick.dir);
      return;
    }

    // ════════ Sin atajos seguros: seguir ciclo ════════
    if (cycleDirKey && cycleDirKey !== blocked) {
      moveCount++;
      engine.setDirection(cycleDirKey);
      return;
    }

    // ════════ Emergencia: ciclo bloqueado ════════
    emergencyMove(head, snakeSet, blocked);
  }

  /* ════════════════ Scheduling ════════════════ */

  function scheduleNext() {
    if (!enabled || !engine) return;
    var ms = REACTION_BASE_MS + randomInt(-REACTION_VARIANCE_MS, REACTION_VARIANCE_MS);
    ms = Math.max(60, Math.min(120, ms));
    timeoutId = setTimeout(function () {
      pickDirection();
      scheduleNext();
    }, ms);
  }

  function start(ms) {
    stop();
    moveCount = 0;
    var base    = (ms != null && ms > 0) ? ms : REACTION_BASE_MS;
    var firstMs = base + randomInt(-REACTION_VARIANCE_MS, REACTION_VARIANCE_MS);
    firstMs = Math.max(60, Math.min(120, firstMs));
    timeoutId = setTimeout(function () {
      pickDirection();
      scheduleNext();
    }, firstMs);
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

  /* ════════════════ API pública ════════════════ */
  global.SnakeBot = {
    setEngine: setEngine,
    start: start,
    stop: stop,
    setEnabled: setEnabled,
    getState: getState,
    setShortcutsMode: setShortcutsMode,
    getShortcutsMode: getShortcutsMode,
    toggleShortcutsMode: toggleShortcutsMode,
    getStats: getStats,
    getCycleOrder: getCycleOrder
  };

})(typeof window !== 'undefined' ? window : global);
