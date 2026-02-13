/**
 * AI MCTS Worker — Ejecuta busqueda MCTS en un Web Worker
 * para no bloquear el rendering del juego.
 * Usa ONNX Runtime Web (WASM backend) para inferencia.
 */

/* global ort, importScripts */
/* eslint-disable no-restricted-globals */

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');

let session = null;
let BOARD_SIZE = 10;
const C_PUCT = 1.0;
const DIR_ALPHA = 0.03;
const DIR_EPS = 0.25;
const FOOD_SAMPLES = 8;
const ACTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // UP, DOWN, LEFT, RIGHT
const OPPOSITES = [1, 0, 3, 2];

/* ====================================================
 * Entorno Snake ligero para simulacion MCTS
 * ==================================================== */

function SnakeEnvSim(snake, food, direction, boardSize) {
  this.snake = snake;
  this.food = food;
  this.direction = direction;
  this.boardSize = boardSize;
  this.done = false;
  this.score = 0;
}

SnakeEnvSim.prototype.clone = function () {
  const env = new SnakeEnvSim(
    this.snake.map(s => [s[0], s[1]]),
    this.food ? [this.food[0], this.food[1]] : null,
    this.direction,
    this.boardSize
  );
  env.done = this.done;
  env.score = this.score;
  return env;
};

SnakeEnvSim.prototype.validActions = function () {
  const rev = OPPOSITES[this.direction];
  const result = [];
  for (let a = 0; a < 4; a++) {
    if (a !== rev) result.push(a);
  }
  return result;
};

SnakeEnvSim.prototype.step = function (action) {
  if (this.done) return [0, true];
  if (action === OPPOSITES[this.direction]) action = this.direction;
  this.direction = action;

  const dx = ACTIONS[action][0], dy = ACTIONS[action][1];
  const hx = this.snake[0][0], hy = this.snake[0][1];
  const nx = hx + dx, ny = hy + dy;

  if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) {
    this.done = true;
    return [-1, true];
  }

  const ateFood = this.food !== null && nx === this.food[0] && ny === this.food[1];

  const checkLen = ateFood ? this.snake.length : this.snake.length - 1;
  for (let i = 0; i < checkLen; i++) {
    if (this.snake[i][0] === nx && this.snake[i][1] === ny) {
      this.done = true;
      return [-1, true];
    }
  }

  this.snake.unshift([nx, ny]);
  if (ateFood) {
    this.score++;
    this.placeFood();
    if (this.food === null && this.snake.length >= this.boardSize * this.boardSize) {
      this.done = true;
      return [1, true];
    }
  } else {
    this.snake.pop();
  }

  return [ateFood ? 1 : 0, false];
};

SnakeEnvSim.prototype.placeFood = function () {
  const occupied = {};
  for (let i = 0; i < this.snake.length; i++) {
    occupied[this.snake[i][0] + ',' + this.snake[i][1]] = true;
  }
  const free = [];
  for (let y = 0; y < this.boardSize; y++) {
    for (let x = 0; x < this.boardSize; x++) {
      if (!occupied[x + ',' + y]) free.push([x, y]);
    }
  }
  if (free.length === 0) { this.food = null; return; }
  this.food = free[Math.floor(Math.random() * free.length)];
};

SnakeEnvSim.prototype.getState = function () {
  const size = this.boardSize * this.boardSize;
  const state = new Float32Array(4 * size);

  for (let i = 0; i < this.snake.length; i++) {
    state[this.snake[i][1] * this.boardSize + this.snake[i][0]] = 1;
  }
  if (this.snake.length > 0) {
    state[size + this.snake[0][1] * this.boardSize + this.snake[0][0]] = 1;
  }
  if (this.food) {
    state[2 * size + this.food[1] * this.boardSize + this.food[0]] = 1;
  }
  const dirVal = (this.direction + 1) / 4;
  for (let j = 0; j < size; j++) {
    state[3 * size + j] = dirVal;
  }
  return state;
};

SnakeEnvSim.prototype.isWin = function () {
  return this.snake.length >= this.boardSize * this.boardSize;
};

/* ====================================================
 * Nodo MCTS
 * ==================================================== */

function MCTSNode(prior) {
  this.prior = prior || 0;
  this.visitCount = 0;
  this.valueSum = 0;
  this.children = {};
  this.isExpanded = false;
  this.env = null;
  this.foodEaten = false;
}

MCTSNode.prototype.value = function () {
  return this.visitCount === 0 ? 0 : this.valueSum / this.visitCount;
};

/* ====================================================
 * Random utilities
 * ==================================================== */

function randn() {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function gammaRandom(alpha) {
  if (alpha < 1) {
    return gammaRandom(alpha + 1) * Math.pow(Math.random(), 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = randn(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function dirichletNoise(n, alpha) {
  const samples = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const g = gammaRandom(alpha);
    samples.push(g);
    sum += g;
  }
  if (sum === 0) return samples.map(() => 1 / n);
  return samples.map(x => x / sum);
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/* ====================================================
 * Inferencia ONNX
 * ==================================================== */

async function predict(stateFloat32) {
  const tensor = new ort.Tensor('float32', stateFloat32, [1, 4, BOARD_SIZE, BOARD_SIZE]);
  const results = await session.run({ state: tensor });
  return {
    policy: Array.from(results.policy.data),
    value: results.value.data[0]
  };
}

/* ====================================================
 * MCTS Search
 * ==================================================== */

function hasChildren(node) {
  return Object.keys(node.children).length > 0;
}

async function averageFoodValue(env, currentValue) {
  const values = [currentValue];
  const snakeSet = new Set();
  for (let s = 0; s < env.snake.length; s++) {
    snakeSet.add(env.snake[s][0] + ',' + env.snake[s][1]);
  }
  const free = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const key = x + ',' + y;
      if (!snakeSet.has(key) && !(env.food?.[0] === x && env.food?.[1] === y)) {
        free.push([x, y]);
      }
    }
  }
  const k = Math.min(FOOD_SAMPLES - 1, free.length);
  if (k > 0) {
    const sampled = shuffleArray(free).slice(0, k);
    for (const fp of sampled) {
      const ec = env.clone();
      ec.food = fp;
      const p2 = await predict(ec.getState());
      values.push(p2.value);
    }
  }
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

async function mctsSearch(rootEnv, numSimulations) {
  const root = new MCTSNode();
  root.env = rootEnv.clone();

  // Expandir raiz
  const pred = await predict(root.env.getState());
  const valid = root.env.validActions();

  // Mask & normalize policy
  let pSum = 0;
  for (const a of valid) pSum += pred.policy[a];
  for (const a of valid) {
    const p = pSum > 0 ? pred.policy[a] / pSum : 1 / valid.length;
    root.children[a] = new MCTSNode(p);
  }
  root.isExpanded = true;

  // Dirichlet noise en root
  const noise = dirichletNoise(valid.length, DIR_ALPHA);
  for (let i = 0; i < valid.length; i++) {
    const a = valid[i];
    root.children[a].prior = (1 - DIR_EPS) * root.children[a].prior + DIR_EPS * noise[i];
  }

  // Simulaciones
  for (let sim = 0; sim < numSimulations; sim++) {
    let node = root;
    const path = [node];

    // SELECT
    while (node.isExpanded && hasChildren(node)) {
      let bestScore = -Infinity, bestAction = -1, bestChild = null;
      for (const key of Object.keys(node.children)) {
        const child = node.children[key];
        const q = child.value();
        const u = C_PUCT * child.prior * Math.sqrt(node.visitCount) / (1 + child.visitCount);
        const score = q + u;
        if (score > bestScore) {
          bestScore = score;
          bestAction = Number.parseInt(key, 10);
          bestChild = child;
        }
      }

      // Lazy state computation
      if (bestChild.env === null) {
        const envCopy = node.env.clone();
        const oldScore = envCopy.score;
        envCopy.step(bestAction);
        bestChild.env = envCopy;
        bestChild.foodEaten = (envCopy.score > oldScore && !envCopy.done);
      }

      node = bestChild;
      path.push(node);
    }

    // EXPAND & EVALUATE
    let val;
    if (!node.isExpanded) {
      if (node.env.done) {
        val = node.env.isWin() ? 1 : -1;
      } else {
        const leafPred = await predict(node.env.getState());
        val = leafPred.value;

        // Food stochasticity
        if (node.foodEaten && FOOD_SAMPLES > 1) {
          val = await averageFoodValue(node.env, val);
        }

        // Create children
        const leafValid = node.env.validActions();
        let leafPSum = 0;
        for (const a of leafValid) leafPSum += leafPred.policy[a];
        for (const a of leafValid) {
          const pr = leafPSum > 0 ? leafPred.policy[a] / leafPSum : 1 / leafValid.length;
          node.children[a] = new MCTSNode(pr);
        }
        node.isExpanded = true;
      }
    } else {
      // Terminal node
      val = node.env.isWin() ? 1 : -1;
    }

    // BACKUP
    for (const n of path) {
      n.visitCount++;
      n.valueSum += val;
    }
  }

  // Best action by visit count (greedy)
  let bestA = -1, bestV = -1;
  for (const key of Object.keys(root.children)) {
    if (root.children[key].visitCount > bestV) {
      bestV = root.children[key].visitCount;
      bestA = Number.parseInt(key, 10);
    }
  }

  return bestA;
}

/* ====================================================
 * Message Handler
 * ==================================================== */

self.onmessage = async function (e) {
  const data = e.data;

  if (data.type === 'init') {
    try {
      if (data.boardSize) BOARD_SIZE = data.boardSize;
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(data.modelUrl, {
        executionProviders: ['wasm']
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  } else if (data.type === 'search') {
    try {
      const snake = data.snakeData.map(s => [s.x, s.y]);
      const food = data.foodData.length > 0 ? [data.foodData[0].x, data.foodData[0].y] : null;
      const env = new SnakeEnvSim(snake, food, data.direction, BOARD_SIZE);
      const action = await mctsSearch(env, data.simulations || 100);
      self.postMessage({ type: 'result', action });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
