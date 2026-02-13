/**
 * AI Bot — AlphaSnake ONNX inference
 * Modos: 'policy' (rápido, ~50ms) y 'mcts' (fuerte, Web Worker)
 * Requiere ONNX Runtime Web cargado antes de este script.
 */
(function (global) {
  'use strict';

  let BOARD_SIZE = 10;
  const ACTION_NAMES = ['up', 'down', 'left', 'right'];
  // AI actions: 0=UP, 1=DOWN, 2=LEFT, 3=RIGHT
  const OPPOSITES = { 0: 1, 1: 0, 2: 3, 3: 2 };

  let engine = null;
  let session = null;
  let worker = null;
  let mode = 'mcts';         // 'policy' | 'mcts'
  let enabled = false;
  let loopTimeout = null;
  let mctsSimulations = 400;
  let tickIntervalMs = 150;
  let busy = false;
  let pendingRestart = false;
  let stats = { games: 0, wins: 0, totalScore: 0, currentScore: 0 };
  let onStatsUpdate = null;

  /* ---- Utilidades ---- */

  function dirToIndex(dir) {
    if (dir.x === 0 && dir.y === -1) return 0;  // UP
    if (dir.x === 0 && dir.y === 1) return 1;   // DOWN
    if (dir.x === -1 && dir.y === 0) return 2;  // LEFT
    return 3;                                     // RIGHT
  }

  function getValidActions() {
    var state = engine.getState();
    var current = dirToIndex(state.dir);
    var rev = OPPOSITES[current];
    return [0, 1, 2, 3].filter(function (a) { return a !== rev; });
  }

  /* ---- Policy-only inference ---- */

  async function predictPolicy(stateFloat32) {
    var tensor = new ort.Tensor('float32', stateFloat32, [1, 4, BOARD_SIZE, BOARD_SIZE]);
    var results = await session.run({ state: tensor });
    return {
      policy: Array.from(results.policy.data),
      value: results.value.data[0]
    };
  }

  async function pickActionPolicy() {
    var aiState = engine.getAIState();
    var result = await predictPolicy(aiState);
    var policy = result.policy;
    var valid = getValidActions();

    var bestAction = valid[0];
    var bestProb = -1;
    for (var i = 0; i < valid.length; i++) {
      if (policy[valid[i]] > bestProb) {
        bestProb = policy[valid[i]];
        bestAction = valid[i];
      }
    }
    return bestAction;
  }

  /* ---- MCTS via Web Worker ---- */

  function pickActionMCTS() {
    return new Promise(function (resolve) {
      if (!worker) { resolve(0); return; }

      var state = engine.getState();
      var handler = function (e) {
        if (e.data.type === 'result') {
          worker.removeEventListener('message', handler);
          resolve(e.data.action);
        }
      };
      worker.addEventListener('message', handler);

      worker.postMessage({
        type: 'search',
        snakeData: state.snake,
        foodData: state.foods,
        direction: dirToIndex(state.dir),
        simulations: mctsSimulations
      });
    });
  }

  /* ---- Loop principal ---- */

  async function pickAction() {
    if (!engine || !enabled || busy) return;
    var state = engine.getState();
    if (state.gameOver) {
      handleGameOver(state);
      return;
    }

    busy = true;
    try {
      var action;
      if (mode === 'mcts' && worker) {
        action = await pickActionMCTS();
      } else if (session) {
        action = await pickActionPolicy();
      } else {
        busy = false;
        return;
      }
      if (enabled && engine && !engine.isGameOver()) {
        engine.setDirection(ACTION_NAMES[action]);
      }
    } catch (err) {
      console.error('AIBot pickAction error:', err);
    }
    busy = false;
  }

  function handleGameOver(state) {
    if (pendingRestart) return;
    pendingRestart = true;
    stats.games++;
    stats.currentScore = state.score;
    stats.totalScore += state.score;
    if (state.won) stats.wins++;
    if (onStatsUpdate) onStatsUpdate(Object.assign({}, stats));

    // Auto-restart
    setTimeout(function () {
      if (enabled && engine) {
        engine.resetGame();
      }
      pendingRestart = false;
    }, 500);
  }

  function scheduleNext() {
    if (!enabled) return;
    loopTimeout = setTimeout(async function () {
      await pickAction();
      scheduleNext();
    }, tickIntervalMs);
  }

  /* ---- API pública ---- */

  async function loadModel(url) {
    try {
      session = await ort.InferenceSession.create(url, {
        executionProviders: ['wasm']
      });
      console.log('[AIBot] Modelo ONNX cargado:', url);
      return true;
    } catch (err) {
      console.error('[AIBot] Error cargando modelo:', err);
      return false;
    }
  }

  async function initMCTSWorker(modelUrl) {
    var workerUrl = 'ai-mcts-worker.js';
    // Detectar ruta relativa
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('ai-bot.js') !== -1) {
        workerUrl = scripts[i].src.replace('ai-bot.js', 'ai-mcts-worker.js');
        break;
      }
    }

    worker = new Worker(workerUrl);
    return new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () { reject(new Error('Worker init timeout')); }, 30000);
      worker.addEventListener('message', function handler(e) {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          console.log('[AIBot] MCTS Worker listo');
          resolve();
        }
      });
      var boardSize = engine ? engine.getConfig().cols : 10;
      worker.postMessage({ type: 'init', modelUrl: modelUrl, boardSize: boardSize });
    });
  }

  function setEngine(api) {
    engine = api;
    if (api && api.getConfig) {
      BOARD_SIZE = api.getConfig().cols;
    }
  }

  function start(intervalMs) {
    stop();
    enabled = true;
    pendingRestart = false;
    tickIntervalMs = intervalMs || 150;
    scheduleNext();
    console.log('[AIBot] Iniciado en modo ' + mode);
  }

  function stop() {
    enabled = false;
    if (loopTimeout) {
      clearTimeout(loopTimeout);
      loopTimeout = null;
    }
    busy = false;
    pendingRestart = false;
  }

  function resetStats() {
    stats = { games: 0, wins: 0, totalScore: 0, currentScore: 0 };
    pendingRestart = false;
  }

  global.AIBot = {
    loadModel: loadModel,
    initMCTSWorker: initMCTSWorker,
    setEngine: setEngine,
    start: start,
    stop: stop,
    pickAction: pickAction,
    resetStats: resetStats,
    setMode: function (m) { mode = m; },
    getMode: function () { return mode; },
    setSimulations: function (n) { mctsSimulations = n; },
    getSimulations: function () { return mctsSimulations; },
    setInterval: function (ms) { tickIntervalMs = ms; },
    getInterval: function () { return tickIntervalMs; },
    onStats: function (fn) { onStatsUpdate = fn; },
    getStats: function () { return Object.assign({}, stats); },
    isLoaded: function () { return session !== null; },
    isEnabled: function () { return enabled; }
  };
})(typeof window !== 'undefined' ? window : global);
