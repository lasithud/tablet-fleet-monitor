import DeviceCard from './DeviceCard';

/** Responsive grid of device cards. */
export default function DeviceGrid({ devices, actions }) {
  if (!devices || devices.length === 0) {
    return (
      <div className="card p-12 text-center text-muted">
        No devices configured. Add Tailscale IPs in <code>backend/devices.json</code>.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((device) => (
        <DeviceCard key={device.id} device={device} actions={actions} />
      ))}
    </div>
  );
}
