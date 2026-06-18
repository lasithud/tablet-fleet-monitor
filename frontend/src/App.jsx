import { useEffect, useRef, useState } from 'react';
import DashboardHeader from './components/DashboardHeader';
import DeviceGrid from './components/DeviceGrid';
import ActionCenter from './components/ActionCenter';
import { ToastProvider, useToast } from './components/Toaster';
import { useDevices, useDeviceActions } from './hooks/useDevices';
import { useWebSocket } from './hooks/useWebSocket';

function Dashboard() {
  const toast = useToast();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const actions = useDeviceActions();
  const { data, isLoading, error } = useDevices(30, autoRefresh);

  const targetApp = data?.targetApp || 'de.ozerov.fully';
  const autoRelaunch = data?.autoRelaunch ?? true;

  // Per-device previous state, to detect the edges we alert on.
  const prev = useRef({}); // id -> { online, wrongApp, charging }

  // Raise an attention-grabbing alert: in-site toast + beep.
  const raiseAlert = (message) => {
    toast(message, 'error', 8000);
    beep();
  };

  // Live WebSocket updates: patch the React Query cache and fire edge alerts.
  const { connected: wsConnected } = useWebSocket((evt) => {
    if (evt.type === 'autoRelaunch') {
      actions.patchAutoRelaunch(evt.payload);
      return;
    }
    if (evt.type !== 'device:status') return;
    const d = evt.payload;
    actions.patchDevice(d);

    const before = prev.current[d.id] || {};
    const wrongApp = d.online && !!d.foregroundApp && !d.isOnKiosk;

    // Online -> Offline
    if (before.online === true && d.online === false) {
      raiseAlert(`🔴 ${d.name} went offline`);
    }
    // Entered wrong-app state
    if (before.wrongApp === false && wrongApp) {
      raiseAlert(`⚠️ ${d.name} is running the wrong app`);
    }
    // Charger unplugged (was charging, now on battery)
    if (before.charging === true && d.charging === false) {
      raiseAlert(`🔌 ${d.name} was unplugged — now on battery`);
    }
    // Screen turned off
    if (before.screenOn === true && d.screenOn === false) {
      raiseAlert(`🌑 ${d.name} screen turned off`);
    }

    prev.current[d.id] = {
      online: d.online,
      wrongApp,
      charging: d.charging,
      screenOn: d.screenOn,
    };
  });

  // Seed previous-state from the initial REST payload so the first transition
  // (not the initial load) is what triggers an alert.
  useEffect(() => {
    if (data?.devices) {
      for (const d of data.devices) {
        if (prev.current[d.id] === undefined) {
          prev.current[d.id] = {
            online: d.online,
            wrongApp: d.online && !!d.foregroundApp && !d.isOnKiosk,
            charging: d.charging,
            screenOn: d.screenOn,
          };
        }
      }
    }
  }, [data]);

  // Unlock the audio context on the first user interaction so Chrome lets the
  // alert beep play (its autoplay policy blocks sound until a user gesture).
  useEffect(() => {
    const onGesture = () => unlockAudio();
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  const devices = data?.devices || [];

  const busy =
    actions.connectAll.isPending ||
    actions.launchKioskAll.isPending ||
    actions.exitKioskAll.isPending ||
    actions.setBrightnessAll.isPending ||
    actions.refetch.isPending;

  const handleRefreshAll = () => {
    actions.refetch();
    toast('Refreshing all devices…', 'info', 2000);
  };

  const handleToggleAutoRelaunch = async () => {
    const next = !autoRelaunch;
    try {
      await actions.setAutoRelaunch.mutateAsync(next);
      toast(
        next
          ? 'Auto-relaunch ON — tablets off Office Optimizer will be reloaded'
          : 'Auto-relaunch paused — tablets won’t be auto-reloaded',
        next ? 'success' : 'warning'
      );
    } catch (e) {
      toast(`Couldn’t change auto-relaunch: ${e.message}`, 'error');
    }
  };

  const handleLaunchKioskAll = async () => {
    try {
      const { results } = await actions.launchKioskAll.mutateAsync();
      const ok = results.filter((r) => r.ok).length;
      toast(
        `Launched Office Optimizer on ${ok}/${results.length} device(s)`,
        ok ? 'success' : 'warning'
      );
    } catch (e) {
      toast(`Launch all failed: ${e.message}`, 'error');
    }
  };

  const handleBrightness70 = async () => {
    try {
      const r = await actions.setBrightnessAll.mutateAsync(70);
      toast(`Set 70% brightness on ${r.count} device(s)`, 'success');
    } catch (e) {
      toast(`Set brightness failed: ${e.message}`, 'error');
    }
  };

  const handleKillAll = async () => {
    if (
      !window.confirm(
        'Exit Office Optimizer on all online tablets? They’ll be sent to the home screen.'
      )
    ) {
      return;
    }
    try {
      const r = await actions.exitKioskAll.mutateAsync();
      toast(`Exiting kiosk on ${r.count} device(s)`, 'warning');
    } catch (e) {
      toast(`Kill all failed: ${e.message}`, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <DashboardHeader
        devices={devices}
        wsConnected={wsConnected}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        autoRelaunch={autoRelaunch}
        onToggleAutoRelaunch={handleToggleAutoRelaunch}
        onRefreshAll={handleRefreshAll}
        onLaunchKioskAll={handleLaunchKioskAll}
        onKillAll={handleKillAll}
        onBrightness70={handleBrightness70}
        busy={busy}
      />

      {!isLoading && !error && <ActionCenter devices={devices} actions={actions} />}

      {isLoading && <div className="p-12 text-center text-muted">Loading devices…</div>}

      {error && (
        <div className="alert">
          <span className="alert-dot dot-error" />
          <div>
            <div className="font-semibold text-strong">Can’t reach the backend</div>
            <span className="text-secondary">
              The server may be starting up or unreachable. ({error.message})
            </span>
          </div>
        </div>
      )}

      {!isLoading && !error && (
        <DeviceGrid devices={devices} targetApp={targetApp} actions={actions} />
      )}
    </div>
  );
}

// Short audible alert tone via Web Audio (no asset needed).
//
// Chrome blocks audio that isn't tied to a user gesture: an AudioContext created
// from a WebSocket event starts "suspended" and stays silent. So we (a) unlock
// the context on the first user interaction (see unlockAudio), and (b) resume it
// before each beep if it has been suspended.
let audioCtx;
function getAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

// Call on a user gesture to satisfy Chrome's autoplay policy.
function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function beep() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const play = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    };
    if (ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
    else play();
  } catch (_) {
    /* audio unavailable / blocked */
  }
}

export default function App() {
  return (
    <ToastProvider>
      <div className="min-h-screen">
        <Dashboard />
      </div>
    </ToastProvider>
  );
}
