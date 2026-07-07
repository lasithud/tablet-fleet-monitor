'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const adb = require('./adb');

const CONFIG_PATH = path.join(__dirname, 'devices.json');

// When auto-relaunch is on and a device is reported off the kiosk app, we
// enqueue a launchFully — but no more often than this per device, so a slow
// relaunch (or a stuck app) doesn't flood the command queue.
const AUTO_RELAUNCH_COOLDOWN_MS = 25000;

/**
 * Owns the in-memory fleet state and all device operations.
 *
 * Emits (consumed by the WebSocket layer in server.js):
 *   - 'device:status'       { ...status }      a device's status was refreshed
 *   - 'device:connected'    { id, adbPort }    an ADB transport came up
 *   - 'device:disconnected' { id }             a previously-online device went offline
 *   - 'adb:log'             string             raw adb/scrcpy output
 */
class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.config = this._loadConfig();
    this.scrcpyProcs = new Map(); // id -> ChildProcess
    this.commandQueues = new Map(); // id -> string[]  (commands awaiting the agent)

    // Auto-relaunch: keep tablets pinned to the kiosk app. Enabled by default;
    // the dashboard can toggle it off as a manual override. In-memory state
    // (resets to the config default on restart/redeploy).
    this.autoRelaunch = this.config.autoRelaunch !== false;
    this._lastAutoRelaunch = new Map(); // id -> last relaunch timestamp (ms)

    // Build the live status map from config. A "device" here is config + runtime status.
    this.devices = new Map();
    for (const d of this.config.devices) {
      this.devices.set(d.id, {
        id: d.id,
        name: d.name,
        roomKey: d.roomKey || null,
        tailscaleIp: d.tailscaleIp,
        adbPort: d.lastKnownPort || null,
        adbConnected: false,
        online: false,
        foregroundApp: null,
        isOnKiosk: false,
        lastChecked: null,
        // Agent (FleetAgent APK) fields — primary source of truth post-pivot.
        lastHeartbeat: null,
        battery: null,
        screenOn: null,
        charging: null,
        brightness: null,
      });
    }

    // Forward raw adb output to listeners.
    adb.setLogSink((line) => this.emit('adb:log', line));
  }

  _loadConfig() {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  }

  /**
   * Persist updated lastKnownPort values back to devices.json.
   *
   * This is a best-effort cache only (adb port reuse). On a hosted/ephemeral
   * filesystem the write may fail or be read-only — never let that crash the
   * server, since ports are re-discovered on demand anyway.
   */
  _saveConfig() {
    for (const d of this.config.devices) {
      const dev = this.devices.get(d.id);
      if (dev) d.lastKnownPort = dev.adbPort;
    }
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2) + '\n', 'utf8');
    } catch (e) {
      this.emit('adb:log', `could not persist devices.json (non-fatal): ${e.message}`);
    }
  }

  get targetApp() {
    return this.config.targetApp;
  }

  get portScanRange() {
    return this.config.portScanRange;
  }

  get pollIntervalSeconds() {
    return this.config.pollIntervalSeconds;
  }

  /** A device counts as online if its agent has checked in this recently. */
  get agentTimeoutSeconds() {
    return this.config.agentTimeoutSeconds || 90;
  }

  /** True if the device's FleetAgent posted a heartbeat within the timeout window. */
  _heartbeatFresh(dev) {
    if (!dev.lastHeartbeat) return false;
    const ageMs = Date.now() - new Date(dev.lastHeartbeat).getTime();
    return ageMs < this.agentTimeoutSeconds * 1000;
  }

  /** Devices whose Tailscale IP has actually been configured (not the placeholder). */
  _isConfigured(dev) {
    return !!dev.tailscaleIp && !dev.tailscaleIp.includes('x');
  }

  getAll() {
    return Array.from(this.devices.values());
  }

  get(id) {
    return this.devices.get(id) || null;
  }

  /**
   * Apply a status patch, detect online->offline transitions, stamp the time,
   * and emit 'device:status'. Centralizes all mutation so events stay consistent.
   */
  _update(id, patch) {
    const dev = this.devices.get(id);
    if (!dev) return null;

    const wasOnline = dev.online;
    Object.assign(dev, patch);
    dev.lastChecked = new Date().toISOString();

    if (wasOnline && dev.online === false) {
      // Drop any queued commands so stale actions don't fire when it returns.
      this.commandQueues.set(id, []);
      this.emit('device:disconnected', { id });
    }

    this.emit('device:status', { ...dev });
    return dev;
  }

  /**
   * Recompute one device's status from both sources:
   *   - the FleetAgent heartbeat (primary, reboot-proof), and
   *   - adb (optional extra; only probed when an adb port is known).
   *
   * online = heartbeat fresh OR adb responsive. The agent's foreground-app
   * reading is preferred (it needs no adb and is the source of truth post-pivot);
   * adb's reading is used only when there's no fresh heartbeat.
   */
  async refresh(id) {
    const dev = this.devices.get(id);
    if (!dev) return null;

    const hbFresh = this._heartbeatFresh(dev);

    // Probe adb only if we actually have a port to talk to.
    let adbResponsive = false;
    let adbFg = null;
    if (this._isConfigured(dev) && dev.adbPort) {
      adbResponsive = await adb.isResponsive(dev.tailscaleIp, dev.adbPort);
      if (adbResponsive) {
        adbFg = await adb.getForegroundApp(dev.tailscaleIp, dev.adbPort);
      }
    }

    const online = hbFresh || adbResponsive;
    // Prefer the agent's foreground app; fall back to adb's when no heartbeat.
    const fg = hbFresh ? dev.foregroundApp : adbFg;

    const updated = this._update(id, {
      online,
      adbConnected: adbResponsive,
      foregroundApp: online ? fg : null,
      isOnKiosk: online ? fg === this.targetApp : false,
    });
    this._maybeAutoRelaunch(updated);
    return updated;
  }

  /**
   * Record a heartbeat from a device's FleetAgent. This is the primary status
   * path: it marks the device online, stores the reported foreground app and
   * battery/screen state, and stamps lastHeartbeat for staleness tracking.
   *
   * @param {string} id
   * @param {{ foregroundApp?: string, battery?: number, screenOn?: boolean }} data
   */
  recordHeartbeat(id, data = {}) {
    const dev = this.devices.get(id);
    if (!dev) return null;

    const fg = data.foregroundApp || null;
    const updated = this._update(id, {
      online: true,
      foregroundApp: fg,
      isOnKiosk: fg === this.targetApp,
      battery: typeof data.battery === 'number' ? data.battery : dev.battery,
      screenOn: typeof data.screenOn === 'boolean' ? data.screenOn : dev.screenOn,
      charging: typeof data.charging === 'boolean' ? data.charging : dev.charging,
      brightness:
        typeof data.brightness === 'number' && data.brightness >= 0
          ? data.brightness
          : dev.brightness,
      lastHeartbeat: new Date().toISOString(),
    });
    this._maybeAutoRelaunch(updated);
    return updated;
  }

  /**
   * If auto-relaunch is on and this device is online but sitting on something
   * other than the kiosk app, queue a launchFully to bring it back — throttled
   * per device by AUTO_RELAUNCH_COOLDOWN_MS.
   */
  _maybeAutoRelaunch(dev) {
    if (!this.autoRelaunch || !dev) return;
    if (!dev.online || !dev.foregroundApp) return; // unknown state — don't act
    if (dev.foregroundApp === this.targetApp) return; // already on kiosk

    const now = Date.now();
    if (now - (this._lastAutoRelaunch.get(dev.id) || 0) < AUTO_RELAUNCH_COOLDOWN_MS) return;
    this._lastAutoRelaunch.set(dev.id, now);

    this.enqueueCommand(dev.id, 'launchFully');
    this.emit('adb:log', `auto-relaunch: ${dev.id} on ${dev.foregroundApp} (not kiosk) → launchFully`);
  }

  /** Enable/disable the auto-relaunch watchdog (manual override from the UI). */
  setAutoRelaunch(enabled) {
    this.autoRelaunch = !!enabled;
    if (!this.autoRelaunch) this._lastAutoRelaunch.clear();
    this.emit('autoRelaunch', this.autoRelaunch);
    return this.autoRelaunch;
  }

  /** Queue a command for a device's agent to pick up on its next poll. */
  enqueueCommand(id, command) {
    if (!this.devices.has(id)) return false;
    const q = this.commandQueues.get(id) || [];
    q.push(command);
    this.commandQueues.set(id, q);
    return true;
  }

  /** Return and clear the pending commands for a device (called by the agent). */
  drainCommands(id) {
    const q = this.commandQueues.get(id) || [];
    this.commandQueues.set(id, []);
    return q;
  }

  /**
   * Port-scan + connect a device, then refresh its status.
   * Emits 'device:connected' on success.
   */
  async connect(id) {
    const dev = this.devices.get(id);
    if (!dev) return null;

    if (!this._isConfigured(dev)) {
      this.emit('adb:log', `Skipping ${id}: Tailscale IP not configured`);
      return this._update(id, { online: false, adbConnected: false });
    }

    const port = await adb.discoverPort(
      dev.tailscaleIp,
      this.portScanRange,
      dev.adbPort,
      (p) => this.emit('adb:log', `Open port on ${dev.tailscaleIp}: ${p}`)
    );

    if (!port) {
      return this._update(id, {
        online: false,
        adbConnected: false,
        foregroundApp: null,
        isOnKiosk: false,
      });
    }

    this._update(id, { adbPort: port, adbConnected: true });
    this._saveConfig();
    this.emit('device:connected', { id, adbPort: port });

    return this.refresh(id);
  }

  /**
   * Launch the kiosk app on a device.
   *
   * Primary path: enqueue a `launchFully` command for the FleetAgent to execute
   * on its next poll (works without adb, survives reboots). If adb also happens
   * to be connected, fire it immediately too as a best-effort fast path.
   */
  async launchKiosk(id) {
    const dev = this.devices.get(id);
    if (!dev) return { ok: false, error: 'Unknown device' };

    const queued = this.enqueueCommand(id, 'launchFully');

    if (dev.adbConnected && dev.adbPort) {
      // Best effort — don't fail the request if adb misbehaves.
      adb.launchApp(dev.tailscaleIp, dev.adbPort, this.targetApp).catch(() => {});
    }

    return { ok: queued, queued, targetApp: this.targetApp };
  }

  /** Queue a "wake the screen" command for the device's agent. */
  wakeScreen(id) {
    const dev = this.devices.get(id);
    if (!dev) return { ok: false, error: 'Unknown device' };
    const queued = this.enqueueCommand(id, 'screenOn');
    return { ok: queued, queued };
  }

  /** Queue a set-brightness command (0–100) for the device's agent. */
  setBrightness(id, level) {
    const dev = this.devices.get(id);
    if (!dev) return { ok: false, error: 'Unknown device' };
    const pct = Math.max(0, Math.min(100, Math.round(Number(level))));
    if (Number.isNaN(pct)) return { ok: false, error: 'Invalid level' };
    const queued = this.enqueueCommand(id, `brightness:${pct}`);
    return { ok: queued, queued, level: pct };
  }

  /** Set the same brightness (0–100) on every online device. */
  setBrightnessAll(level) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(level))));
    if (Number.isNaN(pct)) return { ok: false, error: 'Invalid level' };
    const ids = this.getAll()
      .filter((d) => d.online)
      .map((d) => d.id);
    ids.forEach((id) => this.enqueueCommand(id, `brightness:${pct}`));
    return { ok: true, count: ids.length, level: pct, ids };
  }

  /**
   * Exit the kiosk (send to home screen) on every online device — used for the
   * "Kill All" wind-down. Non-root agents can't truly force-stop the app, so
   * this backgrounds it by going to the launcher.
   */
  exitKioskAll() {
    const ids = this.getAll()
      .filter((d) => d.online)
      .map((d) => d.id);
    ids.forEach((id) => this.enqueueCommand(id, 'exitKiosk'));
    return { ok: true, count: ids.length, ids };
  }

  /** Force-stop the current foreground app on a device. */
  async killForeground(id) {
    const dev = this.devices.get(id);
    if (!dev || !dev.adbPort) return { ok: false, error: 'Device not connected' };
    if (!dev.foregroundApp) return { ok: false, error: 'No foreground app detected' };

    const pkg = dev.foregroundApp;
    const ok = await adb.forceStop(dev.tailscaleIp, dev.adbPort, pkg);
    await this.refresh(id);
    return { ok, package: pkg };
  }

  /** Spawn an scrcpy mirror window for a device. */
  mirror(id) {
    const dev = this.devices.get(id);
    if (!dev || !dev.adbPort) return { ok: false, error: 'Device not connected' };

    // Reuse an existing window if one is already running.
    const existing = this.scrcpyProcs.get(id);
    if (existing && existing.exitCode === null) {
      return { ok: true, alreadyRunning: true };
    }

    const child = adb.mirror(dev.tailscaleIp, dev.adbPort);
    this.scrcpyProcs.set(id, child);
    child.on('exit', () => this.scrcpyProcs.delete(id));
    return { ok: true };
  }

  /** Connect every configured device (used by /connect-all and startup). */
  async connectAll() {
    const ids = this.getAll()
      .filter((d) => this._isConfigured(d))
      .map((d) => d.id);
    return Promise.all(ids.map((id) => this.connect(id)));
  }

  /** Launch kiosk on every online device (agent heartbeat or adb). */
  async launchKioskAll() {
    const ids = this.getAll()
      .filter((d) => d.online)
      .map((d) => d.id);
    const results = await Promise.all(
      ids.map(async (id) => ({ id, ...(await this.launchKiosk(id)) }))
    );
    return results;
  }

  /** Refresh every device's status (used by the polling loop and Refresh All). */
  async refreshAll() {
    const ids = this.getAll().map((d) => d.id);
    return Promise.all(ids.map((id) => this.refresh(id)));
  }
}

module.exports = new DeviceManager();
