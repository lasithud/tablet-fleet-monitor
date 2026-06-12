import { useEffect, useState, useCallback } from 'react';
import { getToken, setToken, clearToken } from '../api/auth';
import { deviceApi, fetchPublicConfig } from '../api/deviceApi';

/**
 * Gates the dashboard behind the shared access token.
 *
 * Flow:
 *   1. Ask the backend whether auth is required (/api/public-config).
 *   2. If not required → render the app.
 *   3. If required → validate any stored token by making one authed call.
 *      A 401 (or no token) shows the entry form; success renders the app.
 *
 * Renders a small "Lock" control once unlocked so a shared laptop can be
 * cleared, and lets other laptops sign in independently with the same token.
 */
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | locked | open
  const [authRequired, setAuthRequired] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const validate = useCallback(async () => {
    setPhase('loading');
    try {
      const cfg = await fetchPublicConfig();
      setAuthRequired(cfg.authRequired);
      if (!cfg.authRequired) {
        setPhase('open');
        return;
      }
      if (!getToken()) {
        setPhase('locked');
        return;
      }
      await deviceApi.getDevices(); // throws with .status === 401 if token is wrong
      setPhase('open');
    } catch (e) {
      if (e.status === 401) {
        clearToken();
        setPhase('locked');
        setError('That access code was rejected.');
      } else {
        // Backend unreachable, etc. — still allow entering a code to retry.
        setPhase('locked');
        setError(`Can’t reach the server (${e.message}).`);
      }
    }
  }, []);

  useEffect(() => {
    validate();
  }, [validate]);

  const submit = async (e) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setBusy(true);
    setError('');
    setToken(t);
    await validate();
    setBusy(false);
  };

  const lock = () => {
    clearToken();
    setInput('');
    setPhase('locked');
  };

  if (phase === 'loading') {
    return <div className="p-12 text-center text-muted">Loading…</div>;
  }

  if (phase === 'locked') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
          <div>
            <h1 className="text-lg font-bold text-strong">Tablet Fleet Monitor</h1>
            <p className="text-secondary text-sm">Enter the access code to continue.</p>
          </div>
          <input
            type="password"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Access code"
            className="w-full rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
          {error && (
            <div className="flex items-center gap-2 text-sm text-secondary">
              <span className="dot dot-error" />
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !input.trim()}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {children}
      {authRequired && (
        <button
          onClick={lock}
          className="btn btn-ghost btn-sm"
          style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 50 }}
          title="Clear this laptop’s access code"
        >
          Lock
        </button>
      )}
    </>
  );
}
