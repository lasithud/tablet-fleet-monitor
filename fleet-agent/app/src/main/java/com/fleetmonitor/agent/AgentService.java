package com.fleetmonitor.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

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
    private static final long INTERVAL_MS = 30_000L;
    private static final String TARGET_APP = "de.ozerov.fully";

    private volatile boolean running = false;
    private Thread worker;

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
                sendHeartbeat();
            } catch (Throwable t) {
                Log.w(TAG, "heartbeat failed: " + t.getMessage());
            }
            try {
                Thread.sleep(INTERVAL_MS);
            } catch (InterruptedException e) {
                break;
            }
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

        URL url = new URL(server + "/api/agent/heartbeat");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
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

    private void handleCommands(String resp) {
        try {
            JSONObject obj = new JSONObject(resp);
            JSONArray cmds = obj.optJSONArray("commands");
            if (cmds == null) return;
            for (int i = 0; i < cmds.length(); i++) {
                if ("launchFully".equals(cmds.optString(i))) {
                    launchFully();
                }
            }
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

    /** The package of the most recent app moved to the foreground (last 60s). */
    private String getForegroundApp() {
        try {
            UsageStatsManager usm =
                    (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return null;
            long end = System.currentTimeMillis();
            long begin = end - 60_000L;
            UsageEvents events = usm.queryEvents(begin, end);
            UsageEvents.Event e = new UsageEvents.Event();
            String pkg = null;
            long last = 0;
            while (events.hasNextEvent()) {
                events.getNextEvent(e);
                if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND
                        && e.getTimeStamp() >= last) {
                    last = e.getTimeStamp();
                    pkg = e.getPackageName();
                }
            }
            return pkg;
        } catch (Throwable t) {
            return null;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
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
