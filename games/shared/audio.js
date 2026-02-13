/**
 * Sistema de sonidos — Efectos + música de fondo.
 * Música: archivo opcional sounds/bg-music.mp3 en loop, o loop procedural si no existe.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let bgMusicNode = null;
  let bgGain = null;
  let bgMusicVolume = 0.25;
  let sfxGain = null;
  let sfxVolume = 1.8; // sube sonidos de regalos/efectos
  let sfxPreset = 'clean'; // clean | retro | heavy
  // Ruta relativa al HTML que carga este script
  // Desde games/snake/index.html → ../shared/sounds/bg-music.mp3 → games/shared/sounds/bg-music.mp3
  const BG_MUSIC_URL = '../shared/sounds/bg-music.mp3';

  function getContext() {
    if (ctx) return ctx;
    if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
      ctx = new (AudioContext || webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    }
    return ctx;
  }

  function playTone(freq, duration, type, volume) {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(out);
    osc.frequency.value = freq;
    osc.type = type || 'sine';
    gain.gain.setValueAtTime(volume || 0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  }

  function getSfxOutput() {
    const ac = getContext();
    if (!ac) return null;
    if (sfxGain) return sfxGain;
    sfxGain = ac.createGain();
    sfxGain.gain.value = sfxVolume;
    // Compresor suave para evitar clipping al subir SFX.
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.14;
    sfxGain.connect(comp);
    comp.connect(ac.destination);
    return sfxGain;
  }

  function setSfxVolume(v) {
    sfxVolume = Math.max(0, Math.min(3, v));
    if (sfxGain) sfxGain.gain.value = sfxVolume;
  }

  function setSfxPreset(preset) {
    const p = (preset || '').toString().toLowerCase();
    if (p === 'clean' || p === 'retro' || p === 'heavy') sfxPreset = p;
  }

  function makeNoiseBuffer(ac, seconds) {
    const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * seconds)), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    return buf;
  }

  // SFX alineados con la temática: synth, filtros, A minor (con presets).
  function explosion() {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const t = ac.currentTime;
    if (sfxPreset === 'retro') {
      // 8-bit boom: noise + square thump.
      const src = ac.createBufferSource();
      src.buffer = makeNoiseBuffer(ac, 0.12);
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 800;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.06, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(hp);
      hp.connect(ng);
      ng.connect(out);
      src.start(t);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.22);
      return;
    }

    if (sfxPreset === 'heavy') {
      // Impacto más agresivo (como el actual).
      const src = ac.createBufferSource();
      src.buffer = makeNoiseBuffer(ac, 0.2);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1200, t);
      bp.frequency.exponentialRampToValueAtTime(400, t + 0.15);
      bp.Q.value = 2;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(t);
      const kick = ac.createOscillator();
      const kg = ac.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(120, t);
      kick.frequency.exponentialRampToValueAtTime(45, t + 0.2);
      kg.gain.setValueAtTime(0.22, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      kick.connect(kg);
      kg.connect(out);
      kick.start(t);
      kick.stop(t + 0.25);
      return;
    }

    // clean: thump + noise muy controlado (menos áspero).
    const src = ac.createBufferSource();
    src.buffer = makeNoiseBuffer(ac, 0.14);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(350, t + 0.12);
    bp.Q.value = 1.2;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.05, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(t);
    const th = ac.createOscillator();
    const tg = ac.createGain();
    th.type = 'sine';
    th.frequency.setValueAtTime(90, t);
    th.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    tg.gain.setValueAtTime(0.2, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    th.connect(tg);
    tg.connect(out);
    th.start(t);
    th.stop(t + 0.22);
  }

  function whoosh() {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const t = ac.currentTime;
    if (sfxPreset === 'retro') {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.11);
      return;
    }
    if (sfxPreset === 'heavy') {
      const o = ac.createOscillator();
      const lp = ac.createBiquadFilter();
      const g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.1);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(800, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
      lp.frequency.exponentialRampToValueAtTime(600, t + 0.12);
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(lp);
      lp.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.14);
      return;
    }
    // clean: barrido de ruido (menos chillón).
    const src = ac.createBufferSource();
    src.buffer = makeNoiseBuffer(ac, 0.12);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(500, t);
    hp.frequency.exponentialRampToValueAtTime(2200, t + 0.1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(hp);
    hp.connect(g);
    g.connect(out);
    src.start(t);
  }

  function alarm() {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const t = ac.currentTime;
    if (sfxPreset === 'retro') {
      playTone(880, 0.08, 'square', 0.09);
      setTimeout(() => playTone(659.25, 0.1, 'square', 0.08), 90);
      return;
    }
    if (sfxPreset === 'heavy') {
      const o1 = ac.createOscillator();
      const o2 = ac.createOscillator();
      const bp = ac.createBiquadFilter();
      const g = ac.createGain();
      o1.type = 'square';
      o2.type = 'sawtooth';
      o1.frequency.value = 220;
      o2.frequency.value = 110;
      o2.detune.value = -8;
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 4;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o1.connect(bp);
      o2.connect(bp);
      bp.connect(g);
      g.connect(out);
      o1.start(t);
      o2.start(t);
      o1.stop(t + 0.22);
      o2.stop(t + 0.22);
      setTimeout(function () {
        const o3 = ac.createOscillator();
        const g2 = ac.createGain();
        o3.type = 'square';
        o3.frequency.value = 165;
        g2.gain.setValueAtTime(0.08, ac.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
        o3.connect(g2);
        g2.connect(out);
        o3.start(ac.currentTime);
        o3.stop(ac.currentTime + 0.2);
      }, 100);
      return;
    }
    // clean: dos tonos en A minor (más musical).
    playTone(659.25, 0.09, 'square', 0.085); // E5
    setTimeout(() => playTone(523.25, 0.11, 'square', 0.075), 90); // C5
  }

  function nuke() {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const t = ac.currentTime;
    if (sfxPreset === 'retro') {
      playTone(110, 0.22, 'square', 0.12);
      setTimeout(() => playTone(55, 0.25, 'square', 0.11), 60);
      return;
    }
    if (sfxPreset === 'heavy') {
      const o = ac.createOscillator();
      const lp = ac.createBiquadFilter();
      const g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 55;
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(60, t + 0.2);
      lp.Q.value = 1;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(lp);
      lp.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.3);
      return;
    }
    // clean: sub drop (más redondo).
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.28);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.32);
  }

  function invert() {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const t = ac.currentTime;
    if (sfxPreset === 'retro') {
      playTone(988, 0.05, 'square', 0.08);
      setTimeout(() => playTone(740, 0.06, 'square', 0.07), 50);
      return;
    }
    if (sfxPreset === 'heavy') {
      const o1 = ac.createOscillator();
      const o2 = ac.createOscillator();
      const lp = ac.createBiquadFilter();
      const g = ac.createGain();
      o1.type = 'square';
      o2.type = 'triangle';
      o1.frequency.value = 330;
      o2.frequency.value = 247;
      o1.detune.value = 12;
      o2.detune.value = -10;
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o1.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      g.connect(out);
      o1.start(t);
      o2.start(t);
      o1.stop(t + 0.1);
      o2.stop(t + 0.1);
      return;
    }
    // clean: blip FM corto (futurista pero agradable).
    const car = ac.createOscillator();
    const mod = ac.createOscillator();
    const mg = ac.createGain();
    const g = ac.createGain();
    car.type = 'sine';
    mod.type = 'sine';
    car.frequency.value = 330;
    mod.frequency.value = 660;
    mg.gain.setValueAtTime(40, t);
    mg.gain.exponentialRampToValueAtTime(8, t + 0.08);
    mod.connect(mg);
    mg.connect(car.frequency);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    car.connect(g);
    g.connect(out);
    car.start(t);
    mod.start(t);
    car.stop(t + 0.12);
    mod.stop(t + 0.12);
  }

  function eat() {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const t = ac.currentTime;
    var notes = sfxPreset === 'retro' ? [880, 659.25, 523.25] : [440, 523.25, 659.25];
    for (var i = 0; i < 3; i++) {
      var o = ac.createOscillator();
      var lp = ac.createBiquadFilter();
      var g = ac.createGain();
      o.type = sfxPreset === 'retro' ? 'square' : 'triangle';
      o.frequency.value = notes[i];
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(sfxPreset === 'heavy' ? 2400 : 2000, t + i * 0.04);
      lp.frequency.exponentialRampToValueAtTime(600, t + i * 0.04 + 0.1);
      g.gain.setValueAtTime(sfxPreset === 'heavy' ? 0.09 : 0.08, t + i * 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.12);
      o.connect(lp);
      lp.connect(g);
      g.connect(out);
      o.start(t + i * 0.04);
      o.stop(t + i * 0.04 + 0.14);
    }
  }

  const effectToSound = {
    reset: explosion,
    speed: whoosh,
    death: alarm,
    nuke: nuke,
    garbage: nuke,
    invert: invert,
    eat: eat,
    clearLine: eat,
    chaos: function () { whoosh(); setTimeout(invert, 60); }
  };

  function play(effectKey) {
    const ac = getContext();
    if (ac && ac.state === 'suspended') ac.resume();
    const fn = effectToSound[effectKey];
    if (fn) fn();
  }

  function resume() {
    const ac = getContext();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function startBgMusic() {
    const ac = getContext();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    if (bgMusicNode) return;

    // Usar ruta absoluta desde la raíz del servidor para evitar problemas de resolución
    // El servidor sirve desde games/, así que /shared/sounds/ apunta a games/shared/sounds/
    const musicPath = '/shared/sounds/bg-music.mp3';

    var audio = document.createElement('audio');
    audio.loop = true;
    audio.volume = bgMusicVolume;
    audio.preload = 'auto';
    audio.src = musicPath;
    
    audio.play().then(function () {
      bgMusicNode = audio;
    }).catch(function (err) {
      // Si no existe el archivo, usar música procedural
      startBgMusicProcedural();
    });

    setTimeout(function () {
      if (!bgMusicNode || !bgMusicNode.currentSrc) startBgMusicProcedural();
    }, 500);
  }

  function startBgMusicProcedural() {
    if (bgGain) return;
    var ac = getContext();
    if (!ac) return;
    bgGain = ac.createGain();
    bgGain.gain.value = bgMusicVolume * 0.75;

    // Bus más agresivo: drive + waveshaper + compresor.
    function makeDistortionCurve(amount) {
      var n = 44100;
      var curve = new Float32Array(n);
      var k = typeof amount === 'number' ? amount : 25;
      var deg = Math.PI / 180;
      for (var i = 0; i < n; i++) {
        var x = (i * 2) / n - 1;
        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
      }
      return curve;
    }

    var drive = ac.createGain();
    // Menos drive (antes sonaba a “ruido”).
    drive.gain.value = 1.12;
    var preLP = ac.createBiquadFilter();
    preLP.type = 'lowpass';
    preLP.frequency.value = 7200;
    var shaper = ac.createWaveShaper();
    shaper.curve = makeDistortionCurve(18);
    shaper.oversample = '4x';

    // FX futurista: delay corto con feedback (estéreo si existe).
    var wet = ac.createGain();
    wet.gain.value = 0.22;
    var delay = ac.createDelay(1.0);
    delay.delayTime.value = 0.14;
    var fb = ac.createGain();
    fb.gain.value = 0.28;
    var wetFilter = ac.createBiquadFilter();
    wetFilter.type = 'lowpass';
    wetFilter.frequency.value = 2200;
    var wetPan = (typeof ac.createStereoPanner === 'function') ? ac.createStereoPanner() : null;
    if (wetPan) wetPan.pan.value = -0.15;

    var compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.18;
    bgGain.connect(drive);
    drive.connect(preLP);
    preLP.connect(shaper);
    // Dry
    shaper.connect(compressor);
    // Wet send (delay)
    shaper.connect(delay);
    delay.connect(wetFilter);
    wetFilter.connect(wet);
    if (wetPan) {
      wet.connect(wetPan);
      wetPan.connect(compressor);
    } else {
      wet.connect(compressor);
    }
    // Feedback loop (suavizado)
    wetFilter.connect(fb);
    fb.connect(delay);
    compressor.connect(ac.destination);

    // Tempo objetivo (dato público del tema de referencia): 115 BPM.
    // Nota: no imitamos melodía/entonación exacta; esto es un loop original.
    var BPM = 115;
    var beatLen = 60 / BPM;
    var loopBars = 2;
    var loopLen = beatLen * 4 * loopBars;
    var loopIndex = 0;

    // “Carro rápido”: viento/carretera (ruido filtrado con modulación lenta).
    (function startWind() {
      try {
        var noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
        var src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        var hp = ac.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 180;
        var bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 0.6;
        var lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 5200;
        var g = ac.createGain();
        g.gain.value = 0.018;
        var pan = (typeof ac.createStereoPanner === 'function') ? ac.createStereoPanner() : null;

        // Modulación para sensación de movimiento.
        var lfo = ac.createOscillator();
        var lfoGain = ac.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.28;
        lfoGain.gain.value = 260;
        lfo.connect(lfoGain);
        lfoGain.connect(bp.frequency);

        if (pan) {
          var pLfo = ac.createOscillator();
          var pGain = ac.createGain();
          pLfo.type = 'sine';
          pLfo.frequency.value = 0.18;
          pGain.gain.value = 0.25;
          pLfo.connect(pGain);
          pGain.connect(pan.pan);
          pLfo.start();
        }

        src.connect(hp);
        hp.connect(bp);
        bp.connect(lp);
        lp.connect(g);
        if (pan) {
          g.connect(pan);
          pan.connect(compressor);
        } else {
          g.connect(compressor);
        }
        src.start();
        lfo.start();
      } catch (e) {}
    })();

    // Zumbido de arcade / corriente (drone grave).
    (function startArcadeHum() {
      try {
        var o1 = ac.createOscillator();
        var o2 = ac.createOscillator();
        var g = ac.createGain();
        g.gain.value = 0.008;
        o1.type = 'sine';
        o2.type = 'sine';
        o1.frequency.value = 55;
        o2.frequency.value = 55.3;
        o2.detune.value = 4;
        var lfo = ac.createOscillator();
        var lfoGain = ac.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.08;
        lfoGain.gain.value = 0.004;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        o1.connect(g);
        o2.connect(g);
        g.connect(compressor);
        o1.start();
        o2.start();
        lfo.start();
      } catch (e) {}
    })();

    // Murmullo de chat / audiencia (ruido en banda media).
    (function startChatMurmur() {
      try {
        var noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
        var src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        var bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 520;
        bp.Q.value = 0.4;
        var g = ac.createGain();
        g.gain.value = 0.012;
        var lfo = ac.createOscillator();
        var lfoGain = ac.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.12;
        lfoGain.gain.value = 120;
        lfo.connect(lfoGain);
        lfoGain.connect(bp.frequency);
        src.connect(bp);
        bp.connect(g);
        g.connect(compressor);
        src.start();
        lfo.start();
      } catch (e) {}
    })();

    function kick(t) {
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      g.gain.setValueAtTime(0.48, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g);
      g.connect(bgGain);
      osc.start(t);
      osc.stop(t + 0.3);
    }

    function snare(t) {
      var noise = ac.createBuffer(1, ac.sampleRate * 0.1, ac.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      var src = ac.createBufferSource();
      src.buffer = noise;
      var bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.7;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      src.connect(bp);
      bp.connect(g);
      g.connect(bgGain);
      src.start(t);
      var tone = ac.createOscillator();
      var gt = ac.createGain();
      tone.type = 'triangle';
      tone.frequency.value = 180;
      gt.gain.setValueAtTime(0.10, t);
      gt.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      tone.connect(gt);
      gt.connect(bgGain);
      tone.start(t);
      tone.stop(t + 0.06);

      // "Clap" corto para pegada (click).
      var clap = ac.createOscillator();
      var gc = ac.createGain();
      clap.type = 'square';
      clap.frequency.value = 800;
      gc.gain.setValueAtTime(0.03, t);
      gc.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      clap.connect(gc);
      gc.connect(bgGain);
      clap.start(t);
      clap.stop(t + 0.03);
    }

    function bassNote(t, freq, dur) {
      // Bajo más agresivo: saw + filtro LP con envolvente.
      var osc = ac.createOscillator();
      var g = ac.createGain();
      var lp = ac.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(140, t + Math.min(0.25, dur));
      lp.Q.value = 0.8;
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(lp);
      lp.connect(g);
      g.connect(bgGain);
      osc.start(t);
      osc.stop(t + dur);
    }

    function hat(t, open, level) {
      var noise = ac.createBuffer(1, ac.sampleRate * (open ? 0.08 : 0.03), ac.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
      var src = ac.createBufferSource();
      src.buffer = noise;
      var hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 8200;
      var g = ac.createGain();
      var lv = (level == null ? 1 : level);
      g.gain.setValueAtTime((open ? 0.070 : 0.050) * lv, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.08 : 0.03));
      src.connect(hp);
      hp.connect(g);
      g.connect(bgGain);
      src.start(t);
    }

    function chordStab(t, rootFreq) {
      // Stab corto estilo dance: 3 osciladores saw con filtro lowpass.
      var freqs = [rootFreq, rootFreq * Math.pow(2, 3 / 12), rootFreq * Math.pow(2, 7 / 12)];
      var lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1700, t);
      lp.frequency.exponentialRampToValueAtTime(650, t + 0.12);
      var g = ac.createGain();
      g.gain.setValueAtTime(0.13, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      lp.connect(g);
      g.connect(bgGain);
      for (var i = 0; i < freqs.length; i++) {
        var osc = ac.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[i];
        osc.detune.value = (i - 1) * 11;
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + 0.16);
      }
    }

    // Frases melódicas que rotan con el tiempo (evolución cada 2 loops).
    var notes = [880, 1046.5, 1174.66, 1318.51, 1567.98]; // A5–G6 A minor
    var stepsA = [
      { dt: 0.00, n: 0 }, { dt: 0.25, n: 1 }, { dt: 0.50, n: 4 }, { dt: 0.75, n: 3 },
      { dt: 1.00, n: 0 }, { dt: 1.25, n: 1 }, { dt: 1.50, n: 2 }, { dt: 1.75, n: 1 },
      { dt: 2.00, n: 0 }, { dt: 2.25, n: 1 }, { dt: 2.50, n: 4 }, { dt: 2.75, n: 3 },
      { dt: 3.00, n: 2 }, { dt: 3.25, n: 1 }, { dt: 3.50, n: 0 }, { dt: 3.75, n: 1 }
    ];
    var stepsB = [
      { dt: 0.00, n: 0 }, { dt: 0.25, n: 2 }, { dt: 0.50, n: 3 }, { dt: 0.75, n: 1 },
      { dt: 1.00, n: 4 }, { dt: 1.25, n: 3 }, { dt: 1.50, n: 2 }, { dt: 1.75, n: 1 },
      { dt: 2.00, n: 0 }, { dt: 2.25, n: 1 }, { dt: 2.50, n: 2 }, { dt: 2.75, n: 3 },
      { dt: 3.00, n: 4 }, { dt: 3.25, n: 2 }, { dt: 3.50, n: 1 }, { dt: 3.75, n: 0 }
    ];
    var stepsC = [
      { dt: 0.00, n: 4 }, { dt: 0.25, n: 3 }, { dt: 0.50, n: 2 }, { dt: 0.75, n: 1 },
      { dt: 1.00, n: 0 }, { dt: 1.25, n: 1 }, { dt: 1.50, n: 2 }, { dt: 1.75, n: 3 },
      { dt: 2.00, n: 2 }, { dt: 2.25, n: 1 }, { dt: 2.50, n: 0 }, { dt: 2.75, n: 1 },
      { dt: 3.00, n: 2 }, { dt: 3.25, n: 3 }, { dt: 3.50, n: 4 }, { dt: 3.75, n: 2 }
    ];
    var stepsD = [
      { dt: 0.00, n: 1 }, { dt: 0.25, n: 1 }, { dt: 0.50, n: 3 }, { dt: 0.75, n: 2 },
      { dt: 1.00, n: 0 }, { dt: 1.25, n: 2 }, { dt: 1.50, n: 2 }, { dt: 1.75, n: 1 },
      { dt: 2.00, n: 4 }, { dt: 2.25, n: 3 }, { dt: 2.50, n: 2 }, { dt: 2.75, n: 1 },
      { dt: 3.00, n: 0 }, { dt: 3.25, n: 2 }, { dt: 3.50, n: 1 }, { dt: 3.75, n: 0 }
    ];
    var stepsE = [
      { dt: 0.00, n: 0 }, { dt: 0.25, n: 2 }, { dt: 0.50, n: 0 }, { dt: 0.75, n: 3 },
      { dt: 1.00, n: 1 }, { dt: 1.25, n: 4 }, { dt: 1.50, n: 1 }, { dt: 1.75, n: 3 },
      { dt: 2.00, n: 2 }, { dt: 2.25, n: 0 }, { dt: 2.50, n: 2 }, { dt: 2.75, n: 4 },
      { dt: 3.00, n: 3 }, { dt: 3.25, n: 1 }, { dt: 3.50, n: 3 }, { dt: 3.75, n: 0 }
    ];
    var stepsF = [
      { dt: 0.00, n: 2 }, { dt: 0.25, n: 1 }, { dt: 0.50, n: 3 }, { dt: 0.75, n: 4 },
      { dt: 1.00, n: 2 }, { dt: 1.25, n: 0 }, { dt: 1.50, n: 1 }, { dt: 1.75, n: 2 },
      { dt: 2.00, n: 3 }, { dt: 2.25, n: 4 }, { dt: 2.50, n: 3 }, { dt: 2.75, n: 2 },
      { dt: 3.00, n: 1 }, { dt: 3.25, n: 0 }, { dt: 3.50, n: 1 }, { dt: 3.75, n: 2 }
    ];
    var stepsG = [
      { dt: 0.00, n: 3 }, { dt: 0.25, n: 0 }, { dt: 0.50, n: 2 }, { dt: 0.75, n: 4 },
      { dt: 1.00, n: 1 }, { dt: 1.25, n: 3 }, { dt: 1.50, n: 0 }, { dt: 1.75, n: 2 },
      { dt: 2.00, n: 4 }, { dt: 2.25, n: 1 }, { dt: 2.50, n: 3 }, { dt: 2.75, n: 0 },
      { dt: 3.00, n: 2 }, { dt: 3.25, n: 4 }, { dt: 3.50, n: 1 }, { dt: 3.75, n: 3 }
    ];
    var stepsH = [
      { dt: 0.00, n: 0 }, { dt: 0.25, n: 0 }, { dt: 0.50, n: 1 }, { dt: 0.75, n: 1 },
      { dt: 1.00, n: 2 }, { dt: 1.25, n: 2 }, { dt: 1.50, n: 3 }, { dt: 1.75, n: 3 },
      { dt: 2.00, n: 4 }, { dt: 2.25, n: 3 }, { dt: 2.50, n: 2 }, { dt: 2.75, n: 1 },
      { dt: 3.00, n: 0 }, { dt: 3.25, n: 1 }, { dt: 3.50, n: 2 }, { dt: 3.75, n: 0 }
    ];
    var stepsI = [
      { dt: 0.00, n: 4 }, { dt: 0.25, n: 1 }, { dt: 0.50, n: 0 }, { dt: 0.75, n: 2 },
      { dt: 1.00, n: 3 }, { dt: 1.25, n: 0 }, { dt: 1.50, n: 4 }, { dt: 1.75, n: 1 },
      { dt: 2.00, n: 2 }, { dt: 2.25, n: 4 }, { dt: 2.50, n: 1 }, { dt: 2.75, n: 3 },
      { dt: 3.00, n: 0 }, { dt: 3.25, n: 4 }, { dt: 3.50, n: 2 }, { dt: 3.75, n: 1 }
    ];
    var stepsJ = [
      { dt: 0.00, n: 1 }, { dt: 0.25, n: 3 }, { dt: 0.50, n: 0 }, { dt: 0.75, n: 4 },
      { dt: 1.00, n: 2 }, { dt: 1.25, n: 0 }, { dt: 1.50, n: 3 }, { dt: 1.75, n: 1 },
      { dt: 2.00, n: 4 }, { dt: 2.25, n: 2 }, { dt: 2.50, n: 1 }, { dt: 2.75, n: 3 },
      { dt: 3.00, n: 0 }, { dt: 3.25, n: 4 }, { dt: 3.50, n: 2 }, { dt: 3.75, n: 0 }
    ];
    var phraseSteps = [stepsA, stepsB, stepsC, stepsD, stepsE, stepsF, stepsG, stepsH, stepsI, stepsJ];

    function hook(t, variant, phraseIndex) {
      var steps = phraseSteps[phraseIndex % phraseSteps.length];
      var useFM = (phraseIndex % 3) === 1;
      var useShimmer = (phraseIndex % 4) === 2;

      for (var i = 0; i < steps.length; i++) {
        var start = t + steps[i].dt * beatLen;
        var freq = notes[steps[i].n];

        if (useFM) {
          var car = ac.createOscillator();
          var mod = ac.createOscillator();
          var modGain = ac.createGain();
          var g = ac.createGain();
          var lp = ac.createBiquadFilter();
          car.type = 'sine';
          mod.type = 'sine';
          car.frequency.value = freq;
          mod.frequency.value = freq * 2.01;
          modGain.gain.setValueAtTime(70, start);
          modGain.gain.exponentialRampToValueAtTime(20, start + 0.14);
          mod.connect(modGain);
          modGain.connect(car.frequency);
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(2800, start);
          lp.frequency.exponentialRampToValueAtTime(1100, start + 0.14);
          g.gain.setValueAtTime(0.048, start);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
          car.connect(lp);
          lp.connect(g);
          g.connect(bgGain);
          car.start(start);
          mod.start(start);
          car.stop(start + 0.16);
          mod.stop(start + 0.16);
        } else {
          var o1 = ac.createOscillator();
          var o2 = ac.createOscillator();
          var lfo = ac.createOscillator();
          var lfoGain = ac.createGain();
          var g = ac.createGain();
          var bp = ac.createBiquadFilter();
          var lp = ac.createBiquadFilter();
          o1.type = 'sawtooth';
          o2.type = 'square';
          o1.frequency.value = freq;
          o2.frequency.value = freq;
          o1.detune.value = -9;
          o2.detune.value = 11;
          lfo.type = 'sine';
          lfo.frequency.value = 10 + (phraseIndex % 3) * 1.5;
          lfoGain.gain.value = 14;
          lfo.connect(lfoGain);
          lfoGain.connect(o1.detune);
          lfoGain.connect(o2.detune);
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(1300 + phraseIndex * 80, start);
          bp.frequency.exponentialRampToValueAtTime(950, start + 0.10);
          bp.Q.value = 8;
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(5200, start);
          lp.frequency.exponentialRampToValueAtTime(1600, start + 0.12);
          g.gain.setValueAtTime(0.052, start);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
          o1.connect(bp);
          o2.connect(bp);
          bp.connect(lp);
          lp.connect(g);
          g.connect(bgGain);
          lfo.start(start);
          o1.start(start);
          o2.start(start);
          lfo.stop(start + 0.14);
          o1.stop(start + 0.14);
          o2.stop(start + 0.14);
        }

        if (useShimmer) {
          var sh = ac.createOscillator();
          var sg = ac.createGain();
          var slp = ac.createBiquadFilter();
          sh.type = 'sine';
          sh.frequency.value = freq * 2;
          slp.type = 'lowpass';
          slp.frequency.value = 3400;
          sg.gain.setValueAtTime(0.018, start);
          sg.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
          sh.connect(slp);
          slp.connect(sg);
          sg.connect(bgGain);
          sh.start(start);
          sh.stop(start + 0.14);
        }
      }
    }

    var padChordRoots = [220, 174.61, 261.63, 196, 164.81, 146.83, 220, 196, 174.61, 246.94];
    var padChordTypes = [
      [0, 3, 7],
      [0, 3, 7],
      [0, 4, 7],
      [0, 3, 7],
      [0, 3, 7],
      [0, 3, 7],
      [0, 4, 7],
      [0, 3, 7],
      [0, 3, 7],
      [0, 3, 7]
    ];

    function futurePad(t, dur, phraseIndex) {
      var root = padChordRoots[phraseIndex % padChordRoots.length];
      var semis = padChordTypes[phraseIndex % padChordTypes.length];
      var freqs = semis.map(function (s) { return root * Math.pow(2, s / 12); });
      var cutoff = 500 + (phraseIndex % 4) * 80;
      for (var i = 0; i < freqs.length; i++) {
        var o = ac.createOscillator();
        var g = ac.createGain();
        var lp = ac.createBiquadFilter();
        o.type = 'sine';
        o.frequency.value = freqs[i];
        lp.type = 'lowpass';
        lp.frequency.value = cutoff;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.032 + (phraseIndex % 3) * 0.006, t + 0.4);
        g.gain.setValueAtTime(0.032, t + dur - 0.3);
        g.gain.linearRampToValueAtTime(0.001, t + dur);
        o.connect(lp);
        lp.connect(g);
        g.connect(bgGain);
        o.start(t);
        o.stop(t + dur);
      }
    }

    function pluckSynth(t, freq, phraseIndex) {
      var decay = 0.18 + (phraseIndex % 3) * 0.04;
      var cutoffEnd = 350 + (phraseIndex % 4) * 120;
      var o1 = ac.createOscillator();
      var o2 = ac.createOscillator();
      var lp = ac.createBiquadFilter();
      var g = ac.createGain();
      o1.type = phraseIndex % 2 ? 'square' : 'triangle';
      o2.type = 'sine';
      o1.frequency.value = freq;
      o2.frequency.value = freq * (1 + (phraseIndex % 5) * 0.002);
      o1.detune.value = (phraseIndex % 3 - 1) * 8;
      o2.detune.value = (phraseIndex % 3 - 1) * -6;
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2800 + (phraseIndex % 4) * 200, t);
      lp.frequency.exponentialRampToValueAtTime(cutoffEnd, t + decay);
      lp.Q.value = 0.8 + (phraseIndex % 3) * 0.2;
      g.gain.setValueAtTime(0.038 + (phraseIndex % 4) * 0.008, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay + 0.04);
      o1.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      g.connect(bgGain);
      o1.start(t);
      o2.start(t);
      o1.stop(t + decay + 0.06);
      o2.stop(t + decay + 0.06);
    }

    var stringsPadRoots = [220, 174.61, 261.63, 196, 164.81, 146.83, 207.65, 246.94, 220, 185];
    function stringsPad(t, dur, phraseIndex) {
      var root = stringsPadRoots[phraseIndex % stringsPadRoots.length];
      var freqs = [root, root * Math.pow(2, 3 / 12), root * Math.pow(2, 7 / 12), root * 0.5];
      var cutoff = 750 + (phraseIndex % 5) * 150;
      var detuneAmt = 6 + (phraseIndex % 3) * 4;
      for (var i = 0; i < freqs.length; i++) {
        var o = ac.createOscillator();
        var g = ac.createGain();
        var lp = ac.createBiquadFilter();
        o.type = phraseIndex % 4 === 1 ? 'triangle' : 'sawtooth';
        o.frequency.value = freqs[i];
        o.detune.value = (i - 1.5) * detuneAmt;
        lp.type = 'lowpass';
        lp.frequency.value = cutoff;
        lp.Q.value = 0.4 + (phraseIndex % 3) * 0.1;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.022 + (phraseIndex % 4) * 0.004, t + 0.5);
        g.gain.setValueAtTime(0.022, t + dur - 0.4);
        g.gain.linearRampToValueAtTime(0.001, t + dur);
        o.connect(lp);
        lp.connect(g);
        g.connect(bgGain);
        o.start(t);
        o.stop(t + dur);
      }
    }

    function bellSynth(t, freq, phraseIndex) {
      var modRatio = 2.2 + (phraseIndex % 5) * 0.2;
      var modDepth = 30 + (phraseIndex % 4) * 10;
      var c = ac.createOscillator();
      var m = ac.createOscillator();
      var mg = ac.createGain();
      var g = ac.createGain();
      var lp = ac.createBiquadFilter();
      c.type = 'sine';
      m.type = 'sine';
      c.frequency.value = freq;
      m.frequency.value = freq * modRatio;
      mg.gain.setValueAtTime(modDepth, t);
      mg.gain.exponentialRampToValueAtTime(6 + (phraseIndex % 3) * 2, t + 0.15);
      m.connect(mg);
      mg.connect(c.frequency);
      lp.type = 'lowpass';
      lp.frequency.value = 3500 + (phraseIndex % 4) * 300;
      g.gain.setValueAtTime(0.028 + (phraseIndex % 3) * 0.006, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22 + (phraseIndex % 3) * 0.04);
      c.connect(lp);
      lp.connect(g);
      g.connect(bgGain);
      c.start(t);
      m.start(t);
      c.stop(t + 0.3);
      m.stop(t + 0.3);
    }

    function riser(t) {
      // Sweep/risers cada tanto para que el loop no sea plano.
      var noise = ac.createBuffer(1, ac.sampleRate * 0.28, ac.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
      var src = ac.createBufferSource();
      src.buffer = noise;
      var bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(800, t);
      bp.frequency.exponentialRampToValueAtTime(5200, t + 0.26);
      bp.Q.value = 1.2;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.20);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      src.connect(bp);
      bp.connect(g);
      g.connect(bgGain);
      src.start(t);
    }

    function scheduleLoop(from) {
      var variant = loopIndex % 4;
      var phraseIndex = Math.floor(loopIndex / 2) % phraseSteps.length;
      var percPattern = Math.floor(loopIndex / 4) % 3;
      for (var bar = 0; bar < loopBars; bar++) {
        var t = from + bar * beatLen * 4;
        var swing = beatLen * 0.08;

        if (percPattern === 0) {
          kick(t);
          kick(t + beatLen * 2);
          snare(t + beatLen);
          snare(t + beatLen * 3);
          for (var s = 0; s < 8; s++) {
            var ht = t + s * (beatLen / 2) + (s % 2 ? swing : 0);
            var lv = 1;
            if (variant === 1 && bar === 0 && s < 3) lv = 0.25;
            if (variant === 2 && s % 4 === 1) lv = 0.6;
            hat(ht, (variant === 3 && s % 4 === 3) || (s === 7), lv);
          }
        } else if (percPattern === 1) {
          kick(t);
          kick(t + beatLen);
          kick(t + beatLen * 2);
          kick(t + beatLen * 3);
          snare(t + beatLen);
          snare(t + beatLen * 3);
          for (var s = 0; s < 8; s++) {
            var ht = t + s * (beatLen / 2) + (s % 2 ? swing : 0);
            hat(ht, s === 7, s % 2 ? 0.5 : 0.85);
          }
        } else {
          kick(t);
          kick(t + beatLen * 2.5);
          kick(t + beatLen * 3.5);
          snare(t + beatLen);
          snare(t + beatLen * 3);
          snare(t + beatLen * 3.5);
          for (var s = 0; s < 8; s++) {
            var ht = t + s * (beatLen / 2);
            hat(ht, s === 3 || s === 7, s === 1 || s === 5 ? 0.4 : 0.7);
          }
        }

        // Bajo alterna cada sección para que no sea monótono.
        if (variant === 2) {
          bassNote(t, 49, beatLen * 2);
          bassNote(t + beatLen * 2, 55, beatLen * 2);
        } else {
          bassNote(t, 55, beatLen * 2);
          bassNote(t + beatLen * 2, 62, beatLen * 2);
        }
        // Stabs de acorde: 10 frases distintas (pares de raíces).
        var stabPairs = [
          [220, 246.94], [174.61, 196], [196, 220], [164.81, 185], [246.94, 220],
          [146.83, 174.61], [207.65, 233.08], [185, 207.65], [220, 174.61], [261.63, 220]
        ];
        var sp = stabPairs[phraseIndex % stabPairs.length];
        chordStab(t + beatLen * 1.5, sp[0]);
        chordStab(t + beatLen * 3.5, sp[1]);

        // Arpegio futurista (1/16); acorde rota con phraseIndex para evolución.
        var arpSets = [
          [440, 523.25, 659.25, 783.99, 659.25, 523.25],
          [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25],
          [329.63, 440, 523.25, 659.25, 523.25, 440],
          [392, 523.25, 659.25, 783.99, 659.25, 523.25],
          [440, 554.37, 659.25, 880, 659.25, 554.37],
          [349.23, 440, 523.25, 659.25, 523.25, 440],
          [493.88, 587.33, 739.99, 880, 739.99, 587.33],
          [277.18, 369.99, 440, 554.37, 440, 369.99],
          [415.30, 523.25, 659.25, 783.99, 659.25, 523.25],
          [261.63, 329.63, 440, 523.25, 440, 329.63]
        ];
        var arp = arpSets[phraseIndex % arpSets.length];
        for (var a = 0; a < 16; a++) {
          var at = t + a * (beatLen / 4) + (a % 2 ? swing * 0.6 : 0);
          var o = ac.createOscillator();
          var gg = ac.createGain();
          var bp = ac.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 1100 + (phraseIndex % 3) * 150;
          bp.Q.value = 4;
          o.type = 'triangle';
          o.frequency.value = arp[a % arp.length] * (a % 8 < 4 ? 1 : 0.5) * (variant === 3 ? 1.06 : 1);
          var base = 0.022;
          if (variant === 2 && a % 4 === 2) base = 0.007; // respira sin “mover” el compás
          gg.gain.setValueAtTime(base, at);
          gg.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
          o.connect(bp);
          bp.connect(gg);
          gg.connect(bgGain);
          o.start(at);
          o.stop(at + 0.07);
        }

        // Fill: snare extra antes del cambio (solo en patrón 0).
        if (percPattern === 0 && variant === 3 && bar === loopBars - 1) {
          snare(t + beatLen * 3.5);
          snare(t + beatLen * 3.75);
        }

        // Pluck synth: varias frases de notas y ritmos.
        var pluckNoteSets = [
          [440, 523.25, 659.25, 523.25],
          [587.33, 440, 783.99, 659.25],
          [523.25, 659.25, 440, 587.33],
          [392, 523.25, 659.25, 392],
          [659.25, 783.99, 523.25, 659.25],
          [440, 554.37, 659.25, 440],
          [783.99, 659.25, 523.25, 783.99],
          [523.25, 440, 587.33, 659.25],
          [554.37, 659.25, 880, 659.25],
          [369.99, 440, 523.25, 440]
        ];
        var pluckRhythms = [
          [0.5, 1.5, 2.5, 3.5],
          [0, 1, 2, 3],
          [0.25, 1.25, 2.25, 3.25],
          [0.5, 1, 2.5, 3],
          [0, 0.5, 2, 2.5],
          [0.25, 1.5, 2.25, 3.5],
          [0, 1.5, 2, 3.5],
          [0.5, 1.25, 2.5, 3.25],
          [0, 1, 2.5, 3.5],
          [0.25, 1, 2.25, 3]
        ];
        var pNotes = pluckNoteSets[phraseIndex % pluckNoteSets.length];
        var pBeats = pluckRhythms[phraseIndex % pluckRhythms.length];
        for (var p = 0; p < pBeats.length; p++) {
          pluckSynth(t + beatLen * pBeats[p], pNotes[p % pNotes.length], phraseIndex);
        }

        // Bell synth: varias frases de notas y patrones (en qué tiempos suena).
        var bellNoteSets = [
          [1760, 2093], [2093, 2637], [2637, 2093], [2349.32, 1760], [2093, 2349.32],
          [1760, 2637], [2793.83, 2093], [2093, 1760], [2637, 2349.32], [2349.32, 2637]
        ];
        var bellPatterns = [
          [0, 2], [0, 1, 2, 3], [0, 2], [1, 3], [0, 3],
          [0, 2], [0, 1.5, 3], [1, 2], [0, 2.5], [0, 2, 3]
        ];
        var bNotes = bellNoteSets[phraseIndex % bellNoteSets.length];
        var bBeats = bellPatterns[phraseIndex % bellPatterns.length];
        for (var b = 0; b < bBeats.length; b++) {
          bellSynth(t + beatLen * bBeats[b], bNotes[b % bNotes.length], phraseIndex);
        }
      }
      hook(from, variant, phraseIndex);
      hook(from + beatLen * 4, variant, phraseIndex);
      if (phraseIndex === 0 || phraseIndex === 3) futurePad(from, loopLen, phraseIndex);
      if (phraseIndex === 1 || phraseIndex === 5 || phraseIndex === 8) stringsPad(from, loopLen, phraseIndex);
      if (variant === 1 || variant === 3) riser(from + loopLen - beatLen * 0.6);
      loopIndex++;
    }

    // Scheduler estable (lookahead) para que no “cambie el compás”.
    var lookaheadMs = 25;
    var scheduleAheadTime = 0.25;
    var nextLoopTime = ac.currentTime + 0.05;

    function scheduler() {
      var now = ac.currentTime;
      while (nextLoopTime < now + scheduleAheadTime) {
        scheduleLoop(nextLoopTime);
        nextLoopTime += loopLen;
      }
    }
    scheduler();
    setInterval(scheduler, lookaheadMs);
  }

  function setBgMusicVolume(v) {
    bgMusicVolume = Math.max(0, Math.min(1, v));
    if (bgMusicNode && bgMusicNode.volume !== undefined) bgMusicNode.volume = bgMusicVolume;
    if (bgGain) bgGain.gain.value = bgMusicVolume * 0.75; // Consistente con startBgMusicProcedural
  }

  /* ── Heartbeat: latido para tensión dramática ── */
  let heartbeatInterval = null;
  let heartbeatActive = false;

  function playHeartbeat(fast) {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const bpm = fast ? 0.28 : 0.5;

    // Sub bajo para el "thump"
    function beat(time) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(out);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(55, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.15);
      gain.gain.setValueAtTime(fast ? 0.35 : 0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
      osc.start(time);
      osc.stop(time + 0.25);
    }

    // Doble latido: lub-dub
    const now = ac.currentTime;
    beat(now);
    beat(now + 0.12);
  }

  function startHeartbeat(level) {
    if (heartbeatActive && heartbeatActive === level) return;
    stopHeartbeat();
    heartbeatActive = level;
    const intervalMs = level >= 2 ? 400 : 800;
    playHeartbeat(level >= 2);
    heartbeatInterval = setInterval(() => playHeartbeat(level >= 2), intervalMs);
  }

  function stopHeartbeat() {
    heartbeatActive = false;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  /* ── Combo sound: escalating pling ── */
  function playComboSound(comboLevel) {
    const ac = getContext();
    if (!ac) return;
    const out = getSfxOutput();
    if (!out) return;
    const now = ac.currentTime;
    // Escala ascendente según combo
    const baseFreq = 400 + comboLevel * 100;
    const notes = [0, 4, 7, 12]; // Arpegio mayor
    notes.forEach((semi, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(out);
      const freq = baseFreq * Math.pow(2, semi / 12);
      osc.frequency.value = freq;
      osc.type = comboLevel >= 5 ? 'sawtooth' : 'triangle';
      const t = now + i * 0.06;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }

  global.ArcadeAudio = {
    play, getContext, resume, startBgMusic, setBgMusicVolume, setSfxVolume, setSfxPreset,
    playComboSound
  };
})(typeof window !== 'undefined' ? window : global);
