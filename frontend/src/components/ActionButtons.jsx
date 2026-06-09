// Per-device actions. Only the *relevant* primary action is shown — Wake Screen
// when the screen is off, Launch Office Optimizer when it's on — so the two are
// mutually exclusive and the active one always reads as the bold primary.

function Btn({ onClick, pending, disabled, variant = 'soft', title, dot, sm, animate, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      title={title}
      className={`btn btn-${variant} btn-block${sm ? ' btn-sm' : ''}${animate ? ' btn-pulse' : ''}`}
    >
      {dot && <span className={`dot dot-${dot}`} />}
      {pending ? '…' : children}
    </button>
  );
}

export default function ActionButtons({ device, actions }) {
  const { refresh, launchKiosk, screenOn } = actions;
  const id = device.id;

  const isPending = (m) => m.isPending && m.variables === id;
  const screenOff = device.online && device.screenOn === false;

  return (
    <div className="flex flex-col gap-2 pt-1">
      {screenOff ? (
        <Btn
          onClick={() => screenOn.mutate(id)}
          pending={isPending(screenOn)}
          disabled={!device.online}
          variant="primary"
          dot="warning"
          sm
          animate
        >
          Wake Screen
        </Btn>
      ) : (
        <Btn
          onClick={() => launchKiosk.mutate(id)}
          pending={isPending(launchKiosk)}
          disabled={!device.online || device.isOnKiosk}
          title={device.isOnKiosk ? 'Already on Office Optimizer' : undefined}
          variant="primary"
          sm
          animate
        >
          {device.isOnKiosk ? 'On Office Optimizer' : 'Launch Office Optimizer'}
        </Btn>
      )}

      <Btn onClick={() => refresh.mutate(id)} pending={isPending(refresh)} variant="ghost" sm>
        Refresh
      </Btn>
    </div>
  );
}
