import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ToastContext } from './toast.context';
import { ToastType, type ToastItem } from './toast.types';

const EXIT_DURATION = 250;

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  [ToastType.Success]: 3500,
  [ToastType.Error]: 6000,
  [ToastType.Warning]: 5000,
  [ToastType.Info]: 4000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

  const toastsRef = useRef<ToastItem[]>(toasts);
  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const clearTimers = (id: string) => {
    timers.current.get(id)?.forEach(clearTimeout);
    timers.current.delete(id);
  };

  const scheduleAutoDismiss = useCallback((id: string, dur: number) => {
    clearTimers(id);
    const leaveTimer = setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    }, dur);
    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, dur + EXIT_DURATION);
    timers.current.set(id, [leaveTimer, removeTimer]);
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, title?: string, duration?: number) => {
      const dur = duration ?? DEFAULT_DURATIONS[type];

      const existing = toastsRef.current.find(
        (t) => !t.leaving && t.type === type && t.message === message && t.title === title,
      );
      if (existing) {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === existing.id ? { ...t, shakeNonce: (t.shakeNonce ?? 0) + 1 } : t,
          ),
        );
        scheduleAutoDismiss(existing.id, dur);
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { id, type, message, title, duration: dur, shakeNonce: 0 }]);
      scheduleAutoDismiss(id, dur);
    },
    [scheduleAutoDismiss],
  );

  const dismissToast = useCallback((id: string) => {
    clearTimers(id);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_DURATION);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}
