'use strict';

const net = require('net');

/**
 * Port discovery for ADB-over-WiFi.
 *
 * Android's wireless debugging port is randomized on every reboot, so we can't
 * hardcode it. This module probes a TCP port range on a Tailscale IP to find
 * which ports are listening. The caller (adb.js) then attempts `adb connect`
 * against each candidate.
 */

/**
 * Check whether a single TCP port is open on a host.
 * Resolves true if a connection is established before the timeout, false otherwise.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function isPortOpen(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));

    socket.connect(port, host);
  });
}

/**
 * Run a bounded-concurrency map over a list of items.
 * Keeps the Tailscale link from being flooded with thousands of sockets at once.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, items.length) }, run);
  await Promise.all(pool);
  return results;
}

/**
 * Scan a host across [start, end] (inclusive) and return the list of open ports.
 *
 * @param {string} host
 * @param {{ start: number, end: number }} range
 * @param {object} [opts]
 * @param {number} [opts.concurrency=100]  How many sockets to keep in flight.
 * @param {number} [opts.timeoutMs=1500]   Per-port connect timeout.
 * @param {number} [opts.retries=1]        Extra attempts for ports that don't answer.
 * @param {(port: number) => void} [opts.onOpen]  Called as soon as an open port is found.
 * @returns {Promise<number[]>} open ports, ascending
 *
 * Defaults are tuned for Tailscale links, which can spike to 1+ second of
 * latency and drop packets when a device is waking from doze. A short timeout
 * (the old 400 ms) gives up before the SYN-ACK returns and misses the open
 * port entirely; a high concurrency floods a lossy relay and worsens loss. So
 * we wait longer, fan out less, and retry non-answering ports once.
 */
async function scanPorts(host, range, opts = {}) {
  const { concurrency = 100, timeoutMs = 1500, retries = 1, onOpen } = opts;
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);

  const ports = [];
  for (let p = start; p <= end; p++) ports.push(p);

  const open = [];
  await mapWithConcurrency(ports, concurrency, async (port) => {
    // Retry a non-answering port a few times — on a lossy link a single
    // probe can be dropped even though the port is open.
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (await isPortOpen(host, port, timeoutMs)) {
        open.push(port);
        if (typeof onOpen === 'function') onOpen(port);
        return;
      }
    }
  });

  return open.sort((a, b) => a - b);
}

module.exports = { isPortOpen, scanPorts };
