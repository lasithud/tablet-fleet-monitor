import { useEffect, useRef, useState } from 'react';
import DashboardHeader from './components/DashboardHeader';
import DeviceGrid from './components/DeviceGrid';
import { ToastProvider, useToast } from './components/Toaster';
import { useDevices, useDeviceActions } from './hooks/useDevices';
import { useWebSocket } from './hooks/useWebSocket';

function Dashboard() {
  const toast = useToast();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const actions = useDeviceActions();
  const { data, isLoading, error } = useDevices(30, autoRefresh);

  const targetApp = data?.targetApp || 'de.ozerov.fully';

  // Track previous online state per device to detect Online -> Offline edges.
  const prevOnline = useRef({});

  // Live WebSocket updates: patch the React Query cache and raise toasts.
  const { connected: wsConnected } = useWebSocket((evt) => {
    if (evt.type === 'device:status') {
      actions.patchDevice(evt.payload);

      const id = evt.payload.id;
      const was = prevOnline.current[id];
      const now = evt.payload.online;
      if (was === true && now === false) {
        toast(`${evt.payload.name} went offline`, 'error');
        notifyDesktop(`${evt.payload.name} is offline`);
      }
      prevOnline.current[id] = now;
    } else if (evt.type === 'device:connected') {
      toast(`ADB connected on ${evt.payload.id} (port ${evt.payload.adbPort})`, 'success');
    }
  });

  // Seed prevOnline from the initial REST payload.
  useEffect(() => {
    if (data?.devices) {
      for (const d of data.devices) {
        if (prevOnline.current[d.id] === undefined) prevOnline.current[d.id] = d.online;
      }
    }
  }, [data]);

  // Ask for desktop-notification permission once (PRD §6.4, optional).
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const devices = data?.devices || [];

  const busy =
    actions.connectAll.isPending ||
    actions.launchKioskAll.isPending ||
    actions.refetch.isPending;

  const handleRefreshAll = () => {
    actions.refetch();
    toast('Refreshing all devices…', 'info', 2000);
  };

  const handleLaunchKioskAll = async () => {
    try {
      const { results } = await actions.launchKioskAll.mutateAsync();
      const ok = results.filter((r) => r.ok).length;
      toast(`Launched kiosk on ${ok}/${results.length} device(s)`, ok ? 'success' : 'warning');
    } catch (e) {
      toast(`Launch all failed: ${e.message}`, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <DashboardHeader
        devices={devices}
        wsConnected={wsConnected}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        onRefreshAll={handleRefreshAll}
        onLaunchKioskAll={handleLaunchKioskAll}
        busy={busy}
      />

      {isLoading && (
        <div className="p-12 text-center text-slate-400">Loading devices…</div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          Could not reach the backend at the configured API base. Is{' '}
          <code>node server.js</code> running? ({error.message})
        </div>
      )}

      {!isLoading && !error && (
        <DeviceGrid devices={devices} targetApp={targetApp} actions={actions} />
      )}
    </div>
  );
}

function notifyDesktop(body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Tablet Fleet Monitor', { body });
  }
}

export default function App() {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50">
        <Dashboard />
      </div>
    </ToastProvider>
  );
}
