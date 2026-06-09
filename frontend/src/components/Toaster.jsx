import { createContext, useCallback, useContext, useState } from 'react';

// Toast system, B&W system styling: white surface, gray border, dark text, and
// a small semantic dot — no colored backgrounds.

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const DOT = {
  info: 'dot-info',
  success: 'dot-success',
  warning: 'dot-warning',
  error: 'dot-error',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message, type = 'info', ttl = 5000) => {
      setToasts((t) => {
        const id = (t.length ? t[t.length - 1].id : 0) + 1;
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
            className="alert pointer-events-auto cursor-pointer"
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            <span className={`alert-dot dot ${DOT[t.type] || DOT.info}`} />
            <div className="text-sm">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
