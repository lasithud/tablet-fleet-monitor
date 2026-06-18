// Thin REST client for the fleet-monitor backend.
//
// Defaults to the SAME ORIGIN the dashboard is served from, so the hosted
// deployment needs zero per-laptop config — any browser that opens the URL just
// works. For local development against a separate backend, override with
// VITE_API_BASE / VITE_WS_URL in frontend/.env.

import { getToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// WebSocket base: explicit override, else derive ws(s):// from the current page.
const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

/** WebSocket URL including the auth token (browsers can't set WS headers). */
export function getWsUrl() {
  const token = getToken();
  return `${WS_BASE}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch {
      /* non-JSON body */
    }
    const err = new Error(detail || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Unauthenticated: does this backend require a token? */
export const fetchPublicConfig = () => request('/api/public-config');

export const deviceApi = {
  // GET config + status of all devices
  getDevices: () => request('/api/devices'),

  // Refresh a single device's status
  getStatus: (id) => request(`/api/devices/${id}/status`),

  // Per-device actions
  connect: (id) => request(`/api/devices/${id}/connect`, { method: 'POST' }),
  launchKiosk: (id) => request(`/api/devices/${id}/launch-kiosk`, { method: 'POST' }),
  screenOn: (id) => request(`/api/devices/${id}/screen-on`, { method: 'POST' }),
  setBrightness: (id, level) =>
    request(`/api/devices/${id}/brightness`, {
      method: 'POST',
      body: JSON.stringify({ level }),
    }),
  mirror: (id) => request(`/api/devices/${id}/mirror`, { method: 'POST' }),
  killForeground: (id) => request(`/api/devices/${id}/kill-foreground`, { method: 'POST' }),

  // Fleet-wide actions
  connectAll: () => request('/api/devices/connect-all', { method: 'POST' }),
  launchKioskAll: () => request('/api/devices/launch-kiosk-all', { method: 'POST' }),
  exitKioskAll: () => request('/api/devices/exit-kiosk-all', { method: 'POST' }),
  setBrightnessAll: (level = 70) =>
    request('/api/devices/brightness-all', {
      method: 'POST',
      body: JSON.stringify({ level }),
    }),

  // Toggle the auto-relaunch watchdog (keeps tablets pinned to the kiosk app)
  setAutoRelaunch: (enabled) =>
    request('/api/auto-relaunch', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
};
