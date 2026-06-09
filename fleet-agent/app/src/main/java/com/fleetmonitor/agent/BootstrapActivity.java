package com.fleetmonitor.agent;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

/**
 * Invisible activity used to (re)start the agent service at boot.
 *
 * On Android 14+ a foreground service generally cannot be started from the
 * background (and BootReceiver runs in the background). Starting the service
 * from a *foreground activity* is always allowed — so the boot receiver launches
 * this translucent activity, which starts the service and immediately finishes.
 * (Background activity start at boot is permitted because the app holds the
 * "display over other apps" permission.)
 */
public class BootstrapActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent svc = new Intent(this, AgentService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        } catch (Throwable ignored) {
            // Nothing else we can do here; the next boot or manual open will retry.
        }
        finish();
    }
}
