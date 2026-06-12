package com.fleetmonitor.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Foreground service that, every 30 seconds:
 *   1. reads the current foreground app (via UsageStatsManager), battery, and
 *      screen state,
 *   2. POSTs a heartbeat to the backend, and
 *   3. executes any commands the backend returns (currently "launchFully").
 *
 * Runs as a foreground service so Android keeps it alive, and is restarted on
 * boot by BootReceiver — so the device stays manageable without adb or
 * Wireless Debugging.
 */
public class AgentService extends Service {
    private static final String TAG = "FleetAgent";
    private static final String CHANNEL_ID = "fleet_agent";
    private static final int NOTIF_ID = 1;
    private static final long HEARTBEAT_MS = 10_000L;    // full status report cadence
    private static final long COMMAND_POLL_MS = 3_000L;  // command pickup cadence (snappy launches)
    private static final String TARGET_APP = "de.ozerov.fully";

    private volatile boolean running = false;
    private Thread worker;
    private long lastHeartbeat = 0;
    // Set true after a command runs so the next loop tick sends a heartbeat
    // immediately — the dashboard then reflects the new state within ~3s
    // instead of waiting for the regular heartbeat.
    private volatile boolean forceHeartbeat = false;
    // Last app we successfully detected in the foreground. Kept so that when a
    // device sits on one app (no new usage events), we keep reporting it instead
    // of dropping to null/Unknown.
    private String lastForegroundApp = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundNotif();
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "fleet-agent-loop");
            worker.start();
        }
        return START_STICKY;
    }

    private void loop() {
        while (running) {
            try {
                long now = System.currentTimeMillis();
                if (forceHeartbeat || now - lastHeartbeat >= HEARTBEAT_MS) {
                    // Full heartbeat (also returns any queued commands). Runs on
                    // schedule, or immediately after a command via forceHeartbeat.
                    forceHeartbeat = false;
                    sendHeartbeat();
                    lastHeartbeat = System.currentTimeMillis();
                } else {
                    // Lightweight command check between heartbeats for low latency.
                    pollCommands();
                }
            } catch (Throwable t) {
                Log.w(TAG, "poll failed: " + t.getMessage());
            }
            try {
                Thread.sleep(COMMAND_POLL_MS);
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    /** Lightweight GET that drains and runs pending commands (no status payload). */
    private void pollCommands() throws Exception {
        String deviceId = Config.getDeviceId(this);
        String server = Config.getServerUrl(this);
        if (deviceId.isEmpty() || server.isEmpty()) return;

        URL url = new URL(server + "/api/agent/commands?id=" + deviceId);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("GET");
            addAuth(conn);
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                handleCommands(readAll(conn));
            }
        } finally {
            conn.disconnect();
        }
    }

    // ---- heartbeat ---------------------------------------------------------

    private void sendHeartbeat() throws Exception {
        String deviceId = Config.getDeviceId(this);
        String server = Config.getServerUrl(this);
        if (deviceId.isEmpty() || server.isEmpty()) return;

        JSONObject body = new JSONObject();
        body.put("id", deviceId);
        body.put("foregroundApp", getForegroundApp());
        body.put("battery", getBattery());
        body.put("screenOn", isScreenOn());
        body.put("charging", isCharging());
        body.put("brightness", getBrightness());

        URL url = new URL(server + "/api/agent/heartbeat");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            addAuth(conn);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                handleCommands(readAll(conn));
            } else {
                Log.w(TAG, "backend returned HTTP " + code);
            }
        } finally {
            conn.disconnect();
        }
    }

    /** Attach the shared access token (if configured) so the backend accepts us. */
    private void addAuth(HttpURLConnection conn) {
        String token = Config.getToken(this);
        if (token != null && !token.isEmpty()) {
            conn.setRequestProperty("X-Fleet-Token", token);
        }
    }

    /** Read an HTTP response body fully into a UTF-8 string. */
    private String readAll(HttpURLConnection conn) throws Exception {
        try (InputStream is = conn.getInputStream();
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[1024];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toString("UTF-8");
        }
    }

    private void handleCommands(String resp) {
        try {
            JSONObject obj = new JSONObject(resp);
            JSONArray cmds = obj.optJSONArray("commands");
            if (cmds == null || cmds.length() == 0) return;
            for (int i = 0; i < cmds.length(); i++) {
                String cmd = cmds.optString(i);
                if ("launchFully".equals(cmd)) {
                    launchFully();
                } else if ("screenOn".equals(cmd)) {
                    wakeScreen();
                } else if ("exitKiosk".equals(cmd)) {
                    goHome();
                } else if (cmd.startsWith("brightness:")) {
                    try {
                        setBrightness(Integer.parseInt(cmd.substring("brightness:".length())));
                    } catch (NumberFormatException ignored) {
                        /* malformed value */
                    }
                }
            }
            // A command changed device state — report it on the next tick (~3s)
            // instead of waiting for the regular heartbeat.
            forceHeartbeat = true;
        } catch (Exception e) {
            Log.w(TAG, "could not parse commands: " + e.getMessage());
        }
    }

    private void launchFully() {
        Intent i = getPackageManager().getLaunchIntentForPackage(TARGET_APP);
        if (i == null) {
            Log.w(TAG, TARGET_APP + " is not installed");
            return;
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(i);
        } catch (Exception e) {
            // On Android 10+ background activity starts need the "Display over
            // other apps" permission — that's why MainActivity asks for it.
            Log.w(TAG, "launch failed (grant 'Display over other apps'): " + e.getMessage());
        }
    }

    // ---- device readings ---------------------------------------------------

    /**
     * Determine the current foreground app robustly.
     *
     * A kiosk sits on one app for long stretches, so there may be no recent
     * "moved to foreground" event. We therefore:
     *   1. Look for the latest foreground event in the last 10 minutes (catches switches).
     *   2. If none, fall back to the most-recently-used app over the last day
     *      (queryUsageStats) — this is the current app even when idle.
     *   3. If both somehow yield nothing, keep the last value we knew, so the
     *      card never flips to Unknown just because the device is idle.
     */
    private String getForegroundApp() {
        try {
            UsageStatsManager usm =
                    (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return lastForegroundApp;

            long end = System.currentTimeMillis();
            String pkg = null;

            // 1. Recent foreground-transition events (most accurate for switches).
            UsageEvents events = usm.queryEvents(end - 600_000L, end); // last 10 min
            UsageEvents.Event e = new UsageEvents.Event();
            long last = 0;
            while (events.hasNextEvent()) {
                events.getNextEvent(e);
                if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND
                        && e.getTimeStamp() >= last) {
                    last = e.getTimeStamp();
                    pkg = e.getPackageName();
                }
            }

            // 2. Fallback: most-recently-used app over the last day (idle kiosk).
            if (pkg == null) {
                List<UsageStats> stats = usm.queryUsageStats(
                        UsageStatsManager.INTERVAL_BEST, end - 24L * 60 * 60 * 1000, end);
                long maxUsed = 0;
                if (stats != null) {
                    for (UsageStats s : stats) {
                        if (s.getLastTimeUsed() > maxUsed) {
                            maxUsed = s.getLastTimeUsed();
                            pkg = s.getPackageName();
                        }
                    }
                }
            }

            // 3. Update the cache only when we actually found something.
            if (pkg != null) {
                lastForegroundApp = pkg;
            }
            return lastForegroundApp;
        } catch (Throwable t) {
            return lastForegroundApp;
        }
    }

    private int getBattery() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            return bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : -1;
        } catch (Throwable t) {
            return -1;
        }
    }

    private boolean isScreenOn() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isInteractive();
    }

    /** Current system brightness as a 0–100 percentage (-1 if unknown). */
    private int getBrightness() {
        try {
            int v = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, -1);
            return v < 0 ? -1 : Math.round(v / 255f * 100f);
        } catch (Throwable t) {
            return -1;
        }
    }

    /**
     * Set system brightness (0–100%). Requires the WRITE_SETTINGS special access,
     * which can be granted via adb (appops) or on the app's settings screen.
     * Switches off auto-brightness so the manual value sticks.
     */
    private void setBrightness(int percent) {
        try {
            if (!Settings.System.canWrite(this)) {
                Log.w(TAG, "brightness: WRITE_SETTINGS not granted");
                return;
            }
            int p = Math.max(0, Math.min(100, percent));
            int value = Math.max(8, Math.round(p / 100f * 255f)); // never fully black
            Settings.System.putInt(
                    getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            Settings.System.putInt(
                    getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, value);
        } catch (Throwable t) {
            Log.w(TAG, "setBrightness failed: " + t.getMessage());
        }
    }

    /**
     * Whether the device is on external power. We treat "plugged in" as charging
     * because BatteryManager.isCharging() returns false when the battery is full
     * or limited by battery-protection mode, even though it's on the charger.
     */
    /**
     * Exit the kiosk by sending the device to the home screen, which backgrounds
     * Office Optimizer. (A true force-stop of another app needs root/adb, which a
     * non-rooted agent can't do — this is the closest non-root equivalent.)
     */
    private void goHome() {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(home);
        } catch (Throwable t) {
            Log.w(TAG, "goHome failed: " + t.getMessage());
        }
    }

    /**
     * Wake the screen on command. Uses a brief wake lock with ACQUIRE_CAUSES_WAKEUP;
     * after the hold expires the device's normal screen timeout resumes.
     */
    private void wakeScreen() {
        // 1) Wake lock nudges the CPU/screen awake.
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock wl = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        "fleetagent:wake");
                wl.acquire(15_000L); // wake + hold ~15s, then auto-release
            }
        } catch (Throwable t) {
            Log.w(TAG, "wake lock failed: " + t.getMessage());
        }
        // 2) Launch the turn-screen-on activity (reliable on modern Android).
        try {
            Intent i = new Intent(this, WakeActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            startActivity(i);
        } catch (Throwable t) {
            Log.w(TAG, "wake activity failed: " + t.getMessage());
        }
    }

    private boolean isCharging() {
        try {
            Intent batt = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (batt == null) return false;
            int plugged = batt.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            int status = batt.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            return plugged != 0
                    || status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---- foreground notification -------------------------------------------

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Fleet Agent", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void startForegroundNotif() {
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        Notification n = b
                .setContentTitle("Fleet Agent running")
                .setContentText("Reporting status to the dashboard")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+: specialUse — no daily time limit (unlike dataSync on 15+).
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
