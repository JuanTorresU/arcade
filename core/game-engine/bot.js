/**
 * Bot Layer — "Superhumano"
 * Jugada perfecta con imperfecciones sutiles: variación en reacción, elección de fruta
 * y empates rotos al azar para que no parezca un robot.
 */
(function (global) {
  'use strict';

  const COLS = 28;
  const ROWS = 20;
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  const REACTION_BASE_MS = 100;
  const REACTION_VARIANCE_MS = 18;
  const PROB_STAY_COURSE = 0.04;
  const PROB_ALTERNATIVE_FOOD = 0.22;
  const TOP_FOODS_CONSIDER = 3;

  let engine = null;
  let timeoutId = null;
  let enabled = true;

  function setEngine(api) {
    engine = api;
  }

  function getState() {
    return engine ? engine.getState() : null;
  }

  function directionToKey(dir) {
    if (dir.x === 1 && dir.y === 0) return 'right';
    if (dir.x === -1 && dir.y === 0) return 'left';
    if (dir.x === 0 && dir.y === -1) return 'up';
    if (dir.x === 0 && dir.y === 1) return 'down';
    return 'right';
  }

  function opposite(key) {
    const map = { up: 'down', down: 'up', left: 'right', right: 'left' };
    return map[key] || key;
  }

  function randomInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function bodyWithoutTail(snake) {
    var set = new Set();
    for (var i = 0; i < snake.length - 1; i++) {
      set.add(snake[i].x + ',' + snake[i].y);
    }
    return set;
  }

  function canReach(sx, sy, tx, ty, obstacles) {
    if (sx === tx && sy === ty) return true;
    var queue = [[sx, sy]];
    var visited = new Set();
    visited.add(sx + ',' + sy);
    while (queue.length) {
      var p = queue.shift();
      var x = p[0], y = p[1];
      for (var key in delta) {
        var d = delta[key];
        var nx = x + d[0], ny = y + d[1];
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (obstacles.has(nx + ',' + ny)) continue;
        if (visited.has(nx + ',' + ny)) continue;
        if (nx === tx && ny === ty) return true;
        visited.add(nx + ',' + ny);
        queue.push([nx, ny]);
      }
    }
    return false;
  }

  function reachableCount(sx, sy, obstacles) {
    var queue = [[sx, sy]];
    var visited = new Set();
    visited.add(sx + ',' + sy);
    while (queue.length) {
      var p = queue.shift();
      var x = p[0], y = p[1];
      for (var key in delta) {
        var d = delta[key];
        var nx = x + d[0], ny = y + d[1];
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (obstacles.has(nx + ',' + ny)) continue;
        if (visited.has(nx + ',' + ny)) continue;
        visited.add(nx + ',' + ny);
        queue.push([nx, ny]);
      }
    }
    return visited.size;
  }

  function safeDirections(head, snakeSet, invert) {
    var candidates = ['up', 'down', 'left', 'right'];
    var current = directionToKey(getState().dir);
    var blocked = opposite(current);
    var allowed = candidates.filter(function (d) { return d !== blocked; });
    var safe = [];
    for (var i = 0; i < allowed.length; i++) {
      var d = allowed[i];
      var dxy = delta[d];
      var nx = head.x + dxy[0], ny = head.y + dxy[1];
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (snakeSet.has(nx + ',' + ny)) continue;
      safe.push(d);
    }
    return safe.length ? safe : allowed.filter(function (d) { return d !== blocked; });
  }

  function directionToward(head, target) {
    var dx = target.x - head.x;
    var dy = target.y - head.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  function foodDistance(head, f) {
    return Math.abs(f.x - head.x) + Math.abs(f.y - head.y);
  }

  function pickTargetFood(head, foods) {
    if (!foods || !foods.length) return null;
    var withDist = foods.map(function (f) { return { f: f, d: foodDistance(head, f) }; });
    withDist.sort(function (a, b) { return a.d - b.d; });
    var top = withDist.slice(0, Math.min(TOP_FOODS_CONSIDER, withDist.length));
    if (top.length === 1) return top[0].f;
    if (Math.random() < PROB_ALTERNATIVE_FOOD && top.length > 1) {
      return top[randomInt(0, top.length - 1)].f;
    }
    return top[0].f;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function pickDirection() {
    var state = getState();
    if (!state || state.gameOver || !engine || !enabled) return;

    if (Math.random() < PROB_STAY_COURSE) return;

    var snake = state.snake;
    var head = snake[0];
    var tail = snake[snake.length - 1];
    var snakeSet = new Set(snake.map(function (s) { return s.x + ',' + s.y; }));
    var obstacles = bodyWithoutTail(snake);
    var food = pickTargetFood(head, state.foods);
    var safe = safeDirections(head, snakeSet, state.invertControls);
    if (!safe.length) return;

    var toward = food ? directionToward(head, food) : null;
    var survivable = [];
    var notSurvivable = [];
    for (var i = 0; i < safe.length; i++) {
      var d = safe[i];
      var dxy = delta[d];
      var nx = head.x + dxy[0], ny = head.y + dxy[1];
      var canReachTail = canReach(nx, ny, tail.x, tail.y, obstacles);
      if (canReachTail) survivable.push(d);
      else notSurvivable.push(d);
    }

    var choice = null;
    if (survivable.length) {
      if (toward && survivable.indexOf(toward) >= 0) {
        choice = toward;
      } else {
        var withSpace = survivable.map(function (dd) {
          var dxy2 = delta[dd];
          var nxx = head.x + dxy2[0], nyy = head.y + dxy2[1];
          var obs = new Set(obstacles);
          obs.add(head.x + ',' + head.y);
          return { d: dd, space: reachableCount(nxx, nyy, obs) };
        });
        withSpace.sort(function (a, b) { return b.space - a.space; });
        var bestSpace = withSpace[0].space;
        var ties = withSpace.filter(function (x) { return x.space === bestSpace; });
        if (ties.length > 1) ties = shuffle(ties);
        choice = ties[0].d;
      }
    } else {
      var withSpace2 = notSurvivable.map(function (dd) {
        var dxy3 = delta[dd];
        var nxx = head.x + dxy3[0], nyy = head.y + dxy3[1];
        var obs2 = new Set(obstacles);
        obs2.add(head.x + ',' + head.y);
        return { d: dd, space: reachableCount(nxx, nyy, obs2) };
      });
      withSpace2.sort(function (a, b) { return b.space - a.space; });
      choice = withSpace2[0] ? withSpace2[0].d : notSurvivable[0];
    }
    if (choice) engine.setDirection(choice);
  }

  function scheduleNext() {
    if (!enabled || !engine) return;
    var ms = REACTION_BASE_MS + randomInt(-REACTION_VARIANCE_MS, REACTION_VARIANCE_MS);
    ms = Math.max(70, Math.min(130, ms));
    timeoutId = setTimeout(function () {
      pickDirection();
      scheduleNext();
    }, ms);
  }

  function start(ms) {
    stop();
    var base = (ms != null && ms > 0) ? ms : REACTION_BASE_MS;
    var firstMs = base + randomInt(-REACTION_VARIANCE_MS, REACTION_VARIANCE_MS);
    firstMs = Math.max(70, Math.min(130, firstMs));
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

  global.SnakeBot = {
    setEngine,
    start,
    stop,
    setEnabled,
    getState
  };
})(typeof window !== 'undefined' ? window : global);
