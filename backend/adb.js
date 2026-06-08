'use strict';

const { exec, spawn } = require('child_process');
const { scanPorts } = require('./portScanner');

/**
 * Thin wrappers around the `adb` and `scrcpy` CLIs.
 *
 * Everything here runs on the backend host (the always-on Ubuntu laptop), which
 * is the only machine with ADB installed and a Tailscale tunnel to the tablets.
 * A device is addressed as `<tailscaleIp>:<port>` — the ADB transport id.
 */

const ADB_BIN = process.env.ADB_BIN || 'adb';
const SCRCPY_BIN = process.env.SCRCPY_BIN || 'scrcpy';

/**
 * Optional log sink. server.js wires this to the WebSocket `adb:log` event so
 * raw command output is visible in the dashboard for debugging.
 * @type {(line: string) => void}
 */
let logSink = () => {};
function setLogSink(fn) {
  if (typeof fn === 'function') logSink = fn;
}
function log(line) {
  try {
    logSink(line);
  } catch (_) {
    /* never let logging break a command */
  }
}

/**
 * Run a command and capture its output. Never rejects on a non-zero exit —
 * ADB routinely exits non-zero for "expected" failures (device offline, etc.),
 * and callers want to inspect stdout/stderr rather than catch.
 *
 * @param {string} cmd
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(cmd, timeoutMs = 15000) {
  return new Promise((resolve) => {
    log(`$ ${cmd}`);
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      const errOut = (stderr || '').trim();
      if (out) log(out);
      if (errOut) log(errOut);
      resolve({
        code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        stdout: out,
        stderr: errOut,
      });
    });
  });
}

const target = (ip, port) => `${ip}:${port}`;

/**
 * `adb connect <ip>:<port>`.
 * ADB prints "connected to ..." or "already connected to ..." on success, and
 * "failed to connect" / "cannot connect" on failure — but always exits 0, so we
 * parse stdout rather than trust the exit code.
 *
 * @returns {Promise<boolean>} whether the connection is established
 */
async function connect(ip, port) {
  const { stdout } = await run(`${ADB_BIN} connect ${target(ip, port)}`);
  return /connected to/i.test(stdout) && !/cannot|failed|unable/i.test(stdout);
}

/** `adb disconnect <ip>:<port>` — best effort, ignores result. */
async function disconnect(ip, port) {
  await run(`${ADB_BIN} disconnect ${target(ip, port)}`);
}

/**
 * Verify a device transport is actually usable (not just TCP-reachable) by
 * running a trivial shell command over it.
 *
 * @returns {Promise<boolean>}
 */
async function isResponsive(ip, port) {
  const { stdout } = await run(`${ADB_BIN} -s ${target(ip, port)} shell echo ok`, 8000);
  return stdout.includes('ok');
}

/**
 * Discover the active ADB port for a device.
 *
 * Strategy (per PRD §8):
 *   1. Try the last known port first — cheap, and usually still valid.
 *   2. Otherwise scan the configured range for open TCP ports.
 *   3. For each open port, attempt `adb connect` and verify responsiveness.
 *   4. Return the first port that yields a working transport.
 *
 * @param {string} ip
 * @param {{ start: number, end: number }} portRange
 * @param {number|null} lastKnownPort
 * @param {(port: number) => void} [onScanHit]  notified for each open port found
 * @returns {Promise<number|null>} the working ADB port, or null if none
 */
async function discoverPort(ip, portRange, lastKnownPort, onScanHit) {
  // 1. Fast path: reuse the cached port.
  if (lastKnownPort) {
    log(`Trying last known port ${ip}:${lastKnownPort}`);
    if (await connect(ip, lastKnownPort)) {
      if (await isResponsive(ip, lastKnownPort)) return lastKnownPort;
      await disconnect(ip, lastKnownPort);
    }
  }

  // 2. Scan the range.
  log(`Scanning ${ip} ports ${portRange.start}-${portRange.end}...`);
  const openPorts = await scanPorts(ip, portRange, { onOpen: onScanHit });
  log(`Found ${openPorts.length} open port(s) on ${ip}: ${openPorts.join(', ') || 'none'}`);

  // 3/4. Try each candidate. Prefer the last known port if it happens to be open.
  if (lastKnownPort && openPorts.includes(lastKnownPort)) {
    openPorts.sort((a, b) => (a === lastKnownPort ? -1 : b === lastKnownPort ? 1 : 0));
  }
  for (const port of openPorts) {
    if (await connect(ip, port)) {
      if (await isResponsive(ip, port)) return port;
      await disconnect(ip, port);
    }
  }

  return null;
}

/**
 * Read the package name of the current foreground (focused) activity.
 * Works across Android versions by parsing both mResumedActivity and
 * mCurrentFocus / mFocusedApp lines from `dumpsys`.
 *
 * @returns {Promise<string|null>} package name, or null if undetermined
 */
async function getForegroundApp(ip, port) {
  const { stdout } = await run(
    `${ADB_BIN} -s ${target(ip, port)} shell dumpsys activity activities`,
    10000
  );

  // mResumedActivity: ActivityRecord{... u0 de.ozerov.fully/.MainActivity ...}
  // topResumedActivity / ResumedActivity variants also appear.
  const resumed = stdout.match(/m?ResumedActivity[^\n]*\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+/);
  if (resumed) return resumed[1];

  // Fallback to window manager focus.
  const { stdout: win } = await run(
    `${ADB_BIN} -s ${target(ip, port)} shell dumpsys window windows`,
    10000
  );
  const focus = win.match(/m(?:CurrentFocus|FocusedApp)[^\n]*\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+/);
  if (focus) return focus[1];

  return null;
}

/**
 * Launch an app by package name using the activity monkey, which doesn't
 * require knowing the launcher activity name.
 * `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`
 */
async function launchApp(ip, port, pkg) {
  const { stdout, stderr } = await run(
    `${ADB_BIN} -s ${target(ip, port)} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`
  );
  const blob = `${stdout}\n${stderr}`;
  // monkey prints "Events injected: 1" on success and "No activities found" on failure.
  return /Events injected:\s*1/i.test(blob) && !/No activities found/i.test(blob);
}

/** `adb shell am force-stop <pkg>` — stop the given foreground app. */
async function forceStop(ip, port, pkg) {
  const { code, stderr } = await run(
    `${ADB_BIN} -s ${target(ip, port)} shell am force-stop ${pkg}`
  );
  return code === 0 && !stderr;
}

/**
 * Spawn an scrcpy window mirroring the device. Detached child process that
 * opens a native window on the backend host. Returns the spawned process so the
 * caller can track it; we do not wait for it to exit.
 *
 * @returns {import('child_process').ChildProcess}
 */
function mirror(ip, port) {
  log(`Spawning scrcpy for ${target(ip, port)}`);
  const child = spawn(SCRCPY_BIN, ['-s', target(ip, port), '--window-title', target(ip, port)], {
    detached: false,
    stdio: 'ignore',
  });
  child.on('error', (e) => log(`scrcpy error: ${e.message}`));
  return child;
}

module.exports = {
  setLogSink,
  connect,
  disconnect,
  isResponsive,
  discoverPort,
  getForegroundApp,
  launchApp,
  forceStop,
  mirror,
};
