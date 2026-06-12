# FleetAgent

A tiny Android companion app for the Tablet Fleet Monitor. It runs on each
tablet, **auto-starts on boot**, and:

- reports a **heartbeat** to the backend every 30s (foreground app, battery, screen state)
- executes **commands** from the backend — currently `launchFully` (bring Fully Kiosk to the front)

This is the reliable, reboot-proof replacement for adb/Wireless Debugging:
no random ports, no pairing, no Fully Plus, no root, no watermarks. The tablet
**phones home**, so it works through Tailscale/NAT with nothing listening on the device.

---

## What it talks to

- `POST {serverUrl}/api/agent/heartbeat` → `{ id, foregroundApp, battery, screenOn }`
- The backend replies with `{ commands: [...] }`, which the agent executes.

`serverUrl` is editable on the app's setup screen — point it at your hosted
backend (e.g. `https://your-app.up.railway.app`) or a Tailscale IP. If the
backend has a `FLEET_TOKEN` set, also fill in the **Access token** field with the
same value; the agent sends it as an `X-Fleet-Token` header on every call.

---

## Build the APK (once, in Android Studio)

1. Install **Android Studio** (Koala 2024.1+ recommended) — it bundles the JDK and SDK.
2. **File → Open** → select this `fleet-agent` folder. Let Gradle sync (it'll
   download Gradle 8.7 and SDK 34 the first time).
   - If prompted about the Gradle wrapper, accept using the version in
     `gradle/wrapper/gradle-wrapper.properties` (8.7).
   - If it asks to install SDK 34 / build-tools, accept.
3. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
4. The APK lands at:
   `app/build/outputs/apk/debug/app-debug.apk`

One build works for all 6 tablets (device id is set per-device in the app, not at build time).

### Command-line alternative (no Android Studio UI)
With the Android SDK installed and `ANDROID_HOME`/`local.properties` set:
```
./gradlew assembleDebug      # macOS/Linux
gradlew.bat assembleDebug    # Windows
```
(Android Studio generates the `gradlew` wrapper scripts on first sync.)

---

## Install on a tablet (per device)

1. Copy `app-debug.apk` to the tablet (USB, Tailscale `file cp`, cloud, etc.).
2. Tap it to install — allow **"Install unknown apps"** for the file manager if prompted.
3. Open **Fleet Agent** and:
   - Set **Server URL** (your hosted/Tailscale backend), **Device ID** = `room-1`, `room-2`, … (must match `devices.json`), and **Access token** (the backend's `FLEET_TOKEN`, if set).
   - Tap **Save settings**.
   - **1. Grant Usage Access** → enable Fleet Agent in the list.
   - **2. Allow Display Over Other Apps** → enable (lets the agent launch Fully from the background).
   - **3. Disable Battery Optimization** → set Fleet Agent to **Unrestricted**.
   - Tap **4. Start Agent**.
4. Within 30s the device should appear **online** on the dashboard with its battery and foreground app.

All three permissions persist across reboots, and the boot receiver restarts the agent automatically — so after the first setup, the device needs no further hands-on.

---

## Verify

- On the dashboard, the device's card shows **Online**, the live **foreground app**, and **battery %**.
- Click **Launch Kiosk** → within one heartbeat (≤30s) Fully comes to the front on the tablet.
- **Reboot the tablet** → it should reappear online by itself and still obey Launch Kiosk.

---

## Notes / limits

- **Android 14 (API 34):** starting a `dataSync` foreground service from BOOT_COMPLETED is allowed, but some OEM builds are stricter. The battery-optimization exemption (step 3) gives the agent the leeway it needs. If a device ever doesn't auto-start after a reboot, opening the app once starts it. (The Tab A9 typically ships on Android 13, where this is unrestricted.)
- **Heartbeat interval** is 30s (`INTERVAL_MS` in `AgentService.java`); the backend treats a device as offline after 90s of silence (`agentTimeoutSeconds` in `devices.json`).
- **Security:** when `FLEET_TOKEN` is set, the backend rejects heartbeats and dashboard calls without the matching token — so it's safe to expose the hosted URL publicly. Without a token it trusts the `id` in the heartbeat (fine only on a private tailnet). Always set `FLEET_TOKEN` on a public host.
- The agent only launches `de.ozerov.fully`. To control other packages, extend `handleCommands()` and add backend commands.
