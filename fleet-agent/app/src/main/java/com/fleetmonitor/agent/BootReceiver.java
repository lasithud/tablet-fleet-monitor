package com.fleetmonitor.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Restarts the agent after a reboot — the whole reason this approach beats adb.
 * Fires on BOOT_COMPLETED (and LOCKED_BOOT_COMPLETED for devices with direct
 * boot), and launches the foreground service if the device has been configured.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action);
        if (!isBoot) return;

        // Don't start until the admin has set a device id in the app.
        if (Config.getDeviceId(context).isEmpty()) return;

        Intent svc = new Intent(context, AgentService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svc);
        } else {
            context.startService(svc);
        }
    }
}
