import { createContext, useCallback, useContext, useState } from 'react';

// Minimal toast system (PRD §6.4). Avoids pulling in a full UI kit; renders a
// fixed stack of dismissible notifications and exposes `useToast()`.

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const STYLES = {
  info: 'bg-slate-800 text-white',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  error: 'bg-rose-600 text-white',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  // Stable id without Math.random — a monotonic counter on the setter.
  const push = useCallback(
    (message, type = 'info', ttl = 5000) => {
      setToasts((t) => {
        const id = (t.length ? t[t.length - 1].id : 0) + 1;
        // Schedule auto-dismiss.
        setTimeout(() => dismiss(id), ttl);
        return [...t, { id, message, type }];
      });
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto cursor-pointer rounded-lg px-4 py-3 text-sm shadow-lg ${STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
