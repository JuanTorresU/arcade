/**
 * Dodge Bot — Esquiva obstáculos moviéndose hacia el espacio libre.
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

    const playerX = state.playerX;
    const obstacles = state.obstacles.filter(o => o.y > 0 && o.y < 400);

    if (obstacles.length === 0) {
      const center = 200;
      if (playerX < center - 5) engine.moveRight();
      else if (playerX > center + 5) engine.moveLeft();
      return;
    }

    const closest = obstacles.reduce((closest, obs) => {
      const dist = Math.abs(obs.x - playerX);
      return !closest || dist < Math.abs(closest.x - playerX) ? obs : closest;
    }, null);

    if (!closest) return;

    const dangerZone = closest.size / 2 + 20;
    const leftBound = closest.x - dangerZone;
    const rightBound = closest.x + dangerZone;

    if (playerX >= leftBound && playerX <= rightBound) {
      const leftSpace = leftBound;
      const rightSpace = 400 - rightBound;
      if (leftSpace > rightSpace) {
        engine.moveLeft();
      } else {
        engine.moveRight();
      }
    } else {
      const center = 200;
      if (playerX < center - 5) engine.moveRight();
      else if (playerX > center + 5) engine.moveLeft();
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

  global.DodgeBot = {
    setEngine,
    start,
    stop,
    setEnabled
  };
})(typeof window !== 'undefined' ? window : global);
