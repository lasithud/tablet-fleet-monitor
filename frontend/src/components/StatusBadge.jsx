// Small pill badges used across the device card.

function Badge({ children, className }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * App-status badge comparing the foreground app to the target kiosk package.
 * States (PRD §6.1): ✅ On Kiosk | ⚠️ Wrong App | ❓ Unknown
 */
export function AppStatusBadge({ device, targetApp }) {
  if (!device.online || !device.foregroundApp) {
    return <Badge className="bg-slate-200 text-slate-600">❓ Unknown</Badge>;
  }
  if (device.isOnKiosk) {
    return <Badge className="bg-emerald-100 text-emerald-700">✅ On Kiosk</Badge>;
  }
  return (
    <Badge className="bg-amber-100 text-amber-700" title={`Expected ${targetApp}`}>
      ⚠️ Wrong App
    </Badge>
  );
}

/** Online / Offline indicator. */
export function OnlineBadge({ online }) {
  return online ? (
    <Badge className="bg-emerald-100 text-emerald-700">● Online</Badge>
  ) : (
    <Badge className="bg-rose-100 text-rose-700">● Offline</Badge>
  );
}

/** ADB connection indicator (green/red). */
export function AdbBadge({ connected }) {
  return connected ? (
    <Badge className="bg-emerald-100 text-emerald-700">ADB ✅</Badge>
  ) : (
    <Badge className="bg-rose-100 text-rose-700">ADB ❌</Badge>
  );
}

export default Badge;
