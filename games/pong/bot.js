/**
 * Pong Bot — Controla paddle1 (izquierda).
 */
(function (global) {
  'use strict';

  let engine = null;
  let timeoutId = null;
  let enabled = true;
  const TICK_MS = 16;

  function setEngine(api) {
    engine = api;
  }

  function tick() {
    const state = engine ? engine.getState() : null;
    if (!state || state.gameOver || !enabled) return;

    const paddleCenter = state.paddle1Y + 40;
    const targetY = state.ballY;

    if (targetY < paddleCenter - 5) {
      engine.moveUp();
    } else if (targetY > paddleCenter + 5) {
      engine.moveDown();
    }
  }

  function scheduleNext() {
    if (!enabled || !engine) return;
    timeoutId = setTimeout(() => {
      tick();
      scheduleNext();
    }, TICK_MS);
  }

  function start(ms) {
    stop();
    timeoutId = setTimeout(() => {
      tick();
      scheduleNext();
    }, ms != null && ms > 0 ? ms : 50);
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

  global.PongBot = {
    setEngine,
    start,
    stop,
    setEnabled
  };
})(typeof window !== 'undefined' ? window : global);
