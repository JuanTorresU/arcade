#!/usr/bin/env node
/**
 * Servidor estático para los juegos.
 * Sirve la carpeta games/ con soporte de directorios (snake/, tetris/, etc.).
 * Solo módulos built-in de Node — sin dependencias externas.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..', 'games');
const MIMES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, ''));

  // Si la ruta apunta a un directorio, servir su index.html
  try {
    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (e) { /* no existe, se resuelve abajo */ }

  const ext = path.extname(filePath);
  const mime = MIMES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('[Arcade] Sirviendo juegos en http://localhost:' + PORT);
  console.log('  Menu:   http://localhost:' + PORT + '/');
  console.log('  Snake:  http://localhost:' + PORT + '/snake/');
  console.log('  Tetris: http://localhost:' + PORT + '/tetris/');
});
