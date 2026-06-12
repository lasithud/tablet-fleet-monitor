'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const deviceManager = require('./deviceManager');
const { authEnabled, requireAuth, wsTokenValid } = require('./auth');

// Built React dashboard (vite build output). Served from the same origin as the
// API so the whole system is one deployable URL that any laptop can open.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');

// Built FleetAgent APK — served at /agent.apk so any tablet on the tailnet can
// install it from a browser (no adb / same-subnet needed for provisioning).
const APK_PATH = path.join(
  __dirname,
  '..',
  'fleet-agent',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk'
);

const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json());

// Permissive CORS — harmless when the dashboard is served same-origin, and lets
// the Vite dev server (:5173) talk to a separate backend during development.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Fleet-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// Public endpoints (no token) — used before/without auth.
// ---------------------------------------------------------------------------

// GET /api/health — uptime/readiness probe.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// GET /api/public-config — tells the dashboard whether to show a login gate.
app.get('/api/public-config', (_req, res) => res.json({ authRequired: authEnabled }));

// ---------------------------------------------------------------------------
// Everything below requires the shared token (no-op when FLEET_TOKEN is unset).
// ---------------------------------------------------------------------------
app.use('/api/devices', requireAuth);
app.use('/api/agent', requireAuth);

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

// GET /agent.apk — download the FleetAgent APK (for installing on a new tablet)
app.get('/agent.apk', (_req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).send('APK not built yet — run the build, then retry.');
  }
  res.download(APK_PATH, 'fleet-agent.apk');
});

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

// POST /api/devices/:id/screen-on — queue a wake-screen command for the agent
app.post('/api/devices/:id/screen-on', (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const result = deviceManager.wakeScreen(req.params.id);
  res.status(result.ok ? 200 : 409).json(result);
});

// POST /api/devices/:id/brightness — set screen brightness (0-100) via the agent
app.post('/api/devices/:id/brightness', (req, res) => {
  const dev = deviceManager.get(req.params.id);
  if (!dev) return res.status(404).json({ error: 'Unknown device' });
  const result = deviceManager.setBrightness(req.params.id, req.body && req.body.level);
  res.status(result.ok ? 200 : 400).json(result);
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

// POST /api/devices/exit-kiosk-all — exit kiosk (go home) on all online devices
app.post('/api/devices/exit-kiosk-all', (_req, res) => {
  res.json(deviceManager.exitKioskAll());
});

// POST /api/devices/brightness-all — set brightness on all online devices (default 70)
app.post('/api/devices/brightness-all', (req, res) => {
  const level = req.body && req.body.level != null ? req.body.level : 70;
  res.json(deviceManager.setBrightnessAll(level));
});

// ---------------------------------------------------------------------------
// FleetAgent endpoints — the on-device APK phones home here.
// These are the reliable, reboot-proof path (no adb, no Wireless Debugging).
// ---------------------------------------------------------------------------

// POST /api/agent/heartbeat — device reports its current state.
// Body: { id, foregroundApp, battery, screenOn }
app.post('/api/agent/heartbeat', (req, res) => {
  const { id, foregroundApp, battery, screenOn, charging, brightness } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing device id' });
  const dev = deviceManager.recordHeartbeat(id, {
    foregroundApp,
    battery,
    screenOn,
    charging,
    brightness,
  });
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
// Static dashboard — serve the built React app from the same origin, with a
// SPA fallback so deep links work. Skipped gracefully if not built yet.
// ---------------------------------------------------------------------------

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res, next) => {
    // Never swallow API/agent routes — let them 404 as JSON.
    if (req.path.startsWith('/api') || req.path === '/agent.apk') return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  console.warn('[fleet-monitor] frontend/dist not found — run `npm run build` to serve the dashboard');
}

// ---------------------------------------------------------------------------
// WebSocket — push live updates to connected dashboards
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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

wss.on('connection', (ws, req) => {
  // Reject dashboards that didn't present a valid token (?token=...).
  if (!wsTokenValid(req)) {
    ws.close(1008, 'Unauthorized');
    return;
  }
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
  console.log(`[fleet-monitor] websocket on ws://localhost:${PORT}/ws`);
  console.log(
    `[fleet-monitor] auth: ${authEnabled ? 'ENABLED (FLEET_TOKEN set)' : 'DISABLED (set FLEET_TOKEN to require a token)'}`
  );

  // Begin status polling immediately so offline detection isn't delayed by the
  // (potentially slow) startup adb connect/scan.
  startPolling();

  // Attempt to connect adb-managed devices in the background (best effort).
  deviceManager
    .connectAll()
    .then(() => console.log('[fleet-monitor] initial connect-all complete'))
    .catch((e) => console.error('[fleet-monitor] initial connect failed:', e.message));
});
