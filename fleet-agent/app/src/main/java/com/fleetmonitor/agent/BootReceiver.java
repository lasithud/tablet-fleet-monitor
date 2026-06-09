package com.fleetmonitor.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Restarts the agent after a reboot (or app update) — the whole reason this
 * approach beats adb.
 *
 * On Android 14+ a foreground service usually can't be started directly from a
 * background broadcast, so we try the direct start (works when the app is
 * battery-unrestricted) and fall back to launching BootstrapActivity, which
 * starts the service from the foreground (always allowed).
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        boolean trigger =
                Intent.ACTION_BOOT_COMPLETED.equals(action)
                        || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        if (!trigger) return;

        // Don't start until the admin has configured a device id.
        if (Config.getDeviceId(context).isEmpty()) return;

        // 1) Direct start — succeeds when the app is exempt from battery limits.
        try {
            Intent svc = new Intent(context, AgentService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
            return;
        } catch (Throwable ignored) {
            // Fall through to the activity-based start.
        }

        // 2) Fallback — start via a foreground activity (allowed at boot because
        //    the app holds the "display over other apps" permission).
        try {
            Intent act = new Intent(context, BootstrapActivity.class);
            act.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(act);
        } catch (Throwable ignored) {
            // Last resort: nothing more to try here.
        }
    }
}
