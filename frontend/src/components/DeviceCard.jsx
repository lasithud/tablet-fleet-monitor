import { AppStatusBadge, OnlineBadge, AdbBadge } from './StatusBadge';
import ActionButtons from './ActionButtons';

// Human-readable labels for known packages. Falls back to the raw package name.
const APP_LABELS = {
  'de.ozerov.fully': 'Fully Kiosk',
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
 * One card per device (PRD §6.1 / §12). The left accent bar encodes the
 * device's overall health at a glance: green=on kiosk, amber=wrong app,
 * red=offline.
 */
export default function DeviceCard({ device, targetApp, actions }) {
  const wrongApp = device.online && device.foregroundApp && !device.isOnKiosk;

  const accent = !device.online
    ? 'border-l-rose-400'
    : wrongApp
      ? 'border-l-amber-400'
      : 'border-l-emerald-400';

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-l-4 ${accent} bg-white p-4 shadow-sm`}
    >
      {/* Header: name + room */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">{device.name}</h3>
          <p className="text-xs text-slate-400">{device.id}</p>
        </div>
        <OnlineBadge online={device.online} />
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        <AdbBadge connected={device.adbConnected} />
        <AppStatusBadge device={device} targetApp={targetApp} />
      </div>

      {/* Details */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-400">App</dt>
        <dd className={wrongApp ? 'font-medium text-amber-600' : 'text-slate-700'}>
          {appLabel(device.foregroundApp)}
        </dd>

        <dt className="text-slate-400">IP</dt>
        <dd className="font-mono text-slate-600">{device.tailscaleIp}</dd>

        <dt className="text-slate-400">Port</dt>
        <dd className="font-mono text-slate-600">{device.adbPort ?? '—'}</dd>

        {typeof device.battery === 'number' && (
          <>
            <dt className="text-slate-400">Battery</dt>
            <dd className="text-slate-600">{device.battery}%</dd>
          </>
        )}

        <dt className="text-slate-400">Checked</dt>
        <dd className="text-slate-600">{relativeTime(device.lastChecked)}</dd>
      </dl>

      <ActionButtons device={device} actions={actions} />
    </div>
  );
}
