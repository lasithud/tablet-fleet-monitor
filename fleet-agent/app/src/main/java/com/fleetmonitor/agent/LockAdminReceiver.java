package com.fleetmonitor.agent;

import android.app.admin.DeviceAdminReceiver;

/**
 * Minimal device-admin receiver whose only purpose is to let the agent call
 * {@code DevicePolicyManager.lockNow()} so the backend "Rest for Weekend"
 * action can lock/turn off the tablet screens.
 *
 * Activate it either from the setup screen or remotely with:
 *   adb shell dpm set-active-admin com.fleetmonitor.agent/.LockAdminReceiver
 */
public class LockAdminReceiver extends DeviceAdminReceiver {
}
