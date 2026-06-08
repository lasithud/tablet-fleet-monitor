'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const deviceManager = require('./deviceManager');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json());

// Permissive CORS — this server only listens locally and the dashboard runs on
// the Vite dev origin (:5173). No auth in v1 (see PRD §13).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

// GET /api/devices — config + current status of all devices
app.get('/api/devices', (_req, res) => {
  res.json({
    devices: deviceManager.getAll(),
    targetApp: deviceManager.targetApp,
    pollIntervalSeconds: deviceManager.pollIntervalSeconds,
  });
});

// GET /api/devices/:id/status — refresh status for one device
app.get('/api/devices/:id/status', async (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const updated = await deviceManager.refresh(req.params.id);
  res.json(updated);
});

// POST /api/devices/:id/connect — port scan + adb connect
app.post('/api/devices/:id/connect', async (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const updated = await deviceManager.connect(req.params.id);
  res.json({ ok: !!(updated && updated.adbConnected), device: updated });
});

// POST /api/devices/:id/launch-kiosk — launch de.ozerov.fully
app.post('/api/devices/:id/launch-kiosk', async (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const result = await deviceManager.launchKiosk(req.params.id);
  res.status(result.ok ? 200 : 409).json(result);
});

// POST /api/devices/:id/mirror — spawn scrcpy process
app.post('/api/devices/:id/mirror', (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const result = deviceManager.mirror(req.params.id);
  res.status(result.ok ? 200 : 409).json(result);
});

// POST /api/devices/:id/kill-foreground — force-stop current app
app.post('/api/devices/:id/kill-foreground', async (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const result = await deviceManager.killForeground(req.params.id);
  res.status(result.ok ? 200 : 409).json(result);
});

// POST /api/devices/connect-all — connect all devices
app.post('/api/devices/connect-all', async (_req, res) => {
  const devices = await deviceManager.connectAll();
  res.json({ devices });
});

// POST /api/devices/launch-kiosk-all — launch kiosk on all connected devices
app.post('/api/devices/launch-kiosk-all', async (_req, res) => {
  const results = await deviceManager.launchKioskAll();
  res.json({ results });
});

// ---------------------------------------------------------------------------
// FleetAgent endpoints — the on-device APK phones home here.
// These are the reliable, reboot-proof path (no adb, no Wireless Debugging).
// ---------------------------------------------------------------------------

// POST /api/agent/heartbeat — device reports its current state.
// Body: { id, foregroundApp, battery, screenOn }
app.post('/api/agent/heartbeat', (req, res) => {
  const { id, foregroundApp, battery, screenOn } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing device id' });
  const dev = deviceManager.recordHeartbeat(id, { foregroundApp, battery, screenOn });
  if (!dev) return res.status(404).json({ error: 'Unknown device id' });
  // Reply with any pending commands so the agent can act in the same round-trip.
  res.json({ ok: true, commands: deviceManager.drainCommands(id) });
});

// GET /api/agent/commands?id=room-1 — device drains its command queue.
// (Separate from heartbeat for agents that poll commands more often than they report.)
app.get('/api/agent/commands', (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing device id' });
  if (!deviceManager.get(id)) return res.status(404).json({ error: 'Unknown device id' });
  res.json({ commands: deviceManager.drainCommands(id) });
});

// ---------------------------------------------------------------------------
// WebSocket — push live updates to connected dashboards
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** Broadcast a typed event to every connected dashboard. */
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

// Bridge DeviceManager events -> WebSocket frames.
deviceManager.on('device:status', (d) => broadcast('device:status', d));
deviceManager.on('device:connected', (d) => broadcast('device:connected', d));
deviceManager.on('device:disconnected', (d) => broadcast('device:disconnected', d));
deviceManager.on('adb:log', (line) => broadcast('adb:log', line));

wss.on('connection', (ws) => {
  // Send the current snapshot immediately so a fresh client isn't blank.
  ws.send(
    JSON.stringify({
      type: 'snapshot',
      payload: deviceManager.getAll(),
      ts: new Date().toISOString(),
    })
  );
});

// ---------------------------------------------------------------------------
// Polling loop — refresh all devices every pollIntervalSeconds (PRD §4)
// ---------------------------------------------------------------------------

function startPolling() {
  const intervalMs = deviceManager.pollIntervalSeconds * 1000;
  setInterval(() => {
    deviceManager.refreshAll().catch((e) => broadcast('adb:log', `poll error: ${e.message}`));
  }, intervalMs);
}

server.listen(PORT, () => {
  console.log(`[fleet-monitor] backend listening on http://localhost:${PORT}`);
  console.log(`[fleet-monitor] websocket on ws://localhost:${PORT}`);

  // Attempt to connect every configured device on startup, then begin polling.
  deviceManager
    .connectAll()
    .then(() => console.log('[fleet-monitor] initial connect-all complete'))
    .catch((e) => console.error('[fleet-monitor] initial connect failed:', e.message))
    .finally(startPolling);
});
