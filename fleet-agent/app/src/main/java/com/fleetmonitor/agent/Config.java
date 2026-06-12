package com.fleetmonitor.agent;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Persistent per-device configuration: which backend to phone home to, and this
 * device's id (e.g. "room-1"). Stored in SharedPreferences so it survives
 * reboots and app restarts.
 */
public final class Config {
    private static final String PREFS = "fleet_agent_prefs";
    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_DEVICE = "deviceId";
    private static final String KEY_TOKEN = "token";

    /**
     * Default backend. Point this at your hosted URL (e.g.
     * https://your-app.up.railway.app) or a Tailscale IP. Editable in-app.
     */
    public static final String DEFAULT_SERVER = "https://your-app.up.railway.app";

    private Config() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String getServerUrl(Context c) {
        return prefs(c).getString(KEY_SERVER, DEFAULT_SERVER);
    }

    public static String getDeviceId(Context c) {
        return prefs(c).getString(KEY_DEVICE, "");
    }

    /** Shared access token (matches the backend's FLEET_TOKEN). Empty if unused. */
    public static String getToken(Context c) {
        return prefs(c).getString(KEY_TOKEN, "");
    }

    public static void save(Context c, String serverUrl, String deviceId, String token) {
        prefs(c).edit()
                .putString(KEY_SERVER, serverUrl)
                .putString(KEY_DEVICE, deviceId)
                .putString(KEY_TOKEN, token)
                .apply();
    }
}
