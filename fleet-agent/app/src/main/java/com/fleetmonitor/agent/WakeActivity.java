package com.fleetmonitor.agent;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;

/**
 * Invisible, short-lived activity whose only job is to turn the screen on.
 *
 * On modern Android, the reliable way to wake the display from the background
 * is to show an activity flagged turn-screen-on / show-when-locked (a bare wake
 * lock is unreliable from Android 12+). The agent launches this on a "screenOn"
 * command; it wakes the screen, holds it briefly, then finishes so the device's
 * normal timeout resumes.
 */
public class WakeActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Close shortly; the screen stays on per the device's normal timeout.
        new Handler(Looper.getMainLooper()).postDelayed(this::finish, 2500);
    }
}
