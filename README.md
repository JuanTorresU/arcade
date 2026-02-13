# Arcade Bot Network — Snake MVP

Sistema autónomo de micro-juegos arcade conectados a TikTok Live. El bot juega Snake en el navegador; los regalos del live se traducen en castigos/efectos en tiempo real. Diseñado para **OBS** y operación automatizada.

## Arquitectura

```
[ TikTok Live ]
       ↓
[ Listener (Python) ]  ← TikTokLive API
       ↓
[ Control Server (Node.js + WebSocket :8765) ]
       ↓
[ Game Engine (Snake) + Overlay ]
       ↓
[ OBS / Stream ]
```

## Estructura del proyecto

```
arcade/
├── configs/
│   ├── gift-to-command.json   # Mapping regalo → comando (no hardcodear)
│   └── commands.json          # Descripción y cooldowns
├── core/
│   └── game-engine/           # Snake HTML5 + API applyEffect(type, value)
├── bot/                       # Lógica autoplayer (en game-engine/bot.js)
├── control/
│   └── server.js              # WebSocket server
├── listener/
│   ├── requirements.txt
│   └── tiktok_listener.py     # Conector TikTok → eventos normalizados
├── overlay/                   # UI standalone (opcional)
└── package.json
```

## Requisitos

- **Node.js** ≥ 18
- **Python 3** (para el listener)
- Navegador moderno (Chrome recomendado para OBS)

## Instalación

```bash
cd arcade
npm install
pip install -r listener/requirements.txt
```

## Uso

### 1. Arrancar el Control Server

```bash
npm start
```

Deja corriendo. Escucha en `ws://localhost:8765`.

### 2. Servir el juego (para OBS)

```bash
npm run start:game
```

Abre en el navegador **http://localhost:3000**. Captura esta ventana/URL en OBS (Capture de ventana o Browser Source).

### 3. Conectar TikTok Live (opcional)

```bash
export TIKTOK_USERNAME=tu_usuario_tiktok
npm run listener
```

Sustituye `tu_usuario_tiktok` por el usuario que hace el live. Los regalos/likes/follows se envían al Control Server y se traducen a comandos según `configs/gift-to-command.json`.

### Arrancar todo a la vez

```bash
npm run start:all
```

(Ejecuta servidor + juego en paralelo.)

### Simular donaciones (sin TikTok Live)

Para probar regalos sin estar en vivo:

1. Arranca el Control Server (`npm start`) y el juego (`npm run start:game`).
2. Abre el simulador: `npm run start:simulator` y entra en **http://localhost:3001**, o abre directamente el archivo `simulator/donate-simulator.html` en el navegador.
3. Escribe un nombre de usuario y haz clic en un regalo. El evento se envía al server y el juego reacciona en tiempo real y actualiza el top de donadores.

## Configuración de eventos (fuente única)

**Todo el overlay, juego y simulador leen la misma config.** Edita **`configs/gifts.json`** (fuente única de verdad). El Control Server la carga y envía `giftsConfig` a cada cliente al conectar. No edites regalos en el código del overlay ni del simulador.

Estructura de cada regalo en `gifts.json`: `id`, `emoji`, `command`, `team` (`"help"` o `"destroy"`), `label`. Los 6 poderes actuales:

### 💀 DESTROY

| Regalo  | Comando    | Efecto en el juego                           |
|---------|-----------|----------------------------------------------|
| 🌹 Rose | SPEED_UP  | Acelera la serpiente                          |
| 💣 Bomb | NUKE      | Corta el cuerpo a solo 3 segmentos           |
| 🐉 Dragon | CHAOS   | Invierte controles + velocidad extrema        |

### 🛡 HELP

| Regalo    | Comando       | Efecto en el juego                        |
|-----------|--------------|-------------------------------------------|
| 🛡 TikTok | SHIELD       | Escudo protector: inmunidad durante 3s     |
| 🍎 Fruit  | SPAWN_FRUITS | Lluvia de 50 frutas en el mapa             |
| 🦁 Lion   | BONUS_POINTS | Regala 100 puntos de golpe                 |

Para **añadir o quitar regalos**: edita solo `configs/gifts.json` y reinicia el Control Server (`npm start`). El juego, overlay y simulador se actualizarán al reconectar.

## API del motor (Snake)

Desde la consola del navegador o vía WebSocket:

```js
SnakeEngine.applyEffect("speed", 2);      // más rápido
SnakeEngine.applyEffect("nuke");           // corta cuerpo a 3
SnakeEngine.applyEffect("chaos");          // invert + speed + slow
SnakeEngine.applyEffect("shield", 3000);   // inmunidad 3s
SnakeEngine.applyEffect("spawnFruits", 50);// lluvia de frutas
SnakeEngine.applyEffect("bonus", 100);     // +100 puntos
SnakeEngine.getState();                    // score, snake, gameOver, etc.
```

## Sonidos

El motor incluye sonidos procedurales (Web Audio API): explosión en RESET, whoosh en SPEED, alarma en muerte, tonos al comer. Opcionalmente puedes sustituir por archivos `.wav` en `games/shared/sounds/` y cargarlos en `audio.js`.

### Música de fondo (estilo viral TikTok)

- **Por defecto:** si no hay archivo, suena un loop procedural tipo TikTok (beat, bajo, melodía corta a 120 BPM).
- **Tu propia pista:** para usar una canción o sonido viral (respetando derechos de autor), guarda un archivo **`bg-music.mp3`** en **`games/shared/sounds/`**. El juego lo pondrá en loop. Puedes usar:
  - Sonidos de la **biblioteca de TikTok** (Creators → sonidos con licencia para uso en la app).
  - Música libre / royalty-free con estilo “TikTok” (ej. Pixabay, Uppbeat, TikTok Sound Collection) descargada y guardada como `games/shared/sounds/bg-music.mp3`.
- Volumen: `ArcadeAudio.setBgMusicVolume(0.25)` (0–1).

### Sonido automático / OBS

El juego intenta activar el audio sin interacción del usuario. Si el navegador lo bloquea (política de autoplay), prueba:

- **OBS Browser Source:** añade una fuente “Browser” con la URL del juego (ej. `http://localhost:3000`). El navegador embebido de OBS a veces permite audio sin gesto.
- **Chrome con flag:** para que Chrome permita sonido sin clic, ejecútalo con  
  `--autoplay-policy=no-user-gesture-required`  
  (en macOS: `open -a "Google Chrome" --args --autoplay-policy=no-user-gesture-required`).
- **Permisos del sitio:** en Chrome ve a `chrome://settings/content/sound`, añade la URL del juego (ej. `http://localhost:3000`) como permitida para que el sonido se reproduzca automáticamente.

## Métricas

El motor registra: muertes, tiempo vivo, score, regalos y usuarios. Acceso vía `SnakeEngine.getState().metrics`.

### Registro en localStorage

- **`arcade_donors_alltime`** — Totales por usuario (historia). Usado para el “Rey donador (historia)”.
- **`arcade_gifts_log`** — Lista de todos los regalos: cada entrada es `{ user, id, name, count, time }`. Se guarda automáticamente cada donación; se mantienen las últimas 5000 entradas.

## Roadmap

- **Fase 1 (MVP):** Snake + bot + listener + OBS + 3 castigos ✅
- **Fase 2:** Ranking, persistencia, overlay estable, más sonidos
- **Fase 3:** Más juegos, multi-cuentas, panel central

## Licencia

Uso interno / proyecto personal.
