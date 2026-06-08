// Dashboard header: fleet summary counts + global controls (PRD §6.2 / §12).

function Stat({ label, value, className }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="font-semibold">{value}</span>
      <span className="text-slate-500">{label}</span>
    </span>
  );
}

export default function DashboardHeader({
  devices,
  wsConnected,
  autoRefresh,
  onToggleAutoRefresh,
  onRefreshAll,
  onLaunchKioskAll,
  busy,
}) {
  const total = devices.length;
  const online = devices.filter((d) => d.online).length;
  const warning = devices.filter((d) => d.online && d.foregroundApp && !d.isOnKiosk).length;
  const offline = total - online;

  return (
    <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🖥️</span>
          <div>
            <h1 className="text-lg font-bold text-slate-800">
              Meeting Room Tablet Monitor
            </h1>
            <div
              className="flex items-center gap-1 text-xs"
              title={wsConnected ? 'Live updates connected' : 'Reconnecting…'}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  wsConnected ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
              <span className="text-slate-400">
                {wsConnected ? 'Live' : 'Reconnecting…'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={onToggleAutoRefresh}
              className="h-4 w-4 rounded border-slate-300"
            />
            Auto-refresh (30s)
          </label>
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={busy}
            className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            Refresh All
          </button>
          <button
            type="button"
            onClick={onLaunchKioskAll}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Launch Kiosk on All
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Stat label="Devices" value={total} className="text-slate-700" />
        <Stat label="Online" value={`✅ ${online}`} className="text-emerald-600" />
        <Stat label="Warning" value={`⚠️ ${warning}`} className="text-amber-600" />
        <Stat label="Offline" value={`🔴 ${offline}`} className="text-rose-600" />
      </div>
    </header>
  );
}
