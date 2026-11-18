import { useState } from 'react';
import styles from '@/styles/shared/components/ui/charts/charts.module.css';

interface AreaChartProps<T extends object> {
  data: T[];
  keys: string[];
  colors?: string[];
  height?: number;
  labelKey?: string;
  dashedKeys?: string[];
}

function valueAt<T extends object>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

export function AreaChart<T extends object>({
  data,
  keys,
  colors = ['var(--accent)'],
  height = 200,
  labelKey = 'label',
  dashedKeys = [],
}: AreaChartProps<T>) {
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) return <div style={{ height }} />;

  const H = height;
  const PAD = { top: 20, right: 16, bottom: 28, left: 8 };

  const xDivisor = Math.max(data.length - 1, 1);
  const xAt = (index: number) => PAD.left + (index / xDivisor) * (600 - PAD.left - PAD.right);
  const allVals = data.flatMap((d) => keys.map((k) => Number(valueAt(d, k) ?? 0)));
  const minV = 0;
  const maxV = Math.max(...allVals) * 1.1 || 1;

  const toY = (v: number) =>
    PAD.top + (H - PAD.top - PAD.bottom) * (1 - (v - minV) / (maxV - minV));

  return (
    <div className={styles.chartWrap} style={{ height: H }}>
      <svg width="100%" height={H} viewBox={`0 0 600 ${H}`} preserveAspectRatio="none">
        {keys.map((key, ki) => {
          const color = colors[ki] ?? 'var(--accent)';
          const points = data.map((d, i) => {
            const x = xAt(i);
            const y = toY(Number(valueAt(d, key) ?? 0));
            return { x, y };
          });

          const linePath = points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ');
          const areaPath =
            linePath +
            ` L${points[points.length - 1].x.toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${points[0].x.toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`;

          return (
            <g key={key}>
              <defs>
                <linearGradient id={`grad-${ki}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.01" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#grad-${ki})`} />
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={dashedKeys.includes(key) ? 1.75 : 2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={dashedKeys.includes(key) ? '5,4' : undefined}
              />
              {hover !== null && (
                <circle
                  cx={points[hover].x}
                  cy={points[hover].y}
                  r="4"
                  fill={color}
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}

        {data.map((_, i) => {
          const x = xAt(i);
          return (
            <rect
              key={i}
              x={x - 600 / data.length / 2}
              y={0}
              width={600 / data.length}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {hover !== null &&
          (() => {
            const x = xAt(hover);
            return (
              <line
                x1={x}
                y1={PAD.top}
                x2={x}
                y2={H - PAD.bottom}
                stroke="var(--bdr)"
                strokeWidth="1"
                strokeDasharray="4,2"
              />
            );
          })()}
      </svg>

      <div className={styles.xAxis}>
        {data
          .filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0)
          .map((d) => {
            const idx = data.indexOf(d);
            const xPct = (xAt(idx) / 600) * 100;
            const transform =
              idx === 0
                ? 'translateX(0)'
                : idx === data.length - 1
                  ? 'translateX(-100%)'
                  : 'translateX(-50%)';
            return (
              <span key={idx} className={styles.xTick} style={{ left: `${xPct}%`, transform }}>
                {String(valueAt(d, labelKey) ?? '')}
              </span>
            );
          })}
      </div>

      {hover !== null && (
        <div
          className={styles.tooltip}
          style={{
            left: `${(hover / xDivisor) * 100}%`,
            transform: hover > data.length * 0.75 ? 'translateX(-100%)' : 'translateX(-50%)',
          }}
        >
          <div className={styles.ttLabel}>{String(valueAt(data[hover], labelKey) ?? '')}</div>
          {keys.map((k, ki) => (
            <div key={k} className={styles.ttRow}>
              <span
                className={styles.ttDot}
                style={{ background: colors[ki] ?? 'var(--accent)' }}
              />
              <span className={styles.ttKey}>{k}</span>
              <span className={styles.ttVal}>
                {Number(valueAt(data[hover], k) ?? 0).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
