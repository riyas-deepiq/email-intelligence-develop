import type { ReactNode } from 'react';
import styles from '@/styles/shared/components/ui/Label.module.css';

export type LabelVariant = 'ok' | 'down' | 'warn' | 'high' | 'info' | 'neutral';
export type LabelSize    = 'sm' | 'md';

export interface LabelProps {
  variant?:  LabelVariant;
  size?:     LabelSize;
  dot?:      boolean;
  children:  ReactNode;
  className?: string;
}

export function Label({
  variant   = 'neutral',
  size      = 'md',
  dot       = false,
  children,
  className,
}: LabelProps) {
  return (
    <span
      className={[
        styles.label,
        styles[variant],
        styles[size],
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
