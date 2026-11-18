import styles from '@/styles/shared/components/ui/charts/charts.module.css';

interface DonutSlice {
  name: string;
  share: number;
  color: string;
  count?: string;
}

interface DonutProps {
  data: DonutSlice[];
  size?: number;
  center?: string;
}

export function Donut({ data, size = 160, center }: DonutProps) {
  const R = size / 2;
  const r = R * 0.62;
  const stroke = R - r;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const slices = data.map(d => {
    const dash = (d.share / 100) * circumference;
    const slice = { ...d, dash, offset };
    offset += dash;
    return slice;
  });

  return (
    <div className={styles.donutWrap} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {slices.map((s, i) => (
          <circle
            key={i}
            cx={R}
            cy={R}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke - 2}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      {center && (
        <div className={styles.donutCenter}>
          <span className={styles.donutCenterText}>{center}</span>
        </div>
      )}
    </div>
  );
}
