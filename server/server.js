const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const SHARED_SECRET = process.env.SHARED_SECRET || 'change-me-please';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map();
const pending = new Map();

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const toUser = (id, o) => (clients.get(id) || []).forEach(ws => send(ws, o));

wss.on('connection', (ws) => {
  ws.userId = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'register') {
      if (m.secret !== SHARED_SECRET) { send(ws, { type: 'error', message: 'bad secret' }); return ws.close(); }
      ws.userId = m.user;
      if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
      clients.get(ws.userId).add(ws);
      send(ws, { type: 'registered', user: ws.userId });
      const from = pending.get(ws.userId);
      if (from) send(ws, { type: 'incoming', from });
      return;
    }
    if (!ws.userId) return;

    // --- NEW: Handle the keep-alive ping from the app ---
    if (m.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }

    if (m.type === 'call') {
      pending.set(m.to, ws.userId);
      toUser(m.to, { type: 'call', from: ws.userId });
      return;
    }
    if (m.type === 'cancel') { pending.delete(m.to); toUser(m.to, { type: 'cancel', from: ws.userId }); return; }
    if (m.type === 'accept') { pending.delete(ws.userId); toUser(m.to, { type: 'peer-ready', from: ws.userId }); return; }

    if (['offer', 'answer', 'ice', 'bye'].includes(m.type)) {
      toUser(m.to, { ...m, from: ws.userId });
      if (m.type === 'bye') pending.delete(ws.userId);
    }
  });

  ws.on('close', () => {
    const s = clients.get(ws.userId);
    if (s) { s.delete(ws); if (!s.size) clients.delete(ws.userId); }
  });
});

server.listen(PORT, () => console.log('listening on ' + PORT));