import { type ReactNode } from 'react';
import styles from '@/styles/shared/components/ui/Badge.module.css';

export type BadgeTone = 'accent' | 'ok' | 'warn' | 'danger' | 'violet' | 'teal' | 'neutral' | 'b-accent';

const TONE_CLASS: Record<BadgeTone, string> = {
  accent:    styles.accent,
  ok:        styles.ok,
  warn:      styles.warn,
  danger:    styles.danger,
  violet:    styles.violet,
  teal:      styles.teal,
  neutral:   styles.neutral,
  'b-accent': styles.bAccent,
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({ children, tone = 'neutral', dot }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone] ?? styles.neutral}`}>
      {dot && <i className={styles.dot} />}
      {children}
    </span>
  );
}
