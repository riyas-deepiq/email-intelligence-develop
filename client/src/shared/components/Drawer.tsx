import type { ReactNode } from 'react';
import { useEffect } from 'react';
import styles from '@/styles/shared/components/Drawer.module.css';
import IcClose from '@/assets/icons/x.svg?react';

interface DrawerProps {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  avatar?: ReactNode;
  children: ReactNode;
  width?: number;
}

export function Drawer({ onClose, title, subtitle, avatar, children, width = 420 }: DrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel} style={{ width, maxWidth: `calc(100vw - 32px)` }}>
        <div className={styles.header}>
          {avatar}
          <div className={styles.headerText}>
            <div className={styles.title}>{title}</div>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close" type="button">
            <IcClose width={18} height={18} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}
