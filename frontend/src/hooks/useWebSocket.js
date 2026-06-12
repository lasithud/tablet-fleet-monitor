import { useEffect, useRef, useState, useCallback } from 'react';
import { getWsUrl } from '../api/deviceApi';

/**
 * Maintains a resilient WebSocket connection to the backend and surfaces the
 * latest device snapshot plus a stream of events.
 *
 * Auto-reconnects with a small backoff if the socket drops (e.g. backend
 * restart). The caller supplies an `onEvent` handler to react to individual
 * frames (toasts, logs); this hook also keeps a `devices` map merged from
 * `snapshot` + `device:status` frames so the UI can render without a fetch.
 *
 * @param {(evt: { type: string, payload: any }) => void} [onEvent]
 */
export function useWebSocket(onEvent) {
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState(null); // null until first snapshot
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  // Keep the latest onEvent without forcing reconnects when it changes identity.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.type === 'snapshot') {
        const map = {};
        for (const d of msg.payload) map[d.id] = d;
        setDevices(map);
      } else if (msg.type === 'device:status') {
        setDevices((prev) => ({ ...(prev || {}), [msg.payload.id]: msg.payload }));
      }

      onEventRef.current?.(msg);
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s.
      reconnectRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, devices };
}
