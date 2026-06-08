// Per-device action buttons (PRD §6.3).
// Each button reflects the pending state of its mutation so the admin gets
// feedback while a port scan / launch / etc. is running.

function ActionButton({ onClick, pending, disabled, variant = 'default', children }) {
  const base =
    'w-full rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
    danger: 'bg-rose-100 text-rose-700 hover:bg-rose-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={`${base} ${variants[variant]}`}
    >
      {pending ? '…' : children}
    </button>
  );
}

export default function ActionButtons({ device, actions }) {
  const { connect, refresh, launchKiosk, mirror, killForeground } = actions;
  const id = device.id;

  // True only while the mutation is in flight for *this* device.
  const isPending = (m) => m.isPending && m.variables === id;

  const connected = device.adbConnected;

  return (
    <div className="grid grid-cols-2 gap-2 pt-1">
      <ActionButton
        onClick={() => connect.mutate(id)}
        pending={isPending(connect)}
        variant="primary"
      >
        Reconnect ADB
      </ActionButton>

      <ActionButton
        onClick={() => refresh.mutate(id)}
        pending={isPending(refresh)}
      >
        Refresh
      </ActionButton>

      <ActionButton
        onClick={() => launchKiosk.mutate(id)}
        pending={isPending(launchKiosk)}
        disabled={!connected}
      >
        Launch Kiosk
      </ActionButton>

      <ActionButton
        onClick={() => mirror.mutate(id)}
        pending={isPending(mirror)}
        disabled={!connected}
      >
        Mirror Screen
      </ActionButton>

      <ActionButton
        onClick={() => killForeground.mutate(id)}
        pending={isPending(killForeground)}
        disabled={!connected || !device.foregroundApp}
        variant="danger"
      >
        Kill Foreground
      </ActionButton>
    </div>
  );
}
