import { AppStatusBadge, OnlineBadge } from './StatusBadge';
import ActionButtons from './ActionButtons';
import BrightnessControl from './BrightnessControl';

// Human-readable labels for known packages. Falls back to the raw package name.
const APP_LABELS = {
  'de.ozerov.fully': 'Office Optimizer',
  'com.fleetmonitor.agent': 'Fleet Agent',
  'com.android.chrome': 'Chrome',
  'com.sec.android.app.launcher': 'Home Screen',
  'com.google.android.apps.nexuslauncher': 'Home Screen',
  'com.android.settings': 'Settings',
};

function appLabel(pkg) {
  if (!pkg) return 'Unknown';
  return APP_LABELS[pkg] || pkg;
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return new Date(iso).toLocaleTimeString();
}

/**
 * One card per device. Pure B&W surface — state is conveyed entirely by badges
 * and small semantic dots, never by card color (per the design system).
 */
export default function DeviceCard({ device, actions }) {
  const wrongApp = device.online && device.foregroundApp && !device.isOnKiosk;

  const batteryKnown = typeof device.battery === 'number' && device.battery >= 0;

  return (
    <div className="card flex flex-col gap-2 p-4">
      {/* Header: name + id, online badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-strong">{device.name}</h3>
          <p className="font-mono text-xs text-muted">{device.id}</p>
        </div>
        <OnlineBadge online={device.online} />
      </div>

      <AppStatusBadge device={device} />

      {/* Compact details — App, Battery+power on one line, last seen */}
      <dl className="kv">
        <dt>App</dt>
        <dd className={wrongApp ? 'font-medium text-strong' : ''}>{appLabel(device.foregroundApp)}</dd>

        {batteryKnown && (
          <>
            <dt>Battery</dt>
            <dd>
              {typeof device.charging === 'boolean' && (
                <span className={`dot dot-${device.charging ? 'success' : 'warning'}`} />
              )}
              {device.battery}%
              {device.charging === true && ' · Charging'}
              {device.charging === false && ' · On battery'}
            </dd>
          </>
        )}

        <dt>Last seen</dt>
        <dd>{relativeTime(device.lastHeartbeat || device.lastChecked)}</dd>
      </dl>

      {device.online && <BrightnessControl device={device} actions={actions} />}

      <ActionButtons device={device} actions={actions} />
    </div>
  );
}
