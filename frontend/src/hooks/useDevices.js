import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceApi } from '../api/deviceApi';

/**
 * Data layer for the dashboard.
 *
 * React Query owns the canonical device list (initial load + 30s polling +
 * manual refetch). The WebSocket layer (useWebSocket) pushes live updates which
 * App.jsx merges into this cache via `patchDevice`, so the two stay in sync
 * without double-fetching.
 */

const DEVICES_KEY = ['devices'];

export function useDevices(pollIntervalSeconds = 30, autoRefresh = true) {
  const query = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: deviceApi.getDevices,
    refetchInterval: autoRefresh ? pollIntervalSeconds * 1000 : false,
    refetchOnWindowFocus: false,
  });

  return query;
}

/** Hook bundle for all device actions, wired to invalidate/patch the cache. */
export function useDeviceActions() {
  const qc = useQueryClient();

  // Merge a single updated device into the cached list.
  const patchDevice = (updated) => {
    if (!updated || !updated.id) return;
    qc.setQueryData(DEVICES_KEY, (old) => {
      if (!old) return old;
      return {
        ...old,
        devices: old.devices.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)),
      };
    });
  };

  const refetch = () => qc.invalidateQueries({ queryKey: DEVICES_KEY });

  // Merge the fleet-wide auto-relaunch flag into the cached payload.
  const patchAutoRelaunch = (enabled) => {
    qc.setQueryData(DEVICES_KEY, (old) => (old ? { ...old, autoRelaunch: enabled } : old));
  };

  // Merge pushed room availability (by roomKey) into each device, plus the
  // Optimizer diagnostics. Lets the WebSocket keep rooms live without a refetch.
  const patchRooms = (rooms, optimizer) => {
    const byKey = new Map((rooms || []).map((r) => [r.roomKey, r]));
    qc.setQueryData(DEVICES_KEY, (old) => {
      if (!old) return old;
      return {
        ...old,
        optimizer: optimizer ?? old.optimizer,
        devices: old.devices.map((d) =>
          d.roomKey && byKey.has(d.roomKey) ? { ...d, room: byKey.get(d.roomKey) } : d
        ),
      };
    });
  };

  const connect = useMutation({
    mutationFn: deviceApi.connect,
    onSuccess: (res) => patchDevice(res.device),
  });

  const refresh = useMutation({
    mutationFn: deviceApi.getStatus,
    onSuccess: (dev) => patchDevice(dev),
  });

  const launchKiosk = useMutation({
    mutationFn: deviceApi.launchKiosk,
    onSettled: refetch,
  });

  const screenOn = useMutation({
    mutationFn: deviceApi.screenOn,
    onSettled: refetch,
  });

  const setBrightness = useMutation({
    mutationFn: ({ id, level }) => deviceApi.setBrightness(id, level),
  });

  const mirror = useMutation({ mutationFn: deviceApi.mirror });

  const killForeground = useMutation({
    mutationFn: deviceApi.killForeground,
    onSettled: refetch,
  });

  const connectAll = useMutation({
    mutationFn: deviceApi.connectAll,
    onSettled: refetch,
  });

  const launchKioskAll = useMutation({
    mutationFn: deviceApi.launchKioskAll,
    onSettled: refetch,
  });

  const exitKioskAll = useMutation({
    mutationFn: deviceApi.exitKioskAll,
    onSettled: refetch,
  });

  const lockScreenAll = useMutation({
    mutationFn: deviceApi.lockScreenAll,
    onSettled: refetch,
  });

  const setBrightnessAll = useMutation({
    mutationFn: (level) => deviceApi.setBrightnessAll(level),
    onSettled: refetch,
  });

  const setAutoRelaunch = useMutation({
    mutationFn: (enabled) => deviceApi.setAutoRelaunch(enabled),
    onSuccess: (res) => patchAutoRelaunch(res.autoRelaunch),
  });

  return {
    patchDevice,
    patchAutoRelaunch,
    patchRooms,
    refetch,
    connect,
    refresh,
    launchKiosk,
    screenOn,
    setBrightness,
    mirror,
    killForeground,
    connectAll,
    launchKioskAll,
    exitKioskAll,
    lockScreenAll,
    setBrightnessAll,
    setAutoRelaunch,
  };
}
