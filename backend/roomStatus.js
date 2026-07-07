'use strict';

// Pulls live meeting-room availability from the Office-Room-Optimizer app so the
// fleet dashboard can show, at a glance, which rooms are free.
//
// The Optimizer exposes GET /api/status-all → { rooms: [{ roomKey, roomName,
// occupied, checkedIn, currentMeeting, startTime, endTime }] }. We poll it on an
// interval and keep the last good result, degrading gracefully (empty map + a
// surfaced error) when the Optimizer is unset or unreachable — the rest of the
// dashboard keeps working regardless.

// Trailing slashes trimmed so `${base}/api/...` never doubles up. Defaults to the
// hosted Optimizer; override with OPTIMIZER_URL. Set it empty to disable entirely.
const OPTIMIZER_URL = (process.env.OPTIMIZER_URL ?? 'https://office-room-optimizer.onrender.com').replace(/\/+$/, '');
const POLL_MS = Math.max(5, Number(process.env.OPTIMIZER_POLL_SECONDS) || 30) * 1000;

let byRoomKey = new Map();
let lastError = null;
let lastUpdated = null;

async function refresh() {
  if (!OPTIMIZER_URL) {
    lastError = 'OPTIMIZER_URL not configured';
    return;
  }
  try {
    const res = await fetch(`${OPTIMIZER_URL}/api/status-all`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rooms = Array.isArray(data) ? data : data.rooms || [];
    const next = new Map();
    for (const r of rooms) {
      if (r && r.roomKey) next.set(r.roomKey, r);
    }
    byRoomKey = next;
    lastError = null;
    lastUpdated = new Date().toISOString();
  } catch (e) {
    // Keep the last good data; just record why we couldn't refresh.
    lastError = e.message;
  }
}

/** Live availability for a room key, or null if unknown/unavailable. */
function get(roomKey) {
  if (!roomKey) return null;
  return byRoomKey.get(roomKey) || null;
}

/** Diagnostics for the dashboard (source URL, freshness, last error). */
function status() {
  return {
    url: OPTIMIZER_URL || null,
    lastUpdated,
    lastError,
    roomCount: byRoomKey.size,
  };
}

/** Kick off an immediate fetch, then poll on the configured interval. */
function start() {
  refresh();
  const timer = setInterval(refresh, POLL_MS);
  if (timer.unref) timer.unref();
}

module.exports = { start, refresh, get, status, OPTIMIZER_URL, POLL_MS };
