// Thin REST client for the fleet-monitor backend.
// The base URL is configurable via VITE_API_BASE for non-localhost setups.

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const deviceApi = {
  // GET config + status of all devices
  getDevices: () => request('/api/devices'),

  // Refresh a single device's status
  getStatus: (id) => request(`/api/devices/${id}/status`),

  // Per-device actions
  connect: (id) => request(`/api/devices/${id}/connect`, { method: 'POST' }),
  launchKiosk: (id) => request(`/api/devices/${id}/launch-kiosk`, { method: 'POST' }),
  mirror: (id) => request(`/api/devices/${id}/mirror`, { method: 'POST' }),
  killForeground: (id) => request(`/api/devices/${id}/kill-foreground`, { method: 'POST' }),

  // Fleet-wide actions
  connectAll: () => request('/api/devices/connect-all', { method: 'POST' }),
  launchKioskAll: () => request('/api/devices/launch-kiosk-all', { method: 'POST' }),
};
