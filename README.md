# Meeting Room Tablet Fleet Monitor

A dashboard to remotely monitor and control a fleet of Samsung Tab A9 tablets
running **Fully Kiosk Browser** (`de.ozerov.fully`) in meeting rooms. The
tablets are reachable over **Tailscale VPN**; the backend bridges the browser to
**ADB over WiFi** and **scrcpy**.

```
[Admin Browser (React)] --HTTP/WebSocket--> [Node backend] --ADB/Tailscale--> [6x Tab A9]
```

The Android wireless-debugging port is randomized on each reboot, so the backend
**auto-discovers** it by scanning the configured TCP port range on each device's
Tailscale IP and attempting `adb connect`.

---

## Project layout

```
tablet-fleet-monitor/
├── backend/
│   ├── server.js          # Express REST + WebSocket server, 30s poll loop
│   ├── adb.js             # adb / scrcpy command wrappers + port discovery
│   ├── portScanner.js     # raw-TCP port scanner (bounded concurrency)
│   ├── deviceManager.js   # in-memory fleet state, emits status events
│   └── devices.json       # device config (IPs, names) + cached ports
├── frontend/              # React 18 + Vite + Tailwind + React Query
│   └── src/
│       ├── App.jsx
│       ├── components/     # DeviceCard, DeviceGrid, StatusBadge, ActionButtons, DashboardHeader, Toaster
│       ├── hooks/          # useDevices (React Query), useWebSocket
│       └── api/            # deviceApi.js
├── package.json           # backend deps + convenience scripts
└── README.md
```

---

## Prerequisites

The backend shells out to `adb` and `scrcpy`, so both must be installed on the
machine running the server (the always-on Ubuntu laptop), and all tablets must
be reachable on Tailscale.

```bash
# Android platform tools (adb) and scrcpy
sudo apt install adb scrcpy

# Tailscale must be up and all tablets connected
tailscale status
```

> On Windows/macOS, install `adb` (Android platform-tools) and `scrcpy` and make
> sure both are on your `PATH`. You can override the binaries with the
> `ADB_BIN` / `SCRCPY_BIN` environment variables.

---

## Setup

```bash
# 1. Install dependencies (root installs backend deps; postinstall installs frontend)
npm install

# 2. Configure devices — add the Tailscale IPs for rooms 2–6
#    (room-1 is pre-filled at 100.119.152.12)
edit backend/devices.json

# 3. Start the backend (REST :3001 + WebSocket :3001)
npm run backend        # or: cd backend && node server.js

# 4. In a second terminal, start the frontend dev server
npm run frontend       # or: cd frontend && npm run dev

# 5. Open the dashboard
http://localhost:5173
```

The backend attempts to connect every configured device on startup, then polls
status every 30 seconds.

---

## Configuration (`backend/devices.json`)

```json
{
  "devices": [
    { "id": "room-1", "name": "Meeting Room 1", "tailscaleIp": "100.119.152.12", "lastKnownPort": null }
  ],
  "targetApp": "de.ozerov.fully",
  "portScanRange": { "start": 37000, "end": 45000 },
  "pollIntervalSeconds": 30
}
```

- Devices whose `tailscaleIp` still contains `x` (the `100.x.x.x` placeholder)
  are treated as **not configured** and shown offline — fill them in to enable.
- `lastKnownPort` is written back automatically whenever a device connects, so
  the next reconnect tries the cached port first before scanning.

### Environment overrides

| Variable     | Default     | Purpose                                   |
| ------------ | ----------- | ----------------------------------------- |
| `PORT`       | `3001`      | Backend HTTP/WS port                      |
| `ADB_BIN`    | `adb`       | Path to the `adb` binary                  |
| `SCRCPY_BIN` | `scrcpy`    | Path to the `scrcpy` binary               |

Frontend (set in `frontend/.env`):

| Variable        | Default                 | Purpose            |
| --------------- | ----------------------- | ------------------ |
| `VITE_API_BASE` | `http://localhost:3001` | Backend REST base  |
| `VITE_WS_URL`   | `ws://localhost:3001`   | Backend WebSocket  |

---

## REST API

| Method | Endpoint                            | Description                          |
| ------ | ----------------------------------- | ------------------------------------ |
| GET    | `/api/devices`                      | Config + current status of all       |
| GET    | `/api/devices/:id/status`           | Refresh status for one device        |
| POST   | `/api/devices/:id/connect`          | Port scan + `adb connect`            |
| POST   | `/api/devices/:id/launch-kiosk`     | Launch `de.ozerov.fully`             |
| POST   | `/api/devices/:id/mirror`           | Spawn `scrcpy` window                |
| POST   | `/api/devices/:id/kill-foreground`  | Force-stop current foreground app    |
| POST   | `/api/devices/connect-all`          | Connect all configured devices       |
| POST   | `/api/devices/launch-kiosk-all`     | Launch kiosk on all connected        |

### WebSocket (`ws://localhost:3001`)

| Event                  | Payload                  | When                              |
| ---------------------- | ------------------------ | --------------------------------- |
| `snapshot`             | `Device[]`               | On client connect                 |
| `device:status`        | `Device`                 | Each status refresh / poll        |
| `device:connected`     | `{ id, adbPort }`        | ADB transport established         |
| `device:disconnected`  | `{ id }`                 | Device transitioned to offline    |
| `adb:log`              | `string`                 | Raw adb/scrcpy output (debugging) |

### Device status object

```json
{
  "id": "room-1",
  "name": "Meeting Room 1",
  "tailscaleIp": "100.119.152.12",
  "adbPort": 38613,
  "adbConnected": true,
  "online": true,
  "foregroundApp": "de.ozerov.fully",
  "isOnKiosk": true,
  "lastChecked": "2026-06-08T12:34:56Z"
}
```

---

## How port discovery works (`adb.js → discoverPort`)

1. Try the **last known port** first (`adb connect`, then a `shell echo` probe).
2. If that fails, **scan `37000–45000`** on the Tailscale IP for open TCP ports.
3. For each open port, attempt `adb connect` and verify the transport responds.
4. Cache the first working port back to `devices.json`.

Scanning uses bounded concurrency (200 sockets, 400 ms timeout) so a full sweep
completes in a few seconds over Tailscale.

---

## Notes / scope (v1)

- No authentication, multi-user, scheduling, or history persistence (per PRD §13).
- `scrcpy` opens a **native window on the backend host**, not in the browser —
  the admin views it where the server runs (or via a remote desktop to it).
- UI is built with Tailwind + a few small in-repo components rather than a full
  shadcn/ui install, to keep the project self-contained; the visual language
  (cards, badges, buttons, toasts) matches the PRD.
```
