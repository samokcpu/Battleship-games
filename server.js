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
      rooms.set(code, { players: [ws, null], turn: 0, gameMode: msg.gameMode || 'battleship' });
      ws.roomCode = code;
      ws.slot = 0;
      send(ws, { type: 'created', roomId: code, slot: 0, gameMode: msg.gameMode });
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.roomId || '').trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'error', message: 'Комната не найдена' }); return; }
      if (room.players[1]) { send(ws, { type: 'error', message: 'Комната уже заполнена' }); return; }
      
      room.players[1] = ws;
      ws.roomCode = code;
      ws.slot = 1;
      
      send(ws, { type: 'joined', roomId: code, slot: 1, gameMode: room.gameMode });
      
      if (room.gameMode === 'chess') {
        // Рандомный выбор цвета
        const firstIsWhite = Math.random() < 0.5;
        send(room.players[0], { type: 'start-chess', yourTurn: firstIsWhite, color: firstIsWhite ? 'w' : 'b' });
        send(room.players[1], { type: 'start-chess', yourTurn: !firstIsWhite, color: firstIsWhite ? 'b' : 'w' });
      } else {
        send(room.players[0], { type: 'opponent-joined' });
        send(room.players[1], { type: 'opponent-joined' }); 
      }
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const opp = room.players[1 - ws.slot];
    if (!opp) return;

    if (msg.type === 'chess-move') {
      // Просто пересылаем ход сопернику, не меняем room.turn (клиенты сами знают чей ход)
      send(opp, { 
        type: 'opponent-move', 
        from: msg.from, 
        to: msg.to, 
        promotion: msg.promotion
      });
      return;
    }

    if (msg.type === 'chess-draw-offer') { send(opp, { type: 'chess-draw-offer' }); return; }
    if (msg.type === 'chess-draw-accept') { send(opp, { type: 'chess-draw-accept' }); return; }

    if (msg.type === 'fleet-ready') {
      room.ready = room.ready || [false, false];
      room.ready[ws.slot] = true;
      if (room.ready[0] && room.ready[1]) {
        const first = Math.random() < 0.5 ? 0 : 1;
        room.turn = first;
        send(room.players[0], { type: 'start', yourTurn: first === 0 });
        send(room.players[1], { type: 'start', yourTurn: first === 1 });
      } else {
        send(opp, { type: 'opponent-ready' });
      }
      return;
    }

    if (msg.type === 'shot') {
      if (room.turn !== ws.slot) return; 
      send(opp, { type: 'opponent-shot', r: msg.r, c: msg.c });
      return;
    }

    if (msg.type === 'shot-result') {
      if (msg.result === 'miss') {
        room.turn = 1 - room.turn;
      }
      send(opp, msg);
      send(room.players[0], { type: 'turn-update', yourTurn: room.turn === 0 });
      send(room.players[1], { type: 'turn-update', yourTurn: room.turn === 1 });
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
  console.log(`⚓ Игровой портал: http://localhost:${PORT}`);
});
