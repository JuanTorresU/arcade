#!/usr/bin/env node
/**
 * Control Server — Event Hub
 * Carga configs/gifts.json (fuente única). Envía giftsConfig + goals a cada cliente al conectar.
 * Implementa cooldowns reales por comando para evitar spam.
 */
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = 8765;
let giftToCommand = {};
let giftsList = [];
let goalsConfig = [];
let commandsConfig = {};
let clients = new Set();

/* ═══════════════════════════════════
   COOLDOWN SYSTEM
   ═══════════════════════════════════ */
const cooldowns = {}; // { commandName: lastExecutedTimestamp }

function canExecute(cmd) {
  const config = commandsConfig[cmd];
  if (!config || !config.cooldownMs) return true;
  const now = Date.now();
  const last = cooldowns[cmd] || 0;
  if (now - last < config.cooldownMs) {
    const remaining = Math.ceil((config.cooldownMs - (now - last)) / 1000);
    console.log('[Control] Cooldown activo para', cmd, '- faltan', remaining, 's');
    return false;
  }
  cooldowns[cmd] = now;
  return true;
}

/* ═══════════════════════════════════
   CONFIG LOADING
   ═══════════════════════════════════ */
function loadGiftsConfig() {
  const giftsPath = path.join(__dirname, '..', 'configs', 'gifts.json');
  try {
    const raw = fs.readFileSync(giftsPath, 'utf8');
    const data = JSON.parse(raw);
    giftsList = Array.isArray(data.gifts) ? data.gifts : [];
    goalsConfig = Array.isArray(data.goals) ? data.goals : [];
    giftToCommand = {};
    giftsList.forEach(function (g) {
      if (g.id && g.command) giftToCommand[g.id] = g.command;
    });
    console.log('[Control] gifts.json cargado:', giftsList.length, 'regalos,', goalsConfig.length, 'metas');
  } catch (e) {
    console.warn('[Control] No se pudo cargar configs/gifts.json:', e.message);
    giftsList = [
      { id: 'Rose', emoji: '🌹', command: 'SPEED_UP', team: 'destroy', label: 'Velocidad', tier: 1 },
      { id: 'Bomb', emoji: '💣', command: 'NUKE', team: 'destroy', label: 'Nuke', tier: 2 },
      { id: 'Dragon', emoji: '🐉', command: 'CHAOS', team: 'destroy', label: 'Caos', tier: 2 },
      { id: 'TikTok', emoji: '🛡', command: 'SHIELD', team: 'help', label: 'Shield', tier: 2 },
      { id: 'Fruit', emoji: '🍎', command: 'SPAWN_FRUITS', team: 'help', label: 'Frutas', tier: 1 },
      { id: 'Lion', emoji: '🦁', command: 'BONUS_POINTS', team: 'help', label: '+100 pts', tier: 3 }
    ];
    giftToCommand = { Rose: 'SPEED_UP', Bomb: 'NUKE', Dragon: 'CHAOS', TikTok: 'SHIELD', Fruit: 'SPAWN_FRUITS', Lion: 'BONUS_POINTS' };
  }
}

function loadCommandsConfig() {
  const cmdPath = path.join(__dirname, '..', 'configs', 'commands.json');
  try {
    const raw = fs.readFileSync(cmdPath, 'utf8');
    commandsConfig = JSON.parse(raw);
    console.log('[Control] commands.json cargado:', Object.keys(commandsConfig).length, 'comandos');
  } catch (e) {
    console.warn('[Control] No se pudo cargar configs/commands.json:', e.message);
    commandsConfig = {};
  }
}

function translateToCommand(eventType, eventId, name, count) {
  const key = (name || eventId || eventType || '').trim();
  const cmd = giftToCommand[key] || giftToCommand[eventId] || giftToCommand[eventType];
  if (cmd) return { cmd, value: count };
  return null;
}

function getGiftInfo(eventId, eventName) {
  const key = (eventName || eventId || '').trim();
  return giftsList.find(g => g.id === key || g.id === eventId) || null;
}

function broadcast(msg) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  clients.forEach(function (ws) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function sendGiftsConfig(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({
      type: 'giftsConfig',
      gifts: giftsList,
      goals: goalsConfig
    }));
  } catch (e) {
    console.warn('[Control] Error enviando giftsConfig:', e.message);
  }
}

function handleEvent(event) {
  const type = event.type;
  const id = event.id;
  const name = event.name;
  const count = event.count;
  const user = event.user;
  const translated = translateToCommand(type, id, name, count);
  if (translated) {
    // Verificar cooldown
    if (!canExecute(translated.cmd)) {
      // Aún así enviamos el evento visual (para animaciones), pero sin el comando
      broadcast({ type: 'event', event: { type, id, name, count, user, emoji: event.emoji } });
      return;
    }
    const giftInfo = getGiftInfo(id, name);
    console.log('[Control]', type, id, '->', translated.cmd, giftInfo ? '(tier ' + giftInfo.tier + ')' : '');
    broadcast({ cmd: translated.cmd, value: translated.value, giftInfo: giftInfo });
    broadcast({ type: 'event', event: { type, id, name, count, user, emoji: event.emoji } });
  }
}

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', function (ws) {
  clients.add(ws);
  console.log('[Control] Cliente conectado. Total:', clients.size);
  sendGiftsConfig(ws);

  ws.on('message', function (raw) {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.cmd) broadcast(msg);
      if (msg.event) handleEvent(msg.event);
      if (msg.type === 'config' && msg.config) {
        console.log('[Control] config -> broadcast', Object.keys(msg.config || {}).join(','));
        broadcast({ type: 'config', config: msg.config });
      }
    } catch (e) {
      console.warn('[Control] Mensaje inválido:', raw.toString().slice(0, 80));
    }
  });
  ws.on('close', function () {
    clients.delete(ws);
    console.log('[Control] Cliente desconectado. Total:', clients.size);
  });
});

loadGiftsConfig();
loadCommandsConfig();
console.log('[Control] WebSocket server en ws://localhost:' + PORT);
console.log('[Control] Cooldowns activos para:', Object.entries(commandsConfig).filter(([k, v]) => v.cooldownMs).map(([k, v]) => k + ' (' + v.cooldownMs + 'ms)').join(', '));
