import type { CSSProperties, ReactNode } from 'react';
import styles from '@/styles/shared/components/ui/AsyncState.module.css';

export interface AsyncStateProps {
  variant?: 'loading' | 'error' | 'neutral';
  children: ReactNode;
  style?: CSSProperties;
}

/** Inline loading/error/empty message box shared by admin tables and panels. */
export function AsyncState({ variant = 'neutral', children, style }: AsyncStateProps) {
  return (
    <div className={`${styles.box} ${variant === 'error' ? styles.error : ''}`} style={style}>
      {variant === 'loading' && <span className={styles.spinner} />}
      {children}
    </div>
  );
}
