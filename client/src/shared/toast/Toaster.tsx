import { useEffect, useRef, useState } from 'react';
import { ToastType, type ToastItem } from './toast.types';
import { useToast } from './useToast';
import IcAlert from '@/assets/icons/alert.svg?react';
import IcCheck from '@/assets/icons/check.svg?react';
import IcInfo from '@/assets/icons/info.svg?react';
import IcX from '@/assets/icons/x.svg?react';
import styles from '@/styles/shared/toast/Toaster.module.css';

const ICONS: Record<ToastType, JSX.Element> = {
  [ToastType.Success]: <IcCheck width={12} height={12} />,
  [ToastType.Error]: <IcX width={12} height={12} />,
  [ToastType.Warning]: <IcAlert width={12} height={12} />,
  [ToastType.Info]: <IcInfo width={12} height={12} />,
};

function ToastRow({ t, onDismiss }: { t: ToastItem; onDismiss: (id: string) => void }) {
  const [shake, setShake] = useState(false);
  const firstRun = useRef(true);

  // Shake whenever a duplicate is suppressed (shakeNonce bumps) — but not on mount.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setShake(true);
    const id = setTimeout(() => setShake(false), 450);
    return () => clearTimeout(id);
  }, [t.shakeNonce]);

  return (
    <div
      className={`${styles.toast} ${styles[t.type]} ${t.title ? styles.withTitle : styles.pill} ${t.leaving ? styles.leaving : ''} ${shake ? styles.shake : ''}`}
      role="alert"
    >
      <span className={styles.icon}>{ICONS[t.type]}</span>

      <div className={styles.body}>
        {t.title && <div className={styles.title}>{t.title}</div>}
        <div className={styles.message}>{t.message}</div>
      </div>

      <button className={styles.close} onClick={() => onDismiss(t.id)} aria-label="Dismiss">
        <IcX width={13} height={13} />
      </button>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastRow key={t.id} t={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
