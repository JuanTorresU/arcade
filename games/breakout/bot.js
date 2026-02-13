/**
 * Breakout Bot — Autoplayer simple.
 * Sigue la pelota con la paleta.
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

    const paddleCenter = state.paddleX + 50;
    const targetX = state.ballX;

    if (targetX < paddleCenter - 5) {
      engine.moveLeft();
    } else if (targetX > paddleCenter + 5) {
      engine.moveRight();
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

  global.BreakoutBot = {
    setEngine,
    start,
    stop,
    setEnabled
  };
})(typeof window !== 'undefined' ? window : global);
