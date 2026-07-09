// Dark page-header block (B&W system) with fleet summary as label + dot + count,
// followed by a white controls row.

function MetaItem({ label, value, tone }) {
  return (
    <div className="page-header-meta-item">
      <span className="lbl">{label}</span>
      <span className="val">
        {tone && <span className={`dot dot-lg dot-${tone}`} />}
        {value}
      </span>
    </div>
  );
}

export default function DashboardHeader({
  devices,
  wsConnected,
  autoRefresh,
  onToggleAutoRefresh,
  autoRelaunch,
  onToggleAutoRelaunch,
  onRefreshAll,
  onLaunchKioskAll,
  onKillAll,
  onLockAll,
  onBrightness70,
  busy,
}) {
  const total = devices.length;
  const online = devices.filter((d) => d.online).length;
  const warning = devices.filter(
    (d) => d.online && ((d.foregroundApp && !d.isOnKiosk) || d.screenOn === false)
  ).length;
  const offline = total - online;

  return (
    <div className="space-y-3">
      <header className="page-header">
        <div className="page-header-badge">
          <span className={`dot dot-${wsConnected ? 'success' : 'error'}`} />
          {wsConnected ? 'Live' : 'Reconnecting…'}
        </div>
        <h1>Meeting Room Tablet Monitor</h1>
        <p>Remote monitoring and control of the meeting-room tablet fleet.</p>

        <div className="page-header-meta">
          <MetaItem label="Devices" value={total} />
          <MetaItem label="Online" value={online} tone="success" />
          <MetaItem label="Warning" value={warning} tone="warning" />
          <MetaItem label="Offline" value={offline} tone="error" />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={onToggleAutoRefresh}
            className="h-4 w-4 accent-black"
          />
          Auto-refresh (30s)
        </label>

        <label
          className="flex cursor-pointer items-center gap-2 text-sm text-secondary"
          title="When on, any tablet found off Office Optimizer is automatically reloaded back onto it. Uncheck to override and stop the automatic relaunch."
        >
          <input
            type="checkbox"
            checked={autoRelaunch}
            onChange={onToggleAutoRelaunch}
            className="h-4 w-4 accent-black"
          />
          <span className={`dot dot-${autoRelaunch ? 'success' : 'neutral'}`} />
          Auto-relaunch Office Optimizer
        </label>

        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn btn-soft btn-sm" onClick={onBrightness70} disabled={busy}>
            <span aria-hidden>☀</span> Set 70% Brightness
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefreshAll} disabled={busy}>
            Refresh All
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onKillAll} disabled={busy}>
            <span className="dot dot-error" />
            Kill All
          </button>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={onLockAll}
            disabled={busy}
            title="Lock the screen on all tablets and let them rest (e.g. over the weekend)"
          >
            <span aria-hidden>💤</span> Rest for Weekend
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onLaunchKioskAll} disabled={busy}>
            Launch Office Optimizer on All
          </button>
        </div>
      </div>
    </div>
  );
}
