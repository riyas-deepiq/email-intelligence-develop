import styles from '@/styles/shared/components/ui/ProgressBar.module.css';

export interface ProgressBarProps {
  current: number;
  total: number;
  /** Actively running — shows a shine sweep, or an indeterminate sweep when total is unknown. */
  active?: boolean;
}

export function ProgressBar({ current, total, active }: ProgressBarProps) {
  const known = total > 0;
  const pct   = known ? Math.min(100, (current / total) * 100) : 0;

  // Nothing to show a real fill for yet (unknown total, or known total but
  // zero progress) — animate an indeterminate sweep so it still reads as "live".
  if (active && pct === 0) {
    return (
      <div className={styles.track}>
        <div className={styles.indeterminate} />
      </div>
    );
  }

  return (
    <div className={styles.track}>
      <div className={styles.fill} style={{ width: `${pct}%` }}>
        {active && known && pct < 100 && <span className={styles.shine} />}
      </div>
    </div>
  );
}
