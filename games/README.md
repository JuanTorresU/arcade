# Games — Core multijuego

Cada juego (Snake, Tetris, futuros) se integra con el mismo **Control Server**, **overlay** y **sistema de sonidos**.

## Estructura

```
games/
├── index.html              # Menú de selección de juegos
├── shared/                 # Código compartido entre todos los juegos
│   ├── audio.js            # Sistema de sonidos (SFX + música)
│   ├── main.js             # Core: WebSocket, combos, Donor War, overlay
│   └── styles.css          # Estilos globales (neón, gradientes, etc.)
├── snake/                  # Snake
│   ├── index.html          # Página del juego
│   ├── engine.js           # Motor del juego
│   └── bot.js              # Bot autoplayer
└── tetris/                 # Tetris
    ├── index.html          # Página del juego
    ├── engine.js           # Motor del juego
    └── bot.js              # Bot autoplayer
```

## Contrato del Engine

Cada juego expone en `global` (window) un objeto con esta API:

| Método | Descripción |
|--------|-------------|
| `applyEffect(type, value)` | Aplica efecto: `speed`, `kill`, `invert`, `nuke`, `chaos`, `shield`, `bonus`, `reset`, etc. |
| `getState()` | Devuelve `{ score, highScore, gameOver, ... }`. |
| `onEffect(fn)` | Registra listener `(type, value)` para SFX y visuales. |
| `resetGame()` | Reinicia la partida. |
| `isGameOver()` | `true` si la partida terminó. |

## Contrato del Bot

| Método | Descripción |
|--------|-------------|
| `setEngine(api)` | Recibe la API del engine. |
| `start(ms)` | Inicia el autoplayer. |
| `stop()` | Detiene el bot. |

## Cómo añadir un nuevo juego

1. Crear `games/mi-juego/engine.js` → expone `global.MiJuegoEngine`.
2. Crear `games/mi-juego/bot.js` → expone `global.MiJuegoBot`.
3. En `shared/main.js`, añadir detección en `getEngine()` / `getBot()` / `getCommandMap()`.
4. Crear `games/mi-juego/index.html` cargando `../shared/audio.js`, `engine.js`, `bot.js`, `../shared/main.js`.
5. Añadir tarjeta en `games/index.html`.

## Rutas

| URL | Página |
|-----|--------|
| `http://localhost:3000/` | Menú de juegos |
| `http://localhost:3000/snake/` | Snake |
| `http://localhost:3000/tetris/` | Tetris |
