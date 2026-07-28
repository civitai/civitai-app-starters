import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Toast, type ToastColor } from './Toast.js';
import { useComponentStyles } from './styles.js';

export interface ToastOptions {
  /** Optional bold title. */
  title?: React.ReactNode;
  /** The message body. */
  message: React.ReactNode;
  /** Intent accent. */
  color?: ToastColor;
  /** Auto-dismiss after N ms. `0` (or negative) = sticky. Defaults to 5000. */
  duration?: number;
  /** Announce assertively (`role="alert"`) instead of politely. */
  urgent?: boolean;
}

interface ActiveToast extends ToastOptions {
  id: string;
}

export interface ToastApi {
  /** Enqueue a toast; returns its id. */
  show: (options: ToastOptions) => string;
  /** Dismiss a toast early by id. */
  dismiss: (id: string) => void;
  /** Dismiss all visible toasts. */
  clear: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children?: React.ReactNode;
  /** Accessible name for the live region. Defaults to `'Notifications'`. */
  label?: string;
  /** Default auto-dismiss duration (ms) for `show()` calls without one. */
  defaultDuration?: number;
}

let idSeq = 0;

/**
 * Provides the toast queue + auto-dismiss timers and renders the
 * `data-civitai-ui="toast-region"` `aria-live` host (portaled to `document.body`
 * so it floats above app content). Consume via `useToast()`. SSR-safe: the host
 * only mounts once a document exists.
 */
export function ToastProvider({
  children,
  label = 'Notifications',
  defaultDuration = 5000,
}: ToastProviderProps): React.JSX.Element {
  useComponentStyles();
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const [mounted, setMounted] = useState(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    setMounted(true);
    const active = timers.current;
    return () => {
      for (const t of active.values()) clearTimeout(t);
      active.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      const id = `ci-toast-${++idSeq}`;
      setToasts((cur) => [...cur, { ...options, id }]);
      const duration = options.duration ?? defaultDuration;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }
      return id;
    },
    [defaultDuration, dismiss]
  );

  const clear = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    setToasts([]);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss, clear }), [show, dismiss, clear]);

  const region =
    mounted && typeof document !== 'undefined'
      ? createPortal(
          <div
            data-civitai-ui="toast-region"
            role="region"
            aria-label={label}
            aria-live="polite"
          >
            {toasts.map((t) => (
              <Toast
                key={t.id}
                color={t.color}
                title={t.title}
                urgent={t.urgent}
                onClose={() => dismiss(t.id)}
              >
                {t.message}
              </Toast>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {region}
    </ToastContext.Provider>
  );
}

/**
 * Access the toast API. Must be called under a `<ToastProvider>`.
 * `const toast = useToast(); toast.show({ message: 'Saved', color: 'success' });`
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx == null) {
    throw new Error('useToast() must be used within a <ToastProvider>.');
  }
  return ctx;
}
