// At-a-glance meeting-room availability, pulled from the Office-Room-Optimizer
// and merged onto each device by the backend (device.room). Sits at the top of
// the dashboard so opening it immediately answers "which rooms are free?".

function formatTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** One room tile: green when free, red when in use. */
function RoomTile({ device }) {
  const room = device.room;
  const label = room?.roomName || device.name;

  // No availability data (Optimizer unreachable, or room not mapped yet).
  if (!room) {
    return (
      <div className="room-tile room-tile--unknown">
        <div className="flex items-center gap-2">
          <span className="dot dot-neutral" />
          <span className="truncate text-sm font-semibold text-strong">{label}</span>
        </div>
        <p className="text-xs text-muted">Availability unknown</p>
      </div>
    );
  }

  const busy = !!room.occupied;
  const until = formatTime(room.endTime);
  const next = !busy && room.startTime ? formatTime(room.startTime) : null;
  // The upcoming meeting's name (currentMeeting is the literal 'Available'
  // sentinel when there's no next meeting at all).
  const nextName =
    !busy && room.currentMeeting && room.currentMeeting !== 'Available'
      ? room.currentMeeting
      : null;

  return (
    <div className={`room-tile ${busy ? 'room-tile--busy' : 'room-tile--available'}`}>
      <div className="flex items-center gap-2">
        <span className={`dot dot-${busy ? 'error' : 'success'}`} />
        <span className="truncate text-sm font-semibold text-strong">{label}</span>
      </div>
      {busy ? (
        <p className="text-xs text-secondary break-words">
          <span className="font-medium text-strong">In use</span>
          {room.currentMeeting ? ` · ${room.currentMeeting}` : ''}
          {until ? ` · until ${until}` : ''}
        </p>
      ) : (
        <p className="text-xs text-secondary break-words">
          <span className="font-medium text-strong">Available</span>
          {nextName ? ` · ${nextName}` : ''}
          {next ? ` · next at ${next}` : ''}
        </p>
      )}
    </div>
  );
}

export default function RoomOverview({ devices, optimizer }) {
  const rooms = devices.filter((d) => d.roomKey);
  if (rooms.length === 0) return null;

  const withData = rooms.filter((d) => d.room);
  const available = withData.filter((d) => !d.room.occupied).length;

  // Surface a subtle note if we have no live data at all (Optimizer offline).
  const noData = withData.length === 0;

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-strong">Meeting Rooms</h2>
        {noData ? (
          <span className="text-xs text-muted">Availability unavailable</span>
        ) : (
          <span className="text-xs text-secondary">
            <span className="font-semibold text-strong">{available}</span> of {withData.length} available
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rooms.map((d) => (
          <RoomTile key={d.id} device={d} />
        ))}
      </div>

      {noData && optimizer?.url && (
        <p className="mt-3 text-xs text-muted">
          Couldn’t reach the room calendar at {optimizer.url}
          {optimizer.lastError ? ` (${optimizer.lastError})` : ''}.
        </p>
      )}
    </section>
  );
}
