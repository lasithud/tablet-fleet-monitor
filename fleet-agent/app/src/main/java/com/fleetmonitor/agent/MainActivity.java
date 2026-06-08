package com.fleetmonitor.agent;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * One-time setup screen. The admin enters the backend URL and this device's id,
 * grants the three permissions the agent needs, and starts it. UI is built in
 * code to keep the project to a handful of files (no res/layout needed).
 *
 * Permissions requested (all persist across reboots):
 *   1. Usage access      — to read the current foreground app
 *   2. Display over apps  — so the agent can launch Fully from the background
 *   3. Battery unrestricted — so Android doesn't suspend the agent during doze
 */
public class MainActivity extends Activity {
    private EditText serverEt;
    private EditText deviceEt;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int pad = (int) (16 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Fleet Agent");
        title.setTextSize(24);
        root.addView(title);

        root.addView(label("Server URL"));
        serverEt = new EditText(this);
        serverEt.setText(Config.getServerUrl(this));
        serverEt.setSingleLine(true);
        root.addView(serverEt);

        root.addView(label("Device ID (e.g. room-1)"));
        deviceEt = new EditText(this);
        deviceEt.setText(Config.getDeviceId(this));
        deviceEt.setSingleLine(true);
        root.addView(deviceEt);

        root.addView(button("Save settings", v -> {
            saveSettings();
            toast("Saved");
        }));

        root.addView(button("1. Grant Usage Access", v ->
                startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))));

        root.addView(button("2. Allow Display Over Other Apps", v -> {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(i);
        }));

        root.addView(button("3. Disable Battery Optimization", v ->
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))));

        root.addView(button("4. Start Agent", v -> {
            saveSettings();
            if (Config.getDeviceId(this).isEmpty()) {
                toast("Set a Device ID first");
                return;
            }
            Intent svc = new Intent(this, AgentService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
            status.setText("Agent started. It reports every 30s and restarts on boot.");
            toast("Agent started");
        }));

        status = new TextView(this);
        status.setPadding(0, pad, 0, 0);
        status.setText("Set the Device ID, grant the 3 permissions, then Start Agent.");
        root.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);

        // Android 13+ needs runtime consent to show the foreground-service notification.
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
    }

    private void saveSettings() {
        Config.save(this,
                serverEt.getText().toString().trim(),
                deviceEt.getText().toString().trim());
    }

    private TextView label(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setPadding(0, 24, 0, 0);
        return tv;
    }

    private Button button(String text, View.OnClickListener listener) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(listener);
        return b;
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}
