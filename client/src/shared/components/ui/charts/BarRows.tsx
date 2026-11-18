import styles from '@/styles/shared/components/ui/charts/charts.module.css';

interface BarRow {
  name: string;
  count: number;
  color?: string;
  trend?: number;
}

interface BarRowsProps {
  data: BarRow[];
  max?: number;
}

export function BarRows({ data, max }: BarRowsProps) {
  const maxVal = max ?? Math.max(...data.map(d => d.count));
  return (
    <div className={styles.barRows}>
      {data.map((d, i) => (
        <div key={i} className={styles.barRow}>
          <div className={styles.barRowName}>{d.name}</div>
          <div className={styles.barRowTrack}>
            <div
              className={styles.barRowFill}
              style={{
                width: `${(d.count / maxVal) * 100}%`,
                background: d.color ?? 'var(--accent)',
              }}
            />
          </div>
          <div className={styles.barRowCount}>{d.count.toLocaleString()}</div>
          {d.trend != null && (
            <div className={`${styles.barRowTrend} ${d.trend >= 0 ? styles.trendUp : styles.trendDown}`}>
              {d.trend >= 0 ? '+' : ''}{d.trend}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
