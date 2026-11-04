const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') url = '/index.html';
  const file = path.join(__dirname, 'public', url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.css':  'text/css; charset=utf-8'
    }[ext] || 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function genRoomCode() {
  for (let tries = 0; tries < 500; tries++) {
    const code = String(Math.floor(100 + Math.random() * 900));
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.slot = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = genRoomCode();
      rooms.set(code, { players: [ws, null], ready: [false, false] });
      ws.roomCode = code;
      ws.slot = 0;
      send(ws, { type: 'created', roomId: code, slot: 0 });
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.roomId || '').trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'error', message: 'Комната не найдена: ' + code }); return; }
      if (room.players[1]) { send(ws, { type: 'error', message: 'Комната уже заполнена' }); return; }
      room.players[1] = ws;
      ws.roomCode = code;
      ws.slot = 1;
      send(ws, { type: 'joined', roomId: code, slot: 1 });
      send(room.players[0], { type: 'opponent-joined' });
      console.log('Комната', code, '— подключился второй игрок');
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const opp = room.players[1 - ws.slot];
    if (!opp) return;

    if (msg.type === 'fleet-ready') {
      room.ready[ws.slot] = true;
      if (room.ready[0] && room.ready[1]) {
        const first = Math.random() < 0.5 ? 0 : 1;
        send(room.players[0], { type: 'start', yourTurn: first === 0 });
        send(room.players[1], { type: 'start', yourTurn: first === 1 });
      } else {
        send(opp, { type: 'opponent-ready' });
      }
      return;
    }

    if (msg.type === 'shot') {
      send(opp, { type: 'opponent-shot', r: msg.r, c: msg.c });
      return;
    }

    if (msg.type === 'shot-result') {
      send(opp, msg);
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const opp = room.players[1 - ws.slot];
    if (opp) send(opp, { type: 'opponent-left' });
    room.players[ws.slot] = null;
    if (!room.players[0] && !room.players[1]) {
      rooms.delete(ws.roomCode);
    }
  });
});

server.listen(PORT, () => {
  console.log(`⚓ Морской бой онлайн: http://localhost:${PORT}`);
});
