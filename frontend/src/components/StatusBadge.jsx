// Black & white status badges (Resolv design system): white pill, dot-colored
// border, dark label, and a small semantic dot. Color appears ONLY in the dot.

function Badge({ tone, children }) {
  return (
    <span className={`badge border-${tone}`}>
      <span className={`dot dot-${tone}`} />
      {children}
    </span>
  );
}

/**
 * App-status badge comparing the foreground app to the target kiosk package.
 * Screen-off takes priority — a dark tablet isn't actively "on" the app.
 */
export function AppStatusBadge({ device }) {
  if (!device.online) return <Badge tone="neutral">Unknown</Badge>;
  if (device.screenOn === false) return <Badge tone="neutral">Screen Off</Badge>;
  if (!device.foregroundApp) return <Badge tone="neutral">Unknown</Badge>;
  if (device.isOnKiosk) return <Badge tone="success">On Office Optimizer</Badge>;
  return <Badge tone="warning">Wrong App</Badge>;
}

/** Online / Offline indicator. */
export function OnlineBadge({ online }) {
  return online ? <Badge tone="success">Online</Badge> : <Badge tone="error">Offline</Badge>;
}

export default Badge;
