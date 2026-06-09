import { useState } from 'react';

const APP_LABELS = {
  'com.android.chrome': 'Chrome',
  'com.android.settings': 'Settings',
  'com.sec.android.app.launcher': 'the home screen',
  'com.google.android.apps.nexuslauncher': 'the home screen',
};
const appLabel = (pkg) => APP_LABELS[pkg] || pkg || 'another app';

/**
 * Turn the fleet state into a prioritized list of *actions the operator should
 * take* to keep the kiosks healthy. Each item carries advice and, where the
 * action can be done remotely, an inline button.
 */
function buildItems(devices, actions) {
  const items = [];
  for (const d of devices) {
    if (!d.online) {
      items.push({
        key: `${d.id}-offline`,
        tone: 'error',
        title: `${d.name} is offline`,
        advice: 'Check the tablet’s power and that Tailscale is connected.',
      });
      continue;
    }
    if (d.screenOn === false) {
      items.push({
        key: `${d.id}-screen`,
        tone: 'neutral',
        title: `${d.name} screen is off`,
        advice: 'Wake the screen so the kiosk is visible.',
        action: { label: 'Wake Screen', run: () => actions.screenOn.mutate(d.id) },
      });
    } else if (d.foregroundApp && !d.isOnKiosk) {
      items.push({
        key: `${d.id}-app`,
        tone: 'warning',
        title: `${d.name} is on ${appLabel(d.foregroundApp)}`,
        advice: 'Relaunch Office Optimizer to return it to the kiosk.',
        action: { label: 'Launch', run: () => actions.launchKiosk.mutate(d.id) },
      });
    }
    if (d.charging === false) {
      items.push({
        key: `${d.id}-power`,
        tone: 'warning',
        title: `${d.name} is unplugged`,
        advice: 'Reconnect the charger — meeting-room tablets should stay on power.',
      });
    }
  }
  return items;
}

export default function ActionCenter({ devices, actions }) {
  const [open, setOpen] = useState(true);
  const items = buildItems(devices, actions);
  if (items.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <button type="button" className="ac-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2">
          <span className="dot dot-lg dot-warning" />
          <span className="font-semibold text-strong">Action required</span>
          <span className="badge badge-plain">{items.length}</span>
        </span>
        <span className={`ac-chevron${open ? ' open' : ''}`}>▶</span>
      </button>

      {open && (
        <ul className="ac-list">
          {items.map((it) => (
            <li key={it.key} className="ac-item">
              <span className={`dot ac-dot dot-${it.tone}`} />
              <div className="ac-item-text">
                <div className="ac-item-title">{it.title}</div>
                <div className="ac-item-advice">{it.advice}</div>
              </div>
              {it.action && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={it.action.run}
                >
                  {it.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
