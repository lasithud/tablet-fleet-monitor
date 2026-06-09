import { useEffect, useRef, useState } from 'react';

/**
 * Compact brightness slider. Reflects the device's reported brightness, and
 * commits the new value to the agent on release (not on every drag tick) to
 * avoid flooding the command queue.
 */
export default function BrightnessControl({ device, actions }) {
  const known = typeof device.brightness === 'number' && device.brightness >= 0;
  const [val, setVal] = useState(known ? device.brightness : 50);
  const dragging = useRef(false);

  // Sync from heartbeats when the user isn't actively dragging.
  useEffect(() => {
    if (!dragging.current && known) setVal(device.brightness);
  }, [device.brightness, known]);

  const disabled = !device.online || device.screenOn === false;
  const commit = (v) => {
    dragging.current = false;
    actions.setBrightness.mutate({ id: device.id, level: v });
  };

  return (
    <div className="flex items-center gap-2" title="Screen brightness">
      <span className="text-muted" aria-hidden>☀</span>
      <input
        type="range"
        min="0"
        max="100"
        value={val}
        disabled={disabled}
        onChange={(e) => {
          dragging.current = true;
          setVal(Number(e.target.value));
        }}
        onMouseUp={(e) => commit(Number(e.target.value))}
        onTouchEnd={() => commit(val)}
        onKeyUp={(e) => commit(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-black disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="w-8 text-right text-xs text-muted">{val}%</span>
    </div>
  );
}
