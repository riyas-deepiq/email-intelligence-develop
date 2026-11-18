import { useState, useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import styles from '@/styles/shared/components/ui/charts/charts.module.css';

interface RingSlice {
  name: string;
  share: number;
  color: string;
}

interface ConcentricRingChartProps {
  data: RingSlice[];
  size?: number;
  center?: string;
}

type SvgPoint = {
  x: number;
  y: number;
};

function polarPoint(cx: number, cy: number, radius: number, angle: number): SvgPoint {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function donutSlicePath(cx: number, cy: number, innerR: number, outerR: number, startAngle: number, endAngle: number): string {
  const clampedEnd = endAngle - startAngle >= Math.PI * 2
    ? startAngle + Math.PI * 2 - 0.001
    : endAngle;
  const outerStart = polarPoint(cx, cy, outerR, startAngle);
  const outerEnd = polarPoint(cx, cy, outerR, clampedEnd);
  const innerEnd = polarPoint(cx, cy, innerR, clampedEnd);
  const innerStart = polarPoint(cx, cy, innerR, startAngle);
  const largeArc = clampedEnd - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR.toFixed(2)} ${outerR.toFixed(2)} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerR.toFixed(2)} ${innerR.toFixed(2)} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function glowColorFor(color: string): string {
  return color.startsWith('#') ? `${color}99` : color;
}

export function ConcentricRingChart({ data, size = 240 }: ConcentricRingChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [tipPoint, setTipPoint] = useState<SvgPoint>({ x: size / 2, y: size / 2 });

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.43;
  const innerR = size * 0.23;
  const total = data.reduce((sum, item) => sum + item.share, 0);
  const gapAngle = data.length > 1 ? (Math.PI / 180) * 5 : 0;
  let cursor = -Math.PI / 2;

  const segs = data.map((item) => {
    const sliceAngle = total > 0 ? (item.share / total) * Math.PI * 2 : 0;
    const sliceGap = Math.min(gapAngle, sliceAngle * 0.45);
    const start = cursor + sliceGap / 2;
    const end = cursor + sliceAngle - sliceGap / 2;
    cursor += sliceAngle;

    return {
      ...item,
      path: donutSlicePath(cx, cy, innerR, outerR, start, Math.max(start + 0.001, end)),
    };
  });

  const pctOf = (share: number) => (total > 0 ? Math.round((share / total) * 100) : 0);
  const active = hovered !== null ? data[hovered] : null;
  const flipTipX = tipPoint.x > size * 0.62;
  const flipTipY = tipPoint.y > size * 0.66;
  const tipStyle = active ? {
    '--tip-color': active.color,
    left: tipPoint.x,
    top: tipPoint.y,
    transform: `translate(${flipTipX ? 'calc(-100% - 12px)' : '12px'}, ${flipTipY ? 'calc(-100% - 12px)' : '12px'})`,
  } as CSSProperties & Record<'--tip-color', string> : undefined;

  const moveTip = useCallback((event: ReactMouseEvent<SVGPathElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) return;

    setTipPoint({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  }, []);

  const enter = useCallback((index: number, event: ReactMouseEvent<SVGPathElement>) => {
    setHovered(index);
    moveTip(event);
  }, [moveTip]);
  const leave = useCallback(() => setHovered(null), []);

  return (
    <div className={styles.ringWrap} style={{ width: size, height: size }}>
      <svg
        className={styles.ringSvg}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {segs.map((segment, index) => {
          const isHov = hovered === index;
          return (
            <path
              key={index}
              d={segment.path}
              fill={segment.color}
              style={{
                opacity: hovered === null || isHov ? 1 : 0.28,
                filter: isHov ? `drop-shadow(0 6px 12px ${glowColorFor(segment.color)})` : 'none',
                transition: 'opacity 0.2s, filter 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={(event) => enter(index, event)}
              onMouseMove={moveTip}
              onMouseLeave={leave}
            />
          );
        })}

        <circle
          className={styles.ringHole}
          cx={cx}
          cy={cy}
          r={innerR}
        />
      </svg>

      {active && tipStyle && (
        <div className={styles.ringTip} style={tipStyle}>
          <span className={styles.ringTipDot} style={{ background: active.color }} />
          {active.name} - {pctOf(active.share)}%
        </div>
      )}
    </div>
  );
}
