/**
 * Flappy Bot — Salta cuando está cerca del gap.
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

    const pipe = state.nextPipe;
    if (!pipe) return;

    const birdY = state.birdY;
    const birdVy = state.birdVy;
    const gapCenter = (pipe.topHeight + pipe.bottomY) / 2;
    const distanceToPipe = pipe.x - 200;

    if (distanceToPipe < 80 && distanceToPipe > 0) {
      const shouldJump = state.invertGravity 
        ? (birdY > gapCenter + 20 || birdVy > 0)
        : (birdY < gapCenter - 20 || birdVy < 0);
      
      if (shouldJump) {
        engine.jump();
      }
    } else if (birdY < 50 || birdY > 550) {
      engine.jump();
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

  global.FlappyBot = {
    setEngine,
    start,
    stop,
    setEnabled
  };
})(typeof window !== 'undefined' ? window : global);
