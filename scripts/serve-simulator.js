#!/usr/bin/env node
var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = Number(process.env.PORT) || 3001;
var ROOT = path.join(__dirname, '..', 'simulator');
var MIMES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

var server = http.createServer(function (req, res) {
  var file = req.url === '/' ? '/donate-simulator.html' : req.url;
  file = path.join(ROOT, path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, ''));
  var ext = path.extname(file);
  var mime = MIMES[ext] || 'application/octet-stream';
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('[Simulador] http://localhost:' + PORT);
});
