import DeviceCard from './DeviceCard';

/** Responsive grid of device cards (PRD §12 layout). */
export default function DeviceGrid({ devices, targetApp, actions }) {
  if (!devices || devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
        No devices configured. Add Tailscale IPs in <code>backend/devices.json</code>.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((device) => (
        <DeviceCard
          key={device.id}
          device={device}
          targetApp={targetApp}
          actions={actions}
        />
      ))}
    </div>
  );
}
